-- ============================================================================
-- 0021 — first_name/last_name alongside display_name.
--
-- Nina, 2026-09-28: wants new members to explicitly type their first and last name during
-- sign-up, rather than trusting whatever Google's account name happens to be (the WhatsApp roster
-- has plenty of "KJ"/"Livrom"-style names that would make a poor member list). display_name stays
-- the single "name shown everywhere" field — unchanged, still editable, still what every existing
-- query reads — these two are just structured backing data alongside it, editable independently
-- (someone can be "KJ" everywhere in the app while First/Last Name records who they really are).
-- Not required at the database level (both default '') because the sign-up trigger can't ask
-- anyone anything — the requirement is enforced in the UI, on the pending-approval screen.
-- ============================================================================

alter table sonario.profiles
  add column if not exists first_name text not null default '',
  add column if not exists last_name text not null default '';
