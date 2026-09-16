-- ============================================================================
-- 0014 — Social event RSVPs (Going / Not going / Maybe)
--
-- Nina, 2026-09-15/16: `checkin.js`'s AttendanceStatus was defaulting every future event nobody's
-- responded to — including socials — to "You're coming" (rehearsal-style, "everyone's assumed to
-- attend"). Wrong for a social, which is opt-in. Confirmed answer: a genuine three-state RSVP.
--
-- IMPORTANT correction while building this: the pre-existing `useSocialEvents`/`useSocialRsvps`
-- hooks in store.js (never imported anywhere) point at a `social_events`/`social_rsvps` table pair
-- that is dead leftover schema from BEFORE the unified event model (migration 0002) — see
-- 0001_foundation.sql's own note that social_events/social_rsvps were deliberately left untouched
-- from the old pre-rebuild schema.sql, which was never applied to this project. Confirmed live:
-- neither table exists. A social event today is just a `rehearsals` row with event_type='social',
-- so RSVPs have to key off `rehearsal_id` like everything else (checkins, rehearsal_absences), not
-- off the old dead `social_events.id`. Those two dead hooks are removed in the same commit as this
-- migration rather than left to rot further.
--
-- Deliberately UNLIKE rehearsal_absences' privacy rule (0001 §"privacy rule": ordinary members
-- can't see who else can't make a rehearsal). Knowing who else is going is the actual point of a
-- social RSVP — it's opt-in and social, not compulsory attendance tracking — so every active
-- member can read every row here, not just their own.
--
-- One row per (event, member), UPDATEABLE in place: unlike an absence (binary, toggled by
-- insert/delete), an RSVP has three states a member can move between freely (going -> maybe ->
-- not going -> going again), so update is the natural action, not delete-then-reinsert. Delete is
-- still offered for "clear my RSVP back to no answer" (distinct from "not going").
-- ============================================================================

create table if not exists sonario.event_rsvps (
  id uuid primary key default gen_random_uuid(),
  rehearsal_id uuid not null references sonario.rehearsals(id) on delete cascade,
  profile_id uuid not null references sonario.profiles(id) on delete cascade,
  status text not null check (status in ('going', 'not_going', 'maybe')),
  updated_at timestamptz not null default now(),
  unique (rehearsal_id, profile_id)
);

create index if not exists event_rsvps_rehearsal_id_idx on sonario.event_rsvps(rehearsal_id);

drop trigger if exists event_rsvps_set_updated_at on sonario.event_rsvps;
create trigger event_rsvps_set_updated_at before update on sonario.event_rsvps
  for each row execute function sonario.set_updated_at();

alter table sonario.event_rsvps enable row level security;

drop policy if exists "members read event rsvps" on sonario.event_rsvps;
create policy "members read event rsvps" on sonario.event_rsvps for select
  using (sonario.is_active_member());

drop policy if exists "members set own rsvp" on sonario.event_rsvps;
create policy "members set own rsvp" on sonario.event_rsvps for insert
  with check (sonario.is_active_member() and profile_id = auth.uid());

drop policy if exists "members change own rsvp" on sonario.event_rsvps;
create policy "members change own rsvp" on sonario.event_rsvps for update
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists "members clear own rsvp" on sonario.event_rsvps;
create policy "members clear own rsvp" on sonario.event_rsvps for delete
  using (profile_id = auth.uid());

grant all on sonario.event_rsvps to anon, authenticated;

-- --- Realtime ----------------------------------------------------------------
-- Same guarded pattern as 0001/0008 — so a live "3 going, 1 maybe" count updates for everyone
-- looking at the event, not just the person who just RSVP'd.
do $$
declare
  t text;
begin
  foreach t in array array['event_rsvps']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'sonario' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table sonario.%I', t);
    end if;
  end loop;
end $$;

-- ============================================================================
-- Verification
-- ============================================================================
select 'table exists' as check_name, '1' as expected,
  (select count(*)::text from information_schema.tables
   where table_schema = 'sonario' and table_name = 'event_rsvps') as actual
union all
select 'one row per (event, member)', '1',
  (select count(*)::text from pg_indexes where schemaname = 'sonario' and indexname = 'event_rsvps_rehearsal_id_idx')
union all
select 'policies (read + set + change + clear)', '4',
  (select count(*)::text from pg_policies where schemaname = 'sonario' and tablename = 'event_rsvps')
union all
select 'in realtime publication', '1',
  (select count(*)::text from pg_publication_tables where pubname = 'supabase_realtime'
   and schemaname = 'sonario' and tablename = 'event_rsvps');

-- ============================================================================
-- Rollback
-- ============================================================================
-- alter publication supabase_realtime drop table sonario.event_rsvps;
-- drop policy if exists "members clear own rsvp" on sonario.event_rsvps;
-- drop policy if exists "members change own rsvp" on sonario.event_rsvps;
-- drop policy if exists "members set own rsvp" on sonario.event_rsvps;
-- drop policy if exists "members read event rsvps" on sonario.event_rsvps;
-- drop trigger if exists event_rsvps_set_updated_at on sonario.event_rsvps;
-- drop table if exists sonario.event_rsvps;
