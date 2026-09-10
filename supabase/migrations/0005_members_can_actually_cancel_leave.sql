-- ============================================================================
-- 0005 — Let a member actually cancel their own pending leave.
--
-- NOT APPLIED YET. Written for review first, per Nina's standing instruction to stop and say
-- what needs a schema change before making one.
--
-- THE BUG. Migration 0001 created this:
--
--   create policy "members cancel own pending away dates" on sonario.away_dates for update
--     using (profile_id = auth.uid() and status = 'pending');
--
-- There is no WITH CHECK. For an UPDATE policy Postgres then applies the USING expression to the
-- NEW row as well as the old one — so the updated row must ALSO satisfy `status = 'pending'`.
-- A member could therefore only change their pending leave into something still pending. The
-- policy named "cancel own pending away dates" structurally could not cancel anything: every
-- attempt failed with "new row violates row-level security policy".
--
-- It had been that way since 0001 and nothing exercised it until the Calendar pass added the
-- first UI that tries. Found by running the full member path end to end — logging leave, watching
-- an overlapping rehearsal flip to "You're away", then cancelling — rather than by reading the
-- policy, which looks correct until you remember what an omitted WITH CHECK does.
--
-- THE FIX. State the check explicitly. USING still restricts WHICH rows a member may touch (their
-- own, and only while pending); WITH CHECK now says what the row is allowed to BECOME.
--
-- `status in ('pending', 'cancelled')` and not simply `true`: a member may cancel their own leave
-- but must not be able to mark it `confirmed`, because confirmation is an organiser's statement
-- about the row, not the member's. `profile_id = auth.uid()` is repeated in the check so leave
-- can't be reassigned to somebody else on the way through.
-- ============================================================================

drop policy if exists "members cancel own pending away dates" on sonario.away_dates;
create policy "members cancel own pending away dates" on sonario.away_dates for update
  using (profile_id = auth.uid() and status = 'pending')
  with check (profile_id = auth.uid() and status in ('pending', 'cancelled'));

-- Note on the neighbouring policy, deliberately left alone:
--
--   create policy "super confirms away dates" on sonario.away_dates for update
--     using (sonario.is_super());
--
-- This has the same omitted-WITH-CHECK shape, but it's harmless here: the implied check is
-- `is_super()`, which is a fact about the caller rather than about the row, so it stays true
-- whatever the update writes. Worth knowing the pattern though — an omitted WITH CHECK is only
-- safe when the USING expression says nothing about the row's own columns.

-- ============================================================================
-- Rollback (restores the broken behaviour, so only if this migration is at fault)
-- ============================================================================
-- drop policy if exists "members cancel own pending away dates" on sonario.away_dates;
-- create policy "members cancel own pending away dates" on sonario.away_dates for update
--   using (profile_id = auth.uid() and status = 'pending');
