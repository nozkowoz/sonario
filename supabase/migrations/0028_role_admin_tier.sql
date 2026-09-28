-- ============================================================================
-- 0028 — Add 'admin' as a third role, between member and super
--
-- Nina, 2026-09-28: three application roles now exist:
--   member — normal experience, own invoice(s) only
--   admin  — operational choir management (events/attendance/members/repertoire/
--            recordings/recaps/notifications), explicitly NO invoicing/financial access
--   super  — everything admin can do, plus invoicing and role management ("Super Admin" in UI)
--
-- sonario.is_super() stays exactly as it was (role = 'super') — every financial policy already
-- uses it and needs no change. sonario.is_staff() is new: role in ('admin', 'super'), for every
-- OPERATIONAL (non-financial) policy that used to be super-only. 0029 does the mechanical sweep
-- of those; this migration is just the role plumbing + the one policy that can't be a mechanical
-- swap (role changes themselves).
-- ============================================================================

alter table sonario.memberships drop constraint memberships_role_check;
alter table sonario.memberships add constraint memberships_role_check
  check (role = any (array['member', 'admin', 'super']));

create or replace function sonario.is_staff()
returns boolean
language sql stable security definer set search_path to ''
as $$
  select coalesce((select role from sonario.current_membership()) in ('admin', 'super'), false);
$$;

-- --- Membership status vs role — deliberately two different capabilities -----------------
-- "own membership row": widened to is_staff() — admins need to see pending/active/deactivated
-- members to do approvals, same as they already could see everything else operational.
drop policy if exists "own membership row" on sonario.memberships;
create policy "own membership row" on sonario.memberships for select
  using (profile_id = auth.uid() or sonario.is_staff());

-- "super decides memberships" becomes "staff decide membership status" — an admin can approve,
-- decline, deactivate or reactivate. This does NOT by itself protect the `role` column (RLS has
-- no way to compare old vs new column values in one expression) — that protection is the trigger
-- below, which is the actual enforcement point regardless of who issued the UPDATE.
drop policy if exists "super decides memberships" on sonario.memberships;
create policy "staff decide membership status" on sonario.memberships for update
  using (sonario.is_staff() and profile_id <> auth.uid());

-- Belt-and-suspenders: no RLS policy grants column-level restriction, so even though the policy
-- above lets an admin UPDATE a membership row at all, this trigger is what actually stops a role
-- change from ever landing unless the acting session is a real super. Fires on every update,
-- whichever policy or function let the statement through.
create or replace function sonario.memberships_guard_role_change()
returns trigger
language plpgsql security definer set search_path to ''
as $$
begin
  if new.role is distinct from old.role and not sonario.is_super() then
    raise exception 'Only Super Admins may change a member''s role.';
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_guard_role_change on sonario.memberships;
create trigger memberships_guard_role_change
  before update on sonario.memberships
  for each row execute function sonario.memberships_guard_role_change();

-- The one clean, narrow entry point for an actual role change. A super calling this hits the
-- trigger above too (harmlessly — is_super() is true, so it passes) — this function exists for a
-- clear name, a clear error message, and one place this specific action is ever issued from,
-- not because the trigger alone wouldn't already be safe.
create or replace function sonario.set_member_role(p_profile_id uuid, p_role text)
returns sonario.memberships
language plpgsql security definer set search_path to ''
as $$
declare
  result sonario.memberships;
begin
  if not sonario.is_super() then
    raise exception 'Only Super Admins may change a member''s role.';
  end if;
  if p_role not in ('member', 'admin', 'super') then
    raise exception 'Invalid role: %', p_role;
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'You cannot change your own role.';
  end if;

  update sonario.memberships set role = p_role
    where profile_id = p_profile_id
    returning * into result;

  if result.profile_id is null then
    raise exception 'No membership found for that member.';
  end if;
  return result;
end;
$$;

grant execute on function sonario.set_member_role(uuid, text) to authenticated;

-- ============================================================================
-- Verification
-- ============================================================================
select 'admin is a valid role' as check_name, 'true' as expected,
  (select (conname is not null)::text from pg_constraint
   where conrelid = 'sonario.memberships'::regclass and conname = 'memberships_role_check')
union all
select 'is_staff() exists', 'true',
  (exists (select 1 from pg_proc where proname = 'is_staff' and pronamespace = 'sonario'::regnamespace))::text
union all
select 'role-change trigger exists', 'true',
  (exists (select 1 from pg_trigger where tgname = 'memberships_guard_role_change'))::text
union all
select 'set_member_role() exists', 'true',
  (exists (select 1 from pg_proc where proname = 'set_member_role' and pronamespace = 'sonario'::regnamespace))::text;
