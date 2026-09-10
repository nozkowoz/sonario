-- ============================================================================
-- 0006 — Voice parts: Nina's full list, a "standard four", and one part per person per song.
--
-- Set by Nina 2026-09-10, in her own words:
--   "voice part one per person per song"
--   "alto / alto 1 / alto 2 / tenor / tenor 1 / tenor 2 / sop / sop 1 / sop 2 / barry (aka
--    baritone)"
--   "make alto, sop, tenor, barry the standard and then the other ones you can still select but
--    less obvious"
--
-- WHY THIS NEEDS SCHEMA (the three things, stated plainly):
--   1. `sop_1` and `sop_2` don't exist. 0001 seeded numbered Altos and Tenors but not Sops.
--   2. There is no way to tell a standard part from a subdivision, so a picker can't put four
--      forward and tuck six behind a "more" affordance. That's a new column, not a sort order
--      trick: sort order says where a thing goes in a list, not which tier it belongs to.
--   3. "One per person per song" is currently NOT ENFORCED. `song_assignments` has no unique
--      constraint, so nothing but the UI stops a member being written down as both Alto 1 and
--      Tenor 2 on the same song. In this project the database is the boundary and the UI is not,
--      so the rule belongs here.
-- ============================================================================

-- --- 1. Standard vs. subdivision -------------------------------------------
-- `common` rather than `primary` (a reserved-ish word in SQL and misleading — none of these is
-- more correct than another, four are just the ones people pick most).
alter table sonario.part_labels
  add column if not exists common boolean not null default false;

-- --- 2. The full list ------------------------------------------------------
-- Re-stated in full rather than patched, so this file is the readable answer to "what parts does
-- this choir have". Existing keys are updated in place, so no assignment loses its FK target.
--
-- "Barry" is kept as the label because it's what the choir actually says. It means BARITONE —
-- recorded here so nobody later "corrects" it to Baritone thinking it was a typo.
--
-- `full_choir` stays assignable = false: it exists so a RECORDING can be of the whole choir, but
-- a person is never "in" the full choir part. The enforce_assignable_part() trigger from 0001
-- rejects it on song_assignments and that stays true.
insert into sonario.part_labels (key, label, assignable, common, sort_order) values
  ('sop',         'Sop',         true,  true,   1),
  ('alto',        'Alto',        true,  true,   2),
  ('tenor',       'Tenor',       true,  true,   3),
  ('barry',       'Barry',       true,  true,   4),
  ('sop_1',       'Sop 1',       true,  false, 11),
  ('sop_2',       'Sop 2',       true,  false, 12),
  ('alto_1',      'Alto 1',      true,  false, 13),
  ('alto_2',      'Alto 2',      true,  false, 14),
  ('tenor_1',     'Tenor 1',     true,  false, 15),
  ('tenor_2',     'Tenor 2',     true,  false, 16),
  ('full_choir',  'Full choir',  false, false, 99)
on conflict (key) do update set
  label       = excluded.label,
  assignable  = excluded.assignable,
  common      = excluded.common,
  sort_order  = excluded.sort_order;

-- --- 3. One part per person per song ---------------------------------------
-- PARTIAL index, `where archived_at is null`: removal in this table is an archive, not a delete
-- (0001 gives song_assignments no delete policy at all), so a plain unique constraint would make
-- a member's own history block them from ever being reassigned to that song. Only the LIVE
-- assignment has to be unique.
create unique index if not exists song_assignments_one_part_per_person_per_song
  on sonario.song_assignments (song_id, profile_id)
  where archived_at is null;

-- No new policies. `common` is read under the existing "members read song assignments" and
-- "members read part labels" select policies, and the unique index is a constraint rather than a
-- privilege — it applies to every writer including a super, which is the intent.

-- ============================================================================
-- Rollback
-- ============================================================================
-- drop index if exists sonario.song_assignments_one_part_per_person_per_song;
-- alter table sonario.part_labels drop column if exists common;
-- delete from sonario.part_labels where key in ('sop_1', 'sop_2');
--   -- NOTE: that delete fails if any song_assignment references them, which is correct — check
--   -- before forcing it, because the alternative is orphaning somebody's part.
