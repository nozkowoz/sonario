// Notify Admin/Super Admin of a new membership request (2026-09-29). Event-triggered — called by
// sonario.notify_new_member_request() (migration 0034) via pg_net the moment a pending
// memberships row is inserted, not on any schedule. One push per admin/super, using the same
// claim/finalize locking primitive every other notification uses, so a retried trigger call can
// never double-send.
//
// Deploy:  supabase functions deploy notify-new-member-request
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

  let profileId;
  try {
    const payload = await req.json();
    profileId = payload?.profileId;
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }
  if (!profileId) return json({ error: 'profileId is required.' }, 400);

  const { data: requester } = await supabaseAdmin
    .from('profiles').select('display_name').eq('id', profileId).single();
  const requesterName = requester?.display_name || 'Someone';

  const { data: recipients, error: recipientsError } = await supabaseAdmin
    .from('memberships').select('profile_id').eq('status', 'active').in('role', ['admin', 'super']);
  if (recipientsError) return json({ error: recipientsError.message }, 500);
  if (!recipients || recipients.length === 0) {
    return json({ ok: true, sentCount: 0, message: 'No active Admins/Super Admins to notify.' });
  }

  // Proposed copy — not yet signed off, same as every other member-facing string in this app.
  const payload = JSON.stringify({
    title: 'New membership request',
    body: `${requesterName} wants to join Sonario.`,
    url: '/',
  });

  let sentCount = 0, failedCount = 0, skippedCount = 0;
  await Promise.all(recipients.map(async ({ profile_id: recipientId }) => {
    const dedupeKey = `new_member_request:${profileId}:${recipientId}`;
    const { data: claimed } = await supabaseAdmin.rpc('claim_notification_send', {
      p_profile_id: recipientId, p_type: 'new_member_request', p_dedupe_key: dedupeKey,
    });
    if (!claimed) { skippedCount += 1; return; } // already sent/in flight

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

  return json({ ok: true, sentCount, failedCount, skippedCount, totalRecipients: recipients.length });
});
