-- ============================================================================
-- 0030 — Invoice status/state machine + immutable audit history
--
-- Nina, 2026-09-28. Statuses: due, payment_reported, paid, on_hold, waived.
--
-- The state machine lives in ONE place — a trigger on sonario.invoices — rather than split across
-- RLS policies and application code. RLS can't cleanly express "old status X may become new status
-- Y, but only for this actor", so the trigger below is the actual enforcement boundary AND the
-- audit-log writer, unconditionally, no matter which code path issued the UPDATE. The RPC
-- functions after it are thin, clearly-named wrappers for the client to call — convenience and
-- clear error messages, not the security boundary itself. Even a raw client `.update()` that
-- bypassed every RPC would still hit this trigger and be validated/audited the same way.
--
-- invoice_status_events is intentionally append-only: no update/delete policy exists for anyone,
-- including super — the trigger is the only writer, via its SECURITY DEFINER privilege.
-- ============================================================================

alter table sonario.invoices
  add column status text not null default 'due'
    check (status in ('due', 'payment_reported', 'paid', 'on_hold', 'waived')),
  add column payment_reported_at timestamptz,
  add column payment_confirmed_at timestamptz,
  add column payment_confirmed_by uuid references sonario.profiles(id);

create table sonario.invoice_status_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references sonario.invoices(id) on delete cascade,
  from_status text not null,
  to_status text not null,
  changed_at timestamptz not null default now(),
  changed_by uuid not null references sonario.profiles(id)
);

create index invoice_status_events_invoice_id_idx on sonario.invoice_status_events(invoice_id);

alter table sonario.invoice_status_events enable row level security;

create policy "super reads invoice status events" on sonario.invoice_status_events for select
  using (sonario.is_super());
-- Deliberately no insert/update/delete policy for any role — sonario.invoices_guard_status_transition()
-- is the only writer, and it runs SECURITY DEFINER.

grant select on sonario.invoice_status_events to authenticated;

-- --- The state machine itself ------------------------------------------------------------
-- Allowed transitions, from Nina's spec:
--   member:      due -> payment_reported
--   super:       payment_reported -> paid ("Confirm payment")
--                payment_reported -> due ("Not received")
--                due -> paid ("Mark as paid manually")
--                due <-> on_hold ("Put on hold" / "Resume reminders")
--                due -> waived, on_hold -> waived, payment_reported -> waived
-- Never allowed: paid -> anything, waived -> anything (both terminal in v1).
create or replace function sonario.invoices_guard_status_transition()
returns trigger
language plpgsql security definer set search_path to ''
as $$
declare
  acting_is_super boolean := sonario.is_super();
begin
  if new.status = old.status then
    return new; -- not a status change (e.g. a due_date-only edit) — nothing to validate or log
  end if;

  if old.status = 'due' and new.status = 'payment_reported' then
    if auth.uid() is distinct from old.profile_id then
      raise exception 'Only the invoice''s own member may report payment.';
    end if;
  elsif old.status = 'payment_reported' and new.status in ('paid', 'due', 'waived') then
    if not acting_is_super then raise exception 'Only Super Admins may make this change.'; end if;
  elsif old.status = 'due' and new.status in ('paid', 'on_hold', 'waived') then
    if not acting_is_super then raise exception 'Only Super Admins may make this change.'; end if;
  elsif old.status = 'on_hold' and new.status in ('due', 'waived') then
    if not acting_is_super then raise exception 'Only Super Admins may make this change.'; end if;
  else
    raise exception 'Invalid invoice status transition: % -> %', old.status, new.status;
  end if;

  insert into sonario.invoice_status_events (invoice_id, from_status, to_status, changed_by)
  values (new.id, old.status, new.status, auth.uid());

  return new;
end;
$$;

drop trigger if exists invoices_guard_status_transition on sonario.invoices;
create trigger invoices_guard_status_transition
  before update on sonario.invoices
  for each row execute function sonario.invoices_guard_status_transition();

-- --- Thin RPC wrappers --------------------------------------------------------------------
-- Members get NO raw UPDATE access to invoices at all (deliberately — RLS can't restrict which
-- columns a raw UPDATE touches, and this table now holds real money data). This is the only
-- capability a member has on their own invoice besides reading it.
create or replace function sonario.report_invoice_paid(p_invoice_id uuid)
returns sonario.invoices
language plpgsql security definer set search_path to ''
as $$
declare result sonario.invoices;
begin
  update sonario.invoices set status = 'payment_reported', payment_reported_at = now()
    where id = p_invoice_id and profile_id = auth.uid() and status = 'due'
    returning * into result;
  if result.id is null then
    raise exception 'Invoice not found, not yours, or not currently due.';
  end if;
  return result;
end;
$$;
grant execute on function sonario.report_invoice_paid(uuid) to authenticated;

create or replace function sonario.confirm_invoice_payment(p_invoice_id uuid)
returns sonario.invoices
language plpgsql security definer set search_path to ''
as $$
declare result sonario.invoices;
begin
  update sonario.invoices set status = 'paid',
      payment_confirmed_at = now(), payment_confirmed_by = auth.uid()
    where id = p_invoice_id and status = 'payment_reported'
    returning * into result;
  if result.id is null then raise exception 'Invoice not found or not awaiting confirmation.'; end if;
  return result;
end;
$$;
grant execute on function sonario.confirm_invoice_payment(uuid) to authenticated;

create or replace function sonario.reject_invoice_payment(p_invoice_id uuid)
returns sonario.invoices
language plpgsql security definer set search_path to ''
as $$
declare result sonario.invoices;
begin
  update sonario.invoices set status = 'due', payment_reported_at = null
    where id = p_invoice_id and status = 'payment_reported'
    returning * into result;
  if result.id is null then raise exception 'Invoice not found or not awaiting confirmation.'; end if;
  return result;
end;
$$;
grant execute on function sonario.reject_invoice_payment(uuid) to authenticated;

create or replace function sonario.mark_invoice_paid(p_invoice_id uuid)
returns sonario.invoices
language plpgsql security definer set search_path to ''
as $$
declare result sonario.invoices;
begin
  update sonario.invoices set status = 'paid',
      payment_confirmed_at = now(), payment_confirmed_by = auth.uid()
    where id = p_invoice_id and status = 'due'
    returning * into result;
  if result.id is null then raise exception 'Invoice not found or not currently due.'; end if;
  return result;
end;
$$;
grant execute on function sonario.mark_invoice_paid(uuid) to authenticated;

create or replace function sonario.hold_invoice(p_invoice_id uuid)
returns sonario.invoices
language plpgsql security definer set search_path to ''
as $$
declare result sonario.invoices;
begin
  update sonario.invoices set status = 'on_hold'
    where id = p_invoice_id and status = 'due'
    returning * into result;
  if result.id is null then raise exception 'Invoice not found or not currently due.'; end if;
  return result;
end;
$$;
grant execute on function sonario.hold_invoice(uuid) to authenticated;

create or replace function sonario.resume_invoice(p_invoice_id uuid)
returns sonario.invoices
language plpgsql security definer set search_path to ''
as $$
declare result sonario.invoices;
begin
  update sonario.invoices set status = 'due'
    where id = p_invoice_id and status = 'on_hold'
    returning * into result;
  if result.id is null then raise exception 'Invoice not found or not currently on hold.'; end if;
  return result;
end;
$$;
grant execute on function sonario.resume_invoice(uuid) to authenticated;

create or replace function sonario.waive_invoice(p_invoice_id uuid)
returns sonario.invoices
language plpgsql security definer set search_path to ''
as $$
declare result sonario.invoices;
begin
  update sonario.invoices set status = 'waived'
    where id = p_invoice_id and status in ('due', 'on_hold', 'payment_reported')
    returning * into result;
  if result.id is null then raise exception 'Invoice not found or not in a waivable state.'; end if;
  return result;
end;
$$;
grant execute on function sonario.waive_invoice(uuid) to authenticated;

-- ============================================================================
-- Verification
-- ============================================================================
select 'invoices.status exists' as check_name, 'true' as expected,
  (exists (select 1 from information_schema.columns
   where table_schema = 'sonario' and table_name = 'invoices' and column_name = 'status'))::text
union all
select 'invoice_status_events exists', 'true',
  (exists (select 1 from information_schema.tables
   where table_schema = 'sonario' and table_name = 'invoice_status_events'))::text
union all
select 'transition trigger exists', 'true',
  (exists (select 1 from pg_trigger where tgname = 'invoices_guard_status_transition'))::text
union all
select 'seven RPC functions exist', '7',
  (select count(*)::text from pg_proc where pronamespace = 'sonario'::regnamespace
   and proname in ('report_invoice_paid', 'confirm_invoice_payment', 'reject_invoice_payment',
     'mark_invoice_paid', 'hold_invoice', 'resume_invoice', 'waive_invoice'));
