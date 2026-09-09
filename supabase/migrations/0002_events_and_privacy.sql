-- Checkpoint 4 prep: unified event model + away_dates privacy correction.
--
-- Two independent, additive changes agreed after the product/UX handoff review:
--
-- 1. Unified event model (decision 2). `rehearsals` becomes the one table for every event type
--    the choir schedules (rehearsal/workshop/performance/social), with `counts_towards_attendance`
--    as an independent per-event flag rather than a second parallel events table. The table keeps
--    its existing name and every existing FK (checkins.rehearsal_id, rehearsal_absences.rehearsal_id,
--    rehearsal_songs.rehearsal_id, attendance_confirmation_requests.rehearsal_id,
--    attendance_corrections.rehearsal_id) rather than a full rename — nobody's using the app yet so
--    a rename is low-risk mechanically, but it would touch seven FK-bearing tables and every RLS
--    policy/query built against them for zero functional gain at MVP stage. "Rehearsal" in code/UI
--    now means "event" generically; a follow-up rename is possible later if it ever earns its cost.
--
-- 2. Away dates privacy correction (decision 3). The original brief's public away-calendar spec is
--    superseded: individual away dates must not be visible choir-wide. Tightened to the same
--    own-row-or-super pattern already applied to checkins/rehearsal_absences in Checkpoint 2.

alter table sonario.rehearsals
  add column if not exists event_type text not null default 'rehearsal'
    check (event_type in ('rehearsal', 'workshop', 'performance', 'social')),
  add column if not exists counts_towards_attendance boolean not null default true,
  add column if not exists title text,
  add column if not exists description text not null default '';

create index if not exists rehearsals_event_type_idx on sonario.rehearsals(event_type);

drop policy if exists "members read away dates" on sonario.away_dates;
create policy "own away dates or super reads" on sonario.away_dates for select
  using (profile_id = auth.uid() or sonario.is_super());

-- ============================================================================
-- Rollback (run manually if this migration needs to be reverted)
-- ============================================================================
-- alter table sonario.rehearsals
--   drop column if exists event_type,
--   drop column if exists counts_towards_attendance,
--   drop column if exists title,
--   drop column if exists description;
-- drop index if exists sonario.rehearsals_event_type_idx;
-- drop policy if exists "own away dates or super reads" on sonario.away_dates;
-- create policy "members read away dates" on sonario.away_dates for select
--   using (sonario.is_active_member());
