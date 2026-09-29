-- ============================================================================
-- 0039 — Recap reminder eligibility (admin nudge + member send, built together)
--
-- Two related checks, both keyed off "the morning after an attendance-counting rehearsal":
--   9:00am  — if no published recap exists yet, nudge staff (admin/super) who attended
--   10:00am — if a published recap now exists, tell every active member
-- "Still undecided" per Nina's spec: what happens if the first recap is published after 10am.
-- Deliberately left undecided — the design already just does nothing that day in that case (the
-- 10am check runs once, at 10am, and doesn't retry), which matches "send nothing" without me
-- inventing a catch-up rule.
-- ============================================================================

create or replace function sonario.date_minus_one(p_date date)
returns date
language sql stable
as $$
  select p_date - 1;
$$;
grant execute on function sonario.date_minus_one(date) to authenticated, service_role;

-- Staff who attended a given rehearsal — the admin-reminder audience. "Attended" = has a real
-- checkin row for it (source-agnostic: a live check-in or a super backfill both count as having
-- been there).
create or replace function sonario.staff_who_attended(p_rehearsal_id uuid)
returns table(profile_id uuid)
language sql stable security definer set search_path to ''
as $$
  select m.profile_id
  from sonario.memberships m
  where m.status = 'active' and m.role in ('admin', 'super')
    and exists (
      select 1 from sonario.checkins c
      where c.rehearsal_id = p_rehearsal_id and c.profile_id = m.profile_id
    );
$$;
revoke all on function sonario.staff_who_attended(uuid) from public, anon, authenticated;
grant execute on function sonario.staff_who_attended(uuid) to authenticated, service_role;

-- ============================================================================
-- Verification
-- ============================================================================
select 'date_minus_one exists' as check_name, 'true' as expected,
  (exists (select 1 from pg_proc where proname = 'date_minus_one' and pronamespace = 'sonario'::regnamespace))::text
union all
select 'staff_who_attended exists', 'true',
  (exists (select 1 from pg_proc where proname = 'staff_who_attended' and pronamespace = 'sonario'::regnamespace))::text;
