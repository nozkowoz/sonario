-- ============================================================================
-- 0026 — Members can read their own invoices, for the member-facing Home fee card,
-- invoice detail screen, and More > My Invoices (2026-09-28, per Nina's spec).
--
-- Additive only. The one existing SELECT policy on sonario.invoices ("super reads invoices")
-- stays exactly as it is — this just adds a second, own-row policy alongside it, same shape
-- already used on profiles ("own profile or super"). No policy on invoice_runs or
-- invoice_settings changes: everything the member screen needs (term/amount/dates/invoice
-- number) already lives directly on the invoices row itself, and term NAMES come from the
-- already member-readable sonario.terms table.
-- ============================================================================

create policy "member reads own invoice" on sonario.invoices
  for select using (profile_id = auth.uid());
