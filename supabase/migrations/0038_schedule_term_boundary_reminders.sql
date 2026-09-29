-- ============================================================================
-- 0038 — Schedule the live term start/end reminder cron
--
-- Same shape as 0035 (check-in reminders): fires every minute, but send-term-boundary-reminders
-- itself only does anything when the current Melbourne time is exactly 10:00am AND tomorrow is a
-- term's actual first or last eligible rehearsal date. Run this only after a dry run has been
-- checked, same as every other automated rule so far.
-- ============================================================================

select cron.schedule(
  'send-term-boundary-reminders-minutely',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://rwkaofshfatqqkupeqoe.supabase.co/functions/v1/send-term-boundary-reminders',
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
select jobname, schedule, active from cron.job where jobname = 'send-term-boundary-reminders-minutely';
