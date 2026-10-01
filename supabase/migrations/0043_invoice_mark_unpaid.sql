-- ============================================================================
-- 0043 — Let a super reverse "mark as paid" ("Mark as unpaid"), audited the same way every other
-- status change already is.
--
-- Nina, 2026-10-01: "if a superadmin marks an invoice as paid they should be able to... mark as
-- unpaid, and it should log who did that and when." The logging half of that is already true for
-- EVERY transition today — 0030's trigger writes an append-only sonario.invoice_status_events row
-- (who, when, from, to) no matter which RPC (or even a raw UPDATE) caused it. What's missing is
-- just the transition itself: paid was deliberately terminal in 0030 ("Never allowed: paid ->
-- anything"). This adds exactly one new edge to that state machine, super-only, and a thin RPC to
-- use it — no second audit mechanism, since 0030's already covers it.
-- ============================================================================

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
  elsif old.status = 'paid' and new.status = 'due' then
    if not acting_is_super then raise exception 'Only Super Admins may make this change.'; end if;
  else
    raise exception 'Invalid invoice status transition: % -> %', old.status, new.status;
  end if;

  insert into sonario.invoice_status_events (invoice_id, from_status, to_status, changed_by)
  values (new.id, old.status, new.status, auth.uid());

  return new;
end;
$$;

create or replace function sonario.mark_invoice_unpaid(p_invoice_id uuid)
returns sonario.invoices
language plpgsql security definer set search_path to ''
as $$
declare result sonario.invoices;
begin
  -- payment_confirmed_at/_by are cleared, not kept — they mean "currently confirmed paid", which
  -- stops being true the moment this runs. Who/when THIS reversal happened is recorded exactly
  -- the same way every other transition already is, via the trigger above — not a second pair of
  -- columns duplicating what sonario.invoice_status_events already does.
  update sonario.invoices set status = 'due', payment_confirmed_at = null, payment_confirmed_by = null
    where id = p_invoice_id and status = 'paid'
    returning * into result;
  if result.id is null then raise exception 'Invoice not found or not currently paid.'; end if;
  return result;
end;
$$;
grant execute on function sonario.mark_invoice_unpaid(uuid) to authenticated;

-- ============================================================================
-- Verification
-- ============================================================================
select 'mark_invoice_unpaid exists' as check_name, 'true' as expected,
  (exists (select 1 from pg_proc where pronamespace = 'sonario'::regnamespace
   and proname = 'mark_invoice_unpaid'))::text;
