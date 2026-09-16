-- ============================================================================
-- 0013 — Add "Other" as a 5th event type
--
-- Nina, 2026-09-16: alongside Rehearsal/Performance/Workshop/Social, add an "Other" category.
-- `event_type` is constrained by a check constraint (from migration 0002), not an enum, so
-- widening it is a simple constraint swap — no data migration needed since no existing row uses
-- a value outside the original four anyway.
-- ============================================================================

alter table sonario.rehearsals drop constraint rehearsals_event_type_check;
alter table sonario.rehearsals add constraint rehearsals_event_type_check
  check (event_type in ('rehearsal', 'workshop', 'performance', 'social', 'other'));

-- ============================================================================
-- Verification
-- ============================================================================
select 'event_type check constraint allows other' as check_name, 'other' as expected,
  (select case when pg_get_constraintdef(oid) ilike '%''other''%' then 'other' else 'MISSING' end
   from pg_constraint where conrelid = 'sonario.rehearsals'::regclass and conname = 'rehearsals_event_type_check') as actual;

-- ============================================================================
-- Rollback
-- ============================================================================
-- alter table sonario.rehearsals drop constraint rehearsals_event_type_check;
-- alter table sonario.rehearsals add constraint rehearsals_event_type_check
--   check (event_type in ('rehearsal', 'workshop', 'performance', 'social'));
