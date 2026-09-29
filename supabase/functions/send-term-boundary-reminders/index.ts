// Term start/end reminders (2026-09-29). One send per term, each way — "choir's back this week"
// the day before the term's actual first eligible rehearsal, "last rehearsal of the term" the day
// before its actual last one. Resolved from real scheduled+attendance-counting rehearsals via
// sonario.term_eligible_rehearsal_bounds() (migration 0037), never from a term's own starts_on/
// ends_on — a cancelled rehearsal at either end is skipped automatically, since it never counts
// as "eligible" in the first place. Leave does NOT suppress this (Nina's explicit rule) — it goes
// to every active member regardless.
//
// Same dryRun/testNow pattern as send-checkin-reminders. Deploy: supabase functions deploy send-term-boundary-reminders
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

function formatTime12h(t) {
  const [hStr, mStr] = t.split(':');
  const h24 = Number(hStr);
  const suffix = h24 < 12 ? 'am' : 'pm';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return mStr === '00' ? `${h12}${suffix}` : `${h12}:${mStr}${suffix}`;
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

  if (melbourneMinute !== '10:00') {
    return json({ ok: true, melbourneNow: nowRow, message: 'Not 10:00am Melbourne time — nothing due.' });
  }

  // "Tomorrow", computed in SQL so there's no local-timezone date-math ambiguity.
  const { data: tomorrowRow } = await supabaseAdmin.rpc('date_plus_one', { p_date: melbourneDate });
  const tomorrow = tomorrowRow;

  const { data: terms, error: termsError } = await supabaseAdmin.from('terms').select('id, name');
  if (termsError) return json({ error: termsError.message }, 500);

  const { data: recipients, error: recipientsError } = await supabaseAdmin
    .from('memberships').select('profile_id').eq('status', 'active');
  if (recipientsError) return json({ error: recipientsError.message }, 500);

  const report = [];
  for (const term of terms ?? []) {
    const { data: bounds } = await supabaseAdmin.rpc('term_eligible_rehearsal_bounds', { p_term_id: term.id });
    const { first_date: firstDate, last_date: lastDate } = bounds?.[0] ?? {};
    if (!firstDate) continue; // no eligible rehearsals in this term at all

    const dueKinds = [];
    if (tomorrow === firstDate) dueKinds.push('start');
    if (tomorrow === lastDate) dueKinds.push('end'); // both can fire same day for a one-rehearsal term

    for (const kind of dueKinds) {
      const targetDate = kind === 'start' ? firstDate : lastDate;
      const { data: rehearsalRows } = await supabaseAdmin.from('rehearsals')
        .select('location, start_time').eq('term_id', term.id).eq('rehearsal_date', targetDate).limit(1);
      const rehearsal = rehearsalRows?.[0];

      const copy = kind === 'start'
        ? {
            title: 'Choir is back this week 🎵',
            body: rehearsal
              ? `Rehearsals return tomorrow at ${formatTime12h(rehearsal.start_time)}. See you at ${rehearsal.location}.`
              : 'Rehearsals return tomorrow.',
          }
        : { title: 'Last rehearsal of the term 🎵', body: 'Tomorrow is our final rehearsal before the break.' };

      if (dryRun) {
        report.push({ termId: term.id, termName: term.name, kind, recipientCount: (recipients ?? []).length, copy });
        continue;
      }

      const payload = JSON.stringify({ title: copy.title, body: copy.body, url: '/' });
      let sentCount = 0, failedCount = 0, skippedCount = 0;
      await Promise.all((recipients ?? []).map(async ({ profile_id: recipientId }) => {
        const dedupeKey = `term_${kind}:${term.id}:${recipientId}`;
        const { data: claimed } = await supabaseAdmin.rpc('claim_notification_send', {
          p_profile_id: recipientId, p_type: `term_${kind}`, p_dedupe_key: dedupeKey,
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
      report.push({ termId: term.id, termName: term.name, kind, sentCount, failedCount, skippedCount });
    }
  }

  return json({ ok: true, melbourneNow: nowRow, dryRun, report });
});
