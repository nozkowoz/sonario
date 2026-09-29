-- ============================================================================
-- 0035 — Schedule the live check-in reminder cron
--
-- Nina, 2026-09-29: proven correct via dry run first (found and fixed two real bugs along the
-- way — a stray whitespace issue in the auth check, and this project using the newer sb_secret_
-- key format rather than the legacy JWT one). Fires every minute; send-checkin-reminders itself
-- only actually does anything when the current Melbourne time matches a real rehearsal's 7:00pm
-- or 7:15pm window, so a minutely cron doesn't mean minutely pushes.
-- ============================================================================

select cron.schedule(
  'send-checkin-reminders-minutely',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://rwkaofshfatqqkupeqoe.supabase.co/functions/v1/send-checkin-reminders',
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
select jobname, schedule, active from cron.job where jobname = 'send-checkin-reminders-minutely';
-- expect: one row, schedule '* * * * *', active = true
