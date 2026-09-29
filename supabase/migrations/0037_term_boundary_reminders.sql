-- ============================================================================
-- 0037 — Term start/end reminder eligibility
--
-- Nina's spec: resolve from the ACTUAL first/last eligible (scheduled, attendance-counting)
-- rehearsal of a term, never the term's own starts_on/ends_on dates, and skip a cancelled one in
-- favour of the next real one. This helper does exactly that — min/max rehearsal_date among
-- scheduled+counts_towards_attendance rows for a term, which already excludes cancelled/
-- not_scheduled rows entirely, so "the next actual eligible rehearsal" falls out for free.
--
-- Same design choice as check-in reminders: the trigger day is "the day before the real
-- rehearsal date", not a hardcoded day-of-week — this choir's rehearsals happen to be on Tuesdays
-- today (making that day a Monday), but the logic doesn't assume that.
-- ============================================================================

create or replace function sonario.term_eligible_rehearsal_bounds(p_term_id uuid)
returns table(first_date date, last_date date)
language sql stable security definer set search_path to ''
as $$
  select min(rehearsal_date), max(rehearsal_date)
  from sonario.rehearsals
  where term_id = p_term_id and status = 'scheduled' and counts_towards_attendance;
$$;

revoke all on function sonario.term_eligible_rehearsal_bounds(uuid) from public, anon, authenticated;
grant execute on function sonario.term_eligible_rehearsal_bounds(uuid) to authenticated, service_role;

-- Trivial, but keeps date arithmetic in Postgres rather than JS Date math on a plain date string,
-- which is exactly the kind of thing that quietly picks up a timezone bug.
create or replace function sonario.date_plus_one(p_date date)
returns date
language sql stable
as $$
  select p_date + 1;
$$;
grant execute on function sonario.date_plus_one(date) to authenticated, service_role;

-- ============================================================================
-- Verification
-- ============================================================================
select 'term_eligible_rehearsal_bounds exists' as check_name, 'true' as expected,
  (exists (select 1 from pg_proc where proname = 'term_eligible_rehearsal_bounds' and pronamespace = 'sonario'::regnamespace))::text
union all
select 'date_plus_one exists', 'true',
  (exists (select 1 from pg_proc where proname = 'date_plus_one' and pronamespace = 'sonario'::regnamespace))::text;
