// Recap reminders (2026-09-29) — two checks built together since they share the same "morning
// after an attendance-counting rehearsal" timing:
//   9:00am  admin nudge — no published recap yet -> remind staff who attended
//   10:00am member send — a published recap now exists -> tell every active member
// "Editing an already-published recap does not create another push" and "if no published recap
// exists by 10am, send nothing" both fall out of this design for free: the 10am check runs once,
// at exactly 10am, and never retries later that day. What happens if the first recap is published
// after 10am is deliberately left undecided per Nina's spec — this doesn't invent a catch-up rule.
//
// Same dryRun/testNow pattern as the other scheduled rules. Deploy: supabase functions deploy send-recap-reminders
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:sonario.au@gmail.com';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  SERVICE_ROLE_KEY,
  { db: { schema: 'sonario' } },
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

async function sendToRecipients(recipients, type, dedupeKeyPrefix, relatedRehearsalId, payload) {
  let sentCount = 0, failedCount = 0, skippedCount = 0;
  await Promise.all(recipients.map(async ({ profile_id: recipientId }) => {
    const dedupeKey = `${dedupeKeyPrefix}:${recipientId}`;
    const { data: claimed } = await supabaseAdmin.rpc('claim_notification_send', {
      p_profile_id: recipientId, p_type: type, p_dedupe_key: dedupeKey,
      p_related_rehearsal_id: relatedRehearsalId,
    });
    if (!claimed) { skippedCount += 1; return; }

    const { data: subs } = await supabaseAdmin.from('push_subscriptions')
      .select('id, endpoint, p256dh, auth').eq('profile_id', recipientId);
    const results = await Promise.all((subs ?? []).map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        return { ok: true };
      } catch (err) {
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
        }
        return { ok: false, statusCode };
      }
    }));
    const anySent = results.some((r) => r.ok);
    if (anySent) sentCount += 1; else failedCount += 1;
    await supabaseAdmin.rpc('finalize_notification_send', {
      p_id: claimed.id, p_status: anySent ? 'sent' : 'failed', p_delivery_result: JSON.stringify(results),
    });
  }));
  return { sentCount, failedCount, skippedCount };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const bearer = authHeader.replace('Bearer ', '').trim();
  const isSystemCaller = bearer === SERVICE_ROLE_KEY.trim();

  if (!isSystemCaller) {
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(bearer);
    if (userError || !userData?.user) return json({ error: 'Not authenticated' }, 401);
    const { data: membership } = await supabaseAdmin
      .from('memberships').select('role').eq('profile_id', userData.user.id).single();
    if (!['admin', 'super'].includes(membership?.role)) {
      return json({ error: 'Only Admins and Super Admins can call this.' }, 403);
    }
  }

  let dryRun = false, testNow = null;
  try {
    const payload = await req.json().catch(() => ({}));
    dryRun = !!payload?.dryRun;
    testNow = payload?.testNow ?? null;
  } catch { /* empty body is fine — cron calls with none */ }
  if (testNow && !dryRun) {
    return json({ error: 'testNow can only be used together with dryRun.' }, 400);
  }

  const { data: nowRow, error: nowError } = await supabaseAdmin.rpc('now_melbourne', { p_at: testNow });
  if (nowError) return json({ error: nowError.message }, 500);
  const melbourneDate = nowRow.slice(0, 10);
  const melbourneMinute = nowRow.slice(11, 16);

  if (melbourneMinute !== '09:00' && melbourneMinute !== '10:00') {
    return json({ ok: true, melbourneNow: nowRow, message: 'Not 9:00am or 10:00am Melbourne time — nothing due.' });
  }

  const { data: yesterday } = await supabaseAdmin.rpc('date_minus_one', { p_date: melbourneDate });

  const { data: rehearsals, error: rehearsalsError } = await supabaseAdmin
    .from('rehearsals').select('id')
    .eq('status', 'scheduled').eq('counts_towards_attendance', true).eq('rehearsal_date', yesterday);
  if (rehearsalsError) return json({ error: rehearsalsError.message }, 500);

  const report = [];
  for (const rehearsal of rehearsals ?? []) {
    const { data: recapRows } = await supabaseAdmin.from('rehearsal_recaps')
      .select('id, published').eq('rehearsal_id', rehearsal.id).eq('published', true).limit(1);
    const hasPublishedRecap = (recapRows ?? []).length > 0;

    if (melbourneMinute === '09:00' && !hasPublishedRecap) {
      const { data: recipients } = await supabaseAdmin.rpc('staff_who_attended', { p_rehearsal_id: rehearsal.id });
      const copy = {
        title: 'Rehearsal recap still needs publishing',
        body: 'Add last night’s recap before it goes out to the choir at 10am.',
      };
      if (dryRun) {
        report.push({ rehearsalId: rehearsal.id, kind: 'admin_nudge', recipientCount: (recipients ?? []).length, copy });
        continue;
      }
      const payload = JSON.stringify({ title: copy.title, body: copy.body, url: '/' });
      const result = await sendToRecipients(
        recipients ?? [], 'recap_admin_reminder', `recap_admin_reminder:${rehearsal.id}`, rehearsal.id, payload,
      );
      report.push({ rehearsalId: rehearsal.id, kind: 'admin_nudge', ...result });
    }

    if (melbourneMinute === '10:00' && hasPublishedRecap) {
      const { data: recipients } = await supabaseAdmin.from('memberships').select('profile_id').eq('status', 'active');
      // Proposed copy — not yet signed off, same as every other member-facing string in this app.
      const copy = { title: 'Rehearsal recap available', body: 'See what happened at last night’s rehearsal.' };
      if (dryRun) {
        report.push({ rehearsalId: rehearsal.id, kind: 'member_send', recipientCount: (recipients ?? []).length, copy });
        continue;
      }
      const payload = JSON.stringify({ title: copy.title, body: copy.body, url: '/' });
      const result = await sendToRecipients(
        recipients ?? [], 'recap_member', `recap_member:${rehearsal.id}`, rehearsal.id, payload,
      );
      report.push({ rehearsalId: rehearsal.id, kind: 'member_send', ...result });
    }
  }

  return json({ ok: true, melbourneNow: nowRow, dryRun, report });
});
