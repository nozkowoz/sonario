-- ============================================================================
-- 0041 — Optional reason on "I can't make it"
--
-- Nina, 2026-10-01: wants the option to say why when marking an absence. No reason field has
-- ever existed on rehearsal_absences in this rebuild — the pre-rebuild rehearsal_rsvps had a
-- yes/no/maybe status but no free text either — so this is new, not a restore. Nullable-in-spirit
-- but not-null-with-empty-default, matching away_dates.note/rehearsal_recaps.summary_text's
-- existing convention for optional text in this schema.
-- ============================================================================

alter table sonario.rehearsal_absences add column if not exists reason text not null default '';

-- ============================================================================
-- Verification
-- ============================================================================
select 'reason column exists' as check_name, 'true' as expected,
  (exists (select 1 from information_schema.columns
   where table_schema = 'sonario' and table_name = 'rehearsal_absences' and column_name = 'reason'))::text;
