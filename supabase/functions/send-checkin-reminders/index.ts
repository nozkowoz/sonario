// Check-in reminders (2026-09-29) — the first automated push rule, built and proven in isolation
// before any of the other five (Nina's explicit order). Two reminders max per rehearsal night, at
// the rehearsal's own start time and 15 minutes after — NOT a hardcoded 19:00/19:15, so this still
// works correctly if a rehearsal is ever scheduled at a different time. Re-evaluates eligibility
// fresh at each window, so checking in between the two reminders correctly drops you off the list
// for the second one — there's no separate "already reminded" state to track.
//
// Called two ways:
//   1. By pg_cron every minute, via pg_net, bearing the service role key — the real live path.
//   2. By an admin/super's own JWT, for dryRun testing (and, if we ever want it, a manual live
//      trigger outside cron). testNow is ONLY honoured together with dryRun — a live send always
//      uses the real clock, so a "test" can never accidentally push real members at a fake time.
//
// Deploy:  supabase functions deploy send-checkin-reminders
// Needs the same service_role grants as every other notification function (0018), plus EXECUTE on
// sonario.checkin_reminder_recipients() / claim_notification_send() / finalize_notification_send()
// for whichever role actually calls them here (service_role — see 0031/0033's grants).
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

// Proposed copy — not yet signed off. Placeholder until Nina approves exact wording, same as
// every other member-facing string in this app.
const COPY = {
  '7pm': { title: 'Check in for rehearsal', body: 'Tap to check in once you’re here tonight.' },
  '715pm': { title: 'Last check-in reminder', body: 'Check in now if you’re at rehearsal.' },
};

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

  // Resolve "now" in Melbourne through Postgres itself, not JS Date math — the one thing that
  // reliably knows about Australia/Melbourne's DST transitions.
  const { data: nowRow, error: nowError } = await supabaseAdmin.rpc('now_melbourne', { p_at: testNow });
  if (nowError) return json({ error: nowError.message }, 500);
  const melbourneDate = nowRow.slice(0, 10);
  const melbourneMinute = nowRow.slice(11, 16); // 'HH:MM'

  const { data: rehearsals, error: rehearsalsError } = await supabaseAdmin
    .from('rehearsals')
    .select('id, start_time')
    .eq('status', 'scheduled')
    .eq('counts_towards_attendance', true)
    .eq('rehearsal_date', melbourneDate);
  if (rehearsalsError) return json({ error: rehearsalsError.message }, 500);

  const dueWindows = [];
  for (const r of rehearsals ?? []) {
    const [h, m] = r.start_time.split(':').map(Number);
    const firstMinute = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const finalTotal = h * 60 + m + 15;
    const finalMinute = `${String(Math.floor(finalTotal / 60) % 24).padStart(2, '0')}:${String(finalTotal % 60).padStart(2, '0')}`;
    if (melbourneMinute === firstMinute) dueWindows.push({ rehearsalId: r.id, window: '7pm' });
    if (melbourneMinute === finalMinute) dueWindows.push({ rehearsalId: r.id, window: '715pm' });
  }

  if (dueWindows.length === 0) {
    return json({ ok: true, melbourneNow: nowRow, dueWindows: [], message: 'No reminder window due right now.' });
  }

  const report = [];
  for (const { rehearsalId, window } of dueWindows) {
    const { data: recipients, error: recipientsError } = await supabaseAdmin
      .rpc('checkin_reminder_recipients', { p_rehearsal_id: rehearsalId });
    if (recipientsError) { report.push({ rehearsalId, window, error: recipientsError.message }); continue; }

    if (dryRun) {
      report.push({ rehearsalId, window, recipientCount: recipients.length, recipients });
      continue;
    }

    const copy = COPY[window];
    let sentCount = 0, failedCount = 0, skippedCount = 0;
    await Promise.all(recipients.map(async ({ profile_id: profileId }) => {
      const dedupeKey = `checkin:${rehearsalId}:${profileId}:${window}`;
      const { data: claimed } = await supabaseAdmin.rpc('claim_notification_send', {
        p_profile_id: profileId, p_type: 'checkin_reminder', p_dedupe_key: dedupeKey,
        p_related_rehearsal_id: rehearsalId,
      });
      if (!claimed) { skippedCount += 1; return; } // already sent/in flight elsewhere

      const { data: subs } = await supabaseAdmin.from('push_subscriptions')
        .select('id, endpoint, p256dh, auth').eq('profile_id', profileId);
      const payload = JSON.stringify({ title: copy.title, body: copy.body, url: '/' });
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
    report.push({ rehearsalId, window, sentCount, failedCount, skippedCount });
  }

  return json({ ok: true, melbourneNow: nowRow, dryRun, report });
});
