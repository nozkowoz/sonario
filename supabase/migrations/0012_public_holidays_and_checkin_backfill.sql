-- ============================================================================
-- 0012 — Three small, separately-agreed changes (chat 2026-09-15), bundled into one migration
-- since they were approved together as "Phase 2":
--
--   1. A third rehearsals.status value, 'not_scheduled', for a public holiday that fell on what
--      would have been a rehearsal Tuesday — the choir never planned it, so "cancelled" (which
--      implies something was called off) is the wrong word. Reusable for every future public
--      holiday your term schedule generates, via a new Admin kebab option, not a one-off fix.
--   2. Super-only backfill of past attendance, per member per week — for terms that predate the
--      app. Today there is NO insert policy letting a super create a checkins row for anyone but
--      themselves, and `source` is locked to 'live'/'friend_confirmed' — both close on purpose.
--      Widens `source` to add 'super_backfill' and adds one narrowly-scoped insert policy, plus
--      writes to the existing (currently zero-writer) attendance_corrections audit table.
--   3. Editable check-in time. Nina, 2026-09-15: "I think we don't need it 'verified'" — no
--      separate unverified/guessed state, just a normal UPDATE policy. Migration 0003's
--      server-clock trigger only fires BEFORE INSERT, so this needs no trigger change at all —
--      it was never going to fire on an UPDATE in the first place.
-- ============================================================================

-- --- 1. rehearsals.status: 'not_scheduled' ------------------------------------
-- Same neutral treatment as 'cancelled' everywhere it's read (no coral/alert tint — DESIGN-
-- RULES.md already reserves that for genuine disruption, and this is explicitly not one), but
-- reads as "No rehearsal (public holiday)" rather than "Cancelled".
alter table sonario.rehearsals drop constraint if exists rehearsals_status_check;
alter table sonario.rehearsals add constraint rehearsals_status_check
  check (status in ('scheduled', 'cancelled', 'not_scheduled'));

-- Migration 0003's live check-in policy predates this status and excludes only 'cancelled'
-- (`r.status <> 'cancelled'`) — a rehearsal marked 'not_scheduled' would otherwise still accept a
-- real live check-in, which makes no sense for a rehearsal that never happened. Re-created here as
-- a positive match against 'scheduled' so a future fourth status can't reopen the same gap by
-- being merely forgotten in a blacklist. Logic is otherwise byte-for-byte identical to 0003.
drop policy if exists "members check in to today's event" on sonario.checkins;
create policy "members check in to today's event" on sonario.checkins for insert
  with check (
    sonario.is_active_member()
    and profile_id = auth.uid()
    and source = 'live'
    and exists (
      select 1 from sonario.rehearsals r
      where r.id = rehearsal_id
        and r.status = 'scheduled'
        and r.rehearsal_date = (now() at time zone 'Australia/Melbourne')::date
    )
  );

-- --- 2. Attendance backfill ---------------------------------------------------
alter table sonario.checkins drop constraint if exists checkins_source_check;
alter table sonario.checkins add constraint checkins_source_check
  check (source in ('live', 'friend_confirmed', 'super_backfill'));
-- The table's own existing constraint — `check (source = 'live' or checked_in_at is null)` — is
-- untouched and already forces every 'super_backfill' row to have a null checked_in_at, same as
-- friend_confirmed: there's no real arrival time to record, only "they were there that week".

-- Deliberately narrow: PAST rehearsals only (strictly before today, Melbourne time) — a super
-- "backfilling" today's or a future rehearsal would just be a second way to fake a live check-in,
-- which is exactly what this policy must not open up.
drop policy if exists "super backfills past checkin" on sonario.checkins;
create policy "super backfills past checkin" on sonario.checkins for insert
  with check (
    sonario.is_super()
    and source = 'super_backfill'
    and exists (
      select 1 from sonario.rehearsals r
      where r.id = rehearsal_id
        and r.status = 'scheduled'
        and r.rehearsal_date < (now() at time zone 'Australia/Melbourne')::date
    )
  );

-- A super mis-clicking a week in the import checklist needs a way back out — scoped to
-- source = 'super_backfill' only, so this can never be used to delete a real live check-in
-- (that stays governed by the existing one-hour-window policy from 0003).
drop policy if exists "super removes backfill checkin" on sonario.checkins;
create policy "super removes backfill checkin" on sonario.checkins for delete
  using (sonario.is_super() and source = 'super_backfill');

-- attendance_corrections already exists (migration 0001) with an insert policy for supers, but
-- had zero writers anywhere in the app until now — this is its first real use.

-- --- 3. Editable check-in time -------------------------------------------------
-- Own row or super, matching the "own-row-or-super" shape used throughout this schema. The
-- with-check pins source to stay 'live' — an UPDATE that tried to also change source away from
-- 'live' (e.g. repurposing a backfilled row) is rejected, which is exactly the boundary wanted:
-- this policy edits an existing live check-in's time, it doesn't turn a backfill into one.
drop policy if exists "own or super edits checkin time" on sonario.checkins;
create policy "own or super edits checkin time" on sonario.checkins for update
  using (profile_id = auth.uid() or sonario.is_super())
  with check (source = 'live');

-- ============================================================================
-- Verification — run after applying. Expect every `actual` to equal its `expected`.
-- ============================================================================
select 'rehearsals.status allows not_scheduled' as check_name, '1' as expected,
  (select count(*)::text from pg_constraint
   where conrelid = 'sonario.rehearsals'::regclass and conname = 'rehearsals_status_check'
     and pg_get_constraintdef(oid) like '%not_scheduled%') as actual
union all
select 'checkins.source allows super_backfill', '1',
  (select count(*)::text from pg_constraint
   where conrelid = 'sonario.checkins'::regclass and conname = 'checkins_source_check'
     and pg_get_constraintdef(oid) like '%super_backfill%')
union all
select 'checkins policies (now 5)', '5',
  (select count(*)::text from pg_policies where schemaname = 'sonario' and tablename = 'checkins');

-- ============================================================================
-- Rollback
-- ============================================================================
-- drop policy if exists "own or super edits checkin time" on sonario.checkins;
-- drop policy if exists "super removes backfill checkin" on sonario.checkins;
-- drop policy if exists "super backfills past checkin" on sonario.checkins;
-- alter table sonario.checkins drop constraint if exists checkins_source_check;
-- alter table sonario.checkins add constraint checkins_source_check
--   check (source in ('live', 'friend_confirmed'));
-- alter table sonario.rehearsals drop constraint if exists rehearsals_status_check;
-- alter table sonario.rehearsals add constraint rehearsals_status_check
--   check (status in ('scheduled', 'cancelled'));
