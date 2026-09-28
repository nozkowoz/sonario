-- NOT a migration to apply — adversarial test script for 0028-0031. Runs entirely inside
-- begin/rollback: creates temporary fake auth.users/profiles/memberships rows for a member and an
-- admin, reuses the real profile for super-role checks, and undoes everything at the end.
begin;

insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'test-member@example.com'),
  ('a2222222-2222-2222-2222-222222222222', 'test-admin@example.com');

update sonario.memberships set status = 'active'
  where profile_id in ('a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222');

insert into sonario.invoice_runs (id, term_id, invoice_date, due_date, fee_cents, created_by)
values ('a3333333-3333-3333-3333-333333333333', 'a0000000-0000-0000-0000-000000002603',
  current_date, current_date + 14, 22000, 'bfe5db43-2a4a-4bf0-a1b3-881b180b6246');

insert into sonario.invoices (id, invoice_run_id, invoice_number, term_id, profile_id,
    member_name, member_email, amount_cents, invoice_date, due_date, created_by)
values ('a4444444-4444-4444-4444-444444444444', 'a3333333-3333-3333-3333-333333333333', 999999,
  'a0000000-0000-0000-0000-000000002603', 'a1111111-1111-1111-1111-111111111111',
  'Test Member', 'test-member@example.com', 22000, current_date, current_date + 14,
  'bfe5db43-2a4a-4bf0-a1b3-881b180b6246');

set local role authenticated;

set local request.jwt.claim.sub = 'bfe5db43-2a4a-4bf0-a1b3-881b180b6246';
select (sonario.set_member_role('a2222222-2222-2222-2222-222222222222', 'admin')).role;
-- check 0, expect admin

set local request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';
select sonario.set_member_role('a2222222-2222-2222-2222-222222222222', 'super');
-- check 1, expect error, member cannot set roles

set local request.jwt.claim.sub = 'a2222222-2222-2222-2222-222222222222';
select sonario.set_member_role('a1111111-1111-1111-1111-111111111111', 'admin');
-- check 2, expect error, admin cannot set roles

select count(*) from sonario.memberships;
-- check 3, expect at least 3, admin can read memberships

select count(*) from sonario.invoices where id = 'a4444444-4444-4444-4444-444444444444';
-- check 4, expect 0, admin cannot read invoices

select count(*) from sonario.invoice_runs where id = 'a3333333-3333-3333-3333-333333333333';
-- check 5, expect 0, admin cannot read invoice runs

set local request.jwt.claim.sub = 'bfe5db43-2a4a-4bf0-a1b3-881b180b6246';
select sonario.set_member_role('bfe5db43-2a4a-4bf0-a1b3-881b180b6246', 'admin');
-- check 6, expect error, cannot change own role

select (sonario.set_member_role('a1111111-1111-1111-1111-111111111111', 'admin')).role;
-- check 7, expect admin

set local request.jwt.claim.sub = 'a2222222-2222-2222-2222-222222222222';
update sonario.memberships set role = 'super' where profile_id = 'a1111111-1111-1111-1111-111111111111';
-- check 8, expect error, trigger blocks this even as a raw update

set local request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';
select (sonario.report_invoice_paid('a4444444-4444-4444-4444-444444444444')).status;
-- check 9, expect payment_reported

set local request.jwt.claim.sub = 'bfe5db43-2a4a-4bf0-a1b3-881b180b6246';
select from_status, to_status from sonario.invoice_status_events
  where invoice_id = 'a4444444-4444-4444-4444-444444444444';
-- check 10, expect one row, due to payment_reported

set local request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';
select sonario.report_invoice_paid('a4444444-4444-4444-4444-444444444444');
-- check 11, expect error, already reported

set local request.jwt.claim.sub = 'a2222222-2222-2222-2222-222222222222';
select sonario.confirm_invoice_payment('a4444444-4444-4444-4444-444444444444');
-- check 12, expect error, admin cannot confirm payment

set local request.jwt.claim.sub = 'bfe5db43-2a4a-4bf0-a1b3-881b180b6246';
select (sonario.confirm_invoice_payment('a4444444-4444-4444-4444-444444444444')).status;
-- check 13, expect paid

select sonario.waive_invoice('a4444444-4444-4444-4444-444444444444');
-- check 14, expect error, paid is terminal

select from_status, to_status from sonario.invoice_status_events
  where invoice_id = 'a4444444-4444-4444-4444-444444444444' order by changed_at;
-- check 15, expect two rows in order, due to payment_reported, payment_reported to paid

set local role postgres;

select (sonario.claim_notification_send(
  'a1111111-1111-1111-1111-111111111111', 'test_rule', 'test-dedupe-key-1')).status;
-- check 16, expect pending

select sonario.claim_notification_send(
  'a1111111-1111-1111-1111-111111111111', 'test_rule', 'test-dedupe-key-1') is null as correctly_refused;
-- check 17, expect true

select id into temp table _claimed_id from sonario.notification_log where dedupe_key = 'test-dedupe-key-1';
select (sonario.finalize_notification_send((select id from _claimed_id), 'sent')).status;
-- check 18, expect sent

select sonario.claim_notification_send(
  'a1111111-1111-1111-1111-111111111111', 'test_rule', 'test-dedupe-key-1') is null as correctly_refused;
-- check 19, expect true, sent keys cannot be reclaimed

select (sonario.claim_notification_send(
  'a1111111-1111-1111-1111-111111111111', 'test_rule', 'test-dedupe-key-2')).status;
-- check 20, expect pending

update sonario.notification_log set status = 'failed' where dedupe_key = 'test-dedupe-key-2';
select (sonario.claim_notification_send(
  'a1111111-1111-1111-1111-111111111111', 'test_rule', 'test-dedupe-key-2')).status;
-- check 21, expect pending, failed keys can be reclaimed

update sonario.notification_log set claimed_at = now() - interval '20 minutes'
  where dedupe_key = 'test-dedupe-key-2';
select (sonario.claim_notification_send(
  'a1111111-1111-1111-1111-111111111111', 'test_rule', 'test-dedupe-key-2')).status;
-- check 22, expect pending, stale claims can be reclaimed

rollback;
