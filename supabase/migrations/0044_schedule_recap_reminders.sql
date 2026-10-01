-- ============================================================================
-- 0044 — Schedule the live recap-reminder cron
--
-- Same shape as 0035/0038 (check-in / term-boundary reminders): fires every minute, but
-- send-recap-reminders itself only does anything at exactly 9:00am (admin nudge, no published
-- recap yet) or 10:00am (member send, a published recap now exists) Melbourne time, for a
-- rehearsal that happened yesterday. Run a dry run first — see the SQL in this migration's own
-- PR/chat for the exact snippet — same as every other automated rule so far.
-- ============================================================================

select cron.schedule(
  'send-recap-reminders-minutely',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://rwkaofshfatqqkupeqoe.supabase.co/functions/v1/send-recap-reminders',
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
select jobname, schedule, active from cron.job where jobname = 'send-recap-reminders-minutely';
