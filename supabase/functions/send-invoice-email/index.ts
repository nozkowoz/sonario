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
import nodemailer from 'npm:nodemailer@6.9.14';

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

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: GMAIL_ADDRESS, pass: GMAIL_APP_PASSWORD },
  });

  try {
    await transporter.sendMail({
      from: `Sonario <${GMAIL_ADDRESS}>`,
      to: toEmail,
      subject,
      text: message,
      attachments: [{ filename: pdfFilename, content: pdfBase64, encoding: 'base64' }],
    });
  } catch (err) {
    return json({ error: `Couldn't send the email: ${String(err?.message ?? err)}` }, 502);
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('invoices').update({ email_sent_at: new Date().toISOString() }).eq('id', invoiceId).select().maybeSingle();
  if (updateError) return json({ error: updateError.message }, 500);

  return json({ ok: true, invoice: updated });
});
