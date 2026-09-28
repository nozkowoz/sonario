-- ============================================================================
-- 0033 — Check-in reminder eligibility + scheduling extensions
--
-- First automated push rule (Nina, 2026-09-29), built in isolation before any of the other five.
-- This migration only adds the pure eligibility logic and turns on the extensions a scheduled job
-- needs; it does NOT schedule anything yet — that's a separate step, after a dry run.
--
-- Eligible = active member, not on leave (away_dates covering tonight, pending or confirmed both
-- count — same rule the rest of the app already uses), not marked "can't make it" for THIS
-- rehearsal specifically (rehearsal_absences), not already checked in. Flagging that last one:
-- Nina's spec named away/leave and already-checked-in explicitly; rehearsal_absences wasn't
-- mentioned, but excluding it seemed obviously right (there's no reason to nag someone who
-- already told the choir they're not coming) — say if that's wrong.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The one place "what time is it in Melbourne" gets asked, so both dry-run testing (an injected
-- p_at) and the real live path (the default, actual now()) go through identical logic — no
-- separate JS-side timezone math to drift out of sync with this.
create or replace function sonario.now_melbourne(p_at timestamptz default null)
returns text
language sql stable
as $$
  select to_char(coalesce(p_at, now()) at time zone 'Australia/Melbourne', 'YYYY-MM-DD"T"HH24:MI:SS');
$$;
grant execute on function sonario.now_melbourne(timestamptz) to authenticated, service_role;

create or replace function sonario.checkin_reminder_recipients(p_rehearsal_id uuid)
returns table(profile_id uuid)
language sql stable security definer set search_path to ''
as $$
  select m.profile_id
  from sonario.memberships m
  join sonario.rehearsals r on r.id = p_rehearsal_id
  where m.status = 'active'
    and not exists (
      select 1 from sonario.away_dates a
      where a.profile_id = m.profile_id
        and a.status in ('pending', 'confirmed')
        and r.rehearsal_date between a.starts_on and a.ends_on
    )
    and not exists (
      select 1 from sonario.rehearsal_absences ra
      where ra.rehearsal_id = p_rehearsal_id and ra.profile_id = m.profile_id
    )
    and not exists (
      select 1 from sonario.checkins c
      where c.rehearsal_id = p_rehearsal_id and c.profile_id = m.profile_id
    );
$$;

-- Super-only, matching every other admin-introspection function — lets a dry run be inspected
-- directly in the SQL editor too, not just through the Edge Function's own dry-run mode.
revoke all on function sonario.checkin_reminder_recipients(uuid) from public, anon, authenticated;
grant execute on function sonario.checkin_reminder_recipients(uuid) to authenticated, service_role;

-- ============================================================================
-- Verification
-- ============================================================================
select 'pg_cron enabled' as check_name, 'true' as expected,
  (exists (select 1 from pg_extension where extname = 'pg_cron'))::text
union all
select 'pg_net enabled', 'true',
  (exists (select 1 from pg_extension where extname = 'pg_net'))::text
union all
select 'checkin_reminder_recipients exists', 'true',
  (exists (select 1 from pg_proc where proname = 'checkin_reminder_recipients' and pronamespace = 'sonario'::regnamespace))::text
union all
select 'now_melbourne exists', 'true',
  (exists (select 1 from pg_proc where proname = 'now_melbourne' and pronamespace = 'sonario'::regnamespace))::text;
