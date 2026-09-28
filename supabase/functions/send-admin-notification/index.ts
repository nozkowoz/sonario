// Admin > Notifications (2026-09-28). Lets a super write a real message and broadcast it as a
// push notification to every member who has notifications turned on — Nina's call: she doesn't
// need a personal "send myself a test" button (send-test-notification's original job), she wants
// the real send-to-everyone feature, and can use a genuine send as the test if she wants to prove
// the pipeline still works.
//
// Same claim/update dedupe pattern as send-test-notification (migration 0017's header), but ONE
// notification_log row per RECIPIENT profile (not per device, not per caller) — someone with two
// devices only gets one log row, "sent" if at least one device received it.
//
// Deploy:  supabase functions deploy send-admin-notification
// Needs the same service_role grants as send-test-notification — see migration
// 0018_grant_service_role.sql. Without it every query below 500s or misreports as "not a super",
// exactly like send-test-notification did before that migration.
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

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace('Bearer ', '');
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return json({ error: 'Not authenticated' }, 401);
  }
  const callerId = userData.user.id;

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('profile_id', callerId)
    .single();
  if (membershipError || membership?.role !== 'super') {
    return json({ error: 'Only super users can send a notification.' }, 403);
  }

  let title, body;
  try {
    const payload = await req.json();
    title = (payload?.title ?? '').trim();
    body = (payload?.body ?? '').trim();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }
  if (!title || !body) {
    return json({ error: 'Both a title and a message are required.' }, 400);
  }

  const { data: subs, error: subsError } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, profile_id, endpoint, p256dh, auth');
  if (subsError) {
    return json({ error: subsError.message }, 500);
  }
  if (!subs || subs.length === 0) {
    return json({ error: 'No members have notifications turned on yet.' }, 400);
  }

  // Group by profile — one log row and one outcome per PERSON, not per device.
  const byProfile = new Map();
  for (const sub of subs) {
    if (!byProfile.has(sub.profile_id)) byProfile.set(sub.profile_id, []);
    byProfile.get(sub.profile_id).push(sub);
  }

  const sentAt = Date.now();
  const logRows = await Promise.all([...byProfile.keys()].map(async (profileId) => {
    const dedupeKey = `admin_broadcast:${sentAt}:${profileId}`;
    const { data: row } = await supabaseAdmin
      .from('notification_log')
      .insert({ profile_id: profileId, type: 'admin_broadcast', dedupe_key: dedupeKey, status: 'pending' })
      .select()
      .single();
    return [profileId, row];
  }));
  const logRowByProfile = new Map(logRows.filter(([, row]) => row).map(([id, row]) => [id, row]));

  const payload = JSON.stringify({ title, body, url: '/' });

  let sentCount = 0;
  let failedCount = 0;
  await Promise.all([...byProfile.entries()].map(async ([profileId, profileSubs]) => {
    const results = await Promise.all(profileSubs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        return { endpoint: sub.endpoint, ok: true };
      } catch (err) {
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
        }
        return { endpoint: sub.endpoint, ok: false, statusCode, message: String(err?.message ?? err) };
      }
    }));
    const anySent = results.some((r) => r.ok);
    if (anySent) sentCount += 1; else failedCount += 1;

    const logRow = logRowByProfile.get(profileId);
    if (logRow) {
      await supabaseAdmin
        .from('notification_log')
        .update({
          status: anySent ? 'sent' : 'failed',
          sent_at: anySent ? new Date().toISOString() : null,
          delivery_result: JSON.stringify(results),
        })
        .eq('id', logRow.id);
    }
  }));

  return json({ ok: sentCount > 0, sentCount, failedCount, totalRecipients: byProfile.size });
});
