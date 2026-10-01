// Invoice-due push reminder (2026-10-01). Nina's spec: fire ON the due date, then weekly after
// that for as long as the invoice stays 'due' — stops the moment it's paid, waived, put on hold,
// or payment_reported (none of those are 'due', so the eligibility query below already excludes
// them). One check time (9am Melbourne) and one audience (the invoice's own member) — no
// admin/member split like recap reminders.
//
// Same dryRun/testNow pattern as the other scheduled rules. Deploy: supabase functions deploy send-invoice-reminders
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

  if (melbourneMinute !== '09:00') {
    return json({ ok: true, melbourneNow: nowRow, message: 'Not 9:00am Melbourne time — nothing due.' });
  }

  const { data: invoices, error: invoicesError } = await supabaseAdmin
    .from('invoices').select('id, profile_id, member_name, due_date, amount_cents, terms(name)')
    .eq('status', 'due').lte('due_date', melbourneDate);
  if (invoicesError) return json({ error: invoicesError.message }, 500);

  const report = [];
  for (const inv of invoices ?? []) {
    const daysOverdue = Math.round((Date.parse(melbourneDate) - Date.parse(inv.due_date)) / 86400000);
    if (daysOverdue !== 0 && daysOverdue % 7 !== 0) continue; // only the due date itself, then weekly anniversaries

    const dedupeKey = `invoice_due:${inv.id}:${melbourneDate}`;
    const termName = inv.terms?.name ?? 'Sonario';
    const copy = daysOverdue === 0
      ? { title: 'Invoice due today', body: `Your ${termName} invoice is due today.` }
      : { title: 'Invoice overdue', body: `Your ${termName} invoice is now ${daysOverdue} days overdue.` };

    if (dryRun) {
      report.push({ invoiceId: inv.id, daysOverdue, copy });
      continue;
    }

    const { data: claimed } = await supabaseAdmin.rpc('claim_notification_send', {
      p_profile_id: inv.profile_id, p_type: 'invoice_due_reminder', p_dedupe_key: dedupeKey,
      p_related_invoice_id: inv.id,
    });
    if (!claimed) { report.push({ invoiceId: inv.id, skipped: true }); continue; }

    const { data: subs } = await supabaseAdmin.from('push_subscriptions')
      .select('id, endpoint, p256dh, auth').eq('profile_id', inv.profile_id);
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
    await supabaseAdmin.rpc('finalize_notification_send', {
      p_id: claimed.id, p_status: anySent ? 'sent' : 'failed', p_delivery_result: JSON.stringify(results),
    });
    report.push({ invoiceId: inv.id, daysOverdue, sent: anySent });
  }

  return json({ ok: true, melbourneNow: nowRow, dryRun, report });
});
