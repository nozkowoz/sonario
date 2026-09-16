// Push notifications, Stage A verification. Lets the CALLER trigger a push to their own
// device(s) so the whole pipeline can be proven end to end — opt-in -> subscription stored ->
// this function sends -> service worker receives -> notification displays -> tap focuses/opens
// Sonario -> notification_log records the outcome — before any real rule (Stage B: check-in
// reminders, lyrics release, event changes) gets wired up. Nina, 2026-09-17: "prove one boring
// test push end-to-end... you'll know whether a failure is push infrastructure or rule logic."
//
// Exercises the exact claim/update dedupe pattern every future rule will use (see migration
// 0017's header for the full reasoning), even though a manual test press has no real duplicate to
// guard against — each press is deliberately a fresh logical notification, keyed by timestamp.
//
// Deploy:  supabase functions deploy send-test-notification
// Secrets (supabase secrets set ...): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// (mailto:sonario.au@gmail.com). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are already provided
// to every Edge Function automatically — never set those manually.
//
// UNTESTED — written against Supabase's documented pattern for npm: specifiers in Edge Functions,
// but this repo has no working Supabase CLI/Docker setup to actually invoke it locally. The one
// part most likely to need adjustment on first real deploy is the `npm:web-push` import itself —
// if Deno's npm compatibility layer chokes on it, the fallback is signing the VAPID JWT and
// building the encrypted payload by hand using Deno's native Web Crypto API instead of this
// library, which is more code but has zero Node-compat dependency.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:sonario.au@gmail.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { db: { schema: 'sonario' } },
);

// Edge Functions send NO CORS headers by default. A browser calling this via
// supabase.functions.invoke() first sends an OPTIONS preflight; with nothing here to answer it,
// the browser blocks the real request before it ever reaches this code, and supabase-js reports
// that generically as "Failed to send a request to the Edge Function" — not a 401/500/network
// error, just silence. This was missing on first deploy; every response below now carries these.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Identify the caller from their own JWT (supabase.functions.invoke() from the client sends
  // this automatically) — never trust a client-supplied profile id for who gets notified.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace('Bearer ', '');
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return json({ error: 'Not authenticated' }, 401);
  }
  const profileId = userData.user.id;

  const { data: subs, error: subsError } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('profile_id', profileId);
  if (subsError) {
    return json({ error: subsError.message }, 500);
  }
  if (!subs || subs.length === 0) {
    return json({ error: 'No push subscription found for this device yet.' }, 400);
  }

  // Claim step. The unique(dedupe_key) constraint on notification_log is what makes this an
  // atomic claim under concurrent invocations — see migration 0017.
  const dedupeKey = `test:${profileId}:${Date.now()}`;
  const { data: logRow, error: logInsertError } = await supabaseAdmin
    .from('notification_log')
    .insert({ profile_id: profileId, type: 'test', dedupe_key: dedupeKey, status: 'pending' })
    .select()
    .single();
  if (logInsertError || !logRow) {
    return json({ error: 'Could not claim a notification log row.' }, 500);
  }

  const payload = JSON.stringify({
    title: 'Sonario test notification',
    body: 'If you can see this, push notifications are working.',
    url: '/',
  });

  const results = await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      return { endpoint: sub.endpoint, ok: true };
    } catch (err) {
      const statusCode = err?.statusCode;
      // 404/410 = the push service says this subscription is gone for good. Remove just this
      // row — push_subscriptions is unique per endpoint, so this never touches the member's
      // other devices.
      if (statusCode === 404 || statusCode === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
      }
      return { endpoint: sub.endpoint, ok: false, statusCode, message: String(err?.message ?? err) };
    }
  }));

  const anySent = results.some((r) => r.ok);
  await supabaseAdmin
    .from('notification_log')
    .update({
      status: anySent ? 'sent' : 'failed',
      sent_at: anySent ? new Date().toISOString() : null,
      delivery_result: JSON.stringify(results),
    })
    .eq('id', logRow.id);

  return json({ ok: anySent, results }, anySent ? 200 : 502);
});
