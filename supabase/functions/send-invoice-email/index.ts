// Send invoice email (2026-10-01). The real build behind the Invoice Email Setup wizard — that
// wizard only ever walked someone through generating a Gmail app password and texting it to Nina;
// nothing sent an actual email until now. Admin/Super Admin only, triggered interactively (never
// by a cron), from the invoice detail screen.
//
// The PDF is generated client-side exactly as it already is for "Download PDF invoice" — this
// function never regenerates it, the client hands over the already-built bytes (base64) so the
// PDF-building logic isn't duplicated between the browser and Deno.
//
// Needs two secrets, set once via `supabase secrets set`, never committed:
//   SONARIO_GMAIL_ADDRESS       — the Sonario Gmail address (sonario.au@gmail.com)
//   SONARIO_GMAIL_APP_PASSWORD  — the 16-character app password Sean/whoever generates
//
// Deploy:  supabase functions deploy send-invoice-email
import { createClient } from 'npm:@supabase/supabase-js@2';
// nodemailer (tried first) crashes the whole Deno isolate mid-request here — confirmed via
// function_logs showing "booted" then "shutdown" ~440ms later, no JS error ever reaching this
// file's own try/catch, which the gateway then reports to the client as a bare 503. Nodemailer
// leans on Node's native net/tls socket internals, which Deno's `npm:` compat layer only partially
// polyfills. denomailer is a Deno-native SMTP client built for exactly this case (Gmail app
// passwords from a Deno edge runtime) and doesn't go through that polyfill at all.
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const GMAIL_ADDRESS = Deno.env.get('SONARIO_GMAIL_ADDRESS') ?? 'sonario.au@gmail.com';
const GMAIL_APP_PASSWORD = Deno.env.get('SONARIO_GMAIL_APP_PASSWORD');

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
  if (userError || !userData?.user) return json({ error: 'Not authenticated' }, 401);

  const { data: membership } = await supabaseAdmin
    .from('memberships').select('role').eq('profile_id', userData.user.id).single();
  if (!['admin', 'super'].includes(membership?.role)) {
    return json({ error: 'Only Admins and Super Admins can send an invoice email.' }, 403);
  }
  // Invoicing itself stays Super-Admin-only even though Admins can reach this far — the invoice
  // row they'd be emailing is financial data they have no RLS access to read in the first place,
  // but check explicitly here too rather than relying only on that.
  if (membership.role !== 'super') {
    return json({ error: 'Only Super Admins can send an invoice email.' }, 403);
  }

  if (!GMAIL_APP_PASSWORD) {
    return json({ error: 'Email sending isn’t configured yet — SONARIO_GMAIL_APP_PASSWORD is missing.' }, 500);
  }

  let invoiceId, toEmail, subject, message, pdfBase64, pdfFilename;
  try {
    const payload = await req.json();
    invoiceId = payload?.invoiceId;
    toEmail = (payload?.toEmail ?? '').trim();
    subject = (payload?.subject ?? '').trim();
    message = (payload?.message ?? '').trim();
    pdfBase64 = payload?.pdfBase64;
    pdfFilename = payload?.pdfFilename || 'invoice.pdf';
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }
  if (!invoiceId || !toEmail || !subject || !message || !pdfBase64) {
    return json({ error: 'invoiceId, toEmail, subject, message and pdfBase64 are all required.' }, 400);
  }

  const client = new SMTPClient({
    connection: {
      hostname: 'smtp.gmail.com',
      port: 465,
      tls: true,
      auth: { username: GMAIL_ADDRESS, password: GMAIL_APP_PASSWORD },
    },
  });

  try {
    await client.send({
      from: `Sonario <${GMAIL_ADDRESS}>`,
      to: toEmail,
      subject,
      content: message,
      // `encoding` is required (not optional) on denomailer's attachment type — leaving it out
      // previously meant the PDF bytes got sent corrupted, even though the function itself
      // didn't error. 'base64' matches the shape the client already sends pdfBase64 in.
      attachments: [{ filename: pdfFilename, content: pdfBase64, encoding: 'base64', contentType: 'application/pdf' }],
    });
  } catch (err) {
    return json({ error: `Couldn't send the email: ${String(err?.message ?? err)}` }, 502);
  } finally {
    await client.close();
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('invoices').update({ email_sent_at: new Date().toISOString() }).eq('id', invoiceId).select().maybeSingle();
  if (updateError) return json({ error: updateError.message }, 500);

  return json({ ok: true, invoice: updated });
});
