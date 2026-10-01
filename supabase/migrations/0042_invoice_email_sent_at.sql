-- ============================================================================
-- 0042 — Track when an invoice email was last sent
--
-- Nina's original ask (logged in TODO.md): a manual "Send invoice email" action with an editable
-- message, no reminders/HTML design/tracking beyond this. Nullable, updated by the send-invoice-
-- email Edge Function itself (service role), not by any client write.
-- ============================================================================

alter table sonario.invoices add column if not exists email_sent_at timestamptz;

-- ============================================================================
-- Verification
-- ============================================================================
select 'email_sent_at exists' as check_name, 'true' as expected,
  (exists (select 1 from information_schema.columns
   where table_schema = 'sonario' and table_name = 'invoices' and column_name = 'email_sent_at'))::text;
