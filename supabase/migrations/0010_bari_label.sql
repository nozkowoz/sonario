-- ============================================================================
-- 0010 — Rename the "Barry" part label to "Bari"
--
-- Nina, 2026-09-13: change the wording throughout. This reverses the explicit "don't correct
-- Barry, it's what the choir says" rule from migration 0006 and DESIGN-RULES.md — legitimate,
-- since it's the same person who set that rule now changing her mind, not someone "fixing" it
-- without asking.
--
-- The KEY stays `barry` — only the display label changes. Every song_assignments row referencing
-- it, and the enforce_assignable_part()/one-part-per-song machinery, all key off `key`, so nothing
-- else needs to move.
--
-- 0001 and 0006 are NOT edited to say "Bari" — they're the historical record of what those
-- migrations actually did when they ran, and 0006's own comment explaining the old "Barry" choice
-- stays as the true story of that decision. This file is where the change actually lives.
-- ============================================================================

update sonario.part_labels set label = 'Bari' where key = 'barry';

-- ============================================================================
-- Verification
-- ============================================================================
select key, label from sonario.part_labels where key = 'barry';

-- ============================================================================
-- Rollback
-- ============================================================================
-- update sonario.part_labels set label = 'Barry' where key = 'barry';
