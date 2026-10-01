-- ============================================================================
-- 0045 — Schedule the live invoice-due reminder cron
--
-- Same shape as 0035/0038/0044: fires every minute, but send-invoice-reminders itself only does
-- anything at 9:00am Melbourne time, for an invoice that's due today or overdue in a multiple of
-- 7 days. Nina's spec, 2026-10-01: "due date then weekly afterwards until paid or marked by an
-- admin as on hold etc." — the eligibility query only ever looks at status = 'due', so paid/
-- waived/on_hold/payment_reported invoices are already excluded with no extra logic needed.
-- ============================================================================

select cron.schedule(
  'send-invoice-reminders-minutely',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://rwkaofshfatqqkupeqoe.supabase.co/functions/v1/send-invoice-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================================
-- Verification
-- ============================================================================
select jobname, schedule, active from cron.job where jobname = 'send-invoice-reminders-minutely';
