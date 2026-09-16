-- ============================================================================
-- 0016 — Close a privilege gap 0015's own verification query caught
--
-- 0015's last check ("sequence not directly usable by authenticated") came back 2, not 0. Root
-- cause, confirmed by reading pg_class.relacl directly: migration 0000's
-- `alter default privileges in schema sonario grant all on sequences to anon, authenticated` (and
-- the matching line for tables) applies automatically to every new sequence/table created in this
-- schema from then on — including everything 0015 created. So despite 0015 explicitly granting
-- only `select, update` on invoice_settings/invoices and `select` on invoice_runs, those grants
-- were purely ADDITIVE on top of privileges anon/authenticated already silently held from
-- creation: full arwdDxtm (insert/select/update/delete/truncate/references/trigger/maintain) on
-- all three tables, and full usage/select/update on invoice_number_seq. GRANT never removes an
-- existing broader privilege — only REVOKE does, and 0015 never revoked anything.
--
-- Practical impact: RLS (enabled on all three tables, with no INSERT or DELETE policy defined on
-- invoice_runs/invoices) still defaults to denying those operations for any non-owner role even
-- with the table grant present — so this was very likely not exploitable for creating fake
-- invoices. But invoice_number_seq is a plain sequence, not a row-level-security object at all:
-- privilege is the ONLY gate Postgres has for it, and that gate was wide open. Any authenticated
-- (arguably even anon) caller could have called nextval()/setval() on it directly via a raw
-- PostgREST/RPC call, desynchronising the "next number to issue" from what
-- initialize_invoice_numbering()/create_invoice_run() believe it to be — exactly the tampering
-- 0015 was written to make impossible.
--
-- Fix: revoke everything from anon on all three tables (it should never have touched billing data
-- at all) and from the sequence entirely, then revoke-and-regrant authenticated back to exactly
-- the narrow set 0015 intended — revoke-then-regrant rather than enumerating exclusions, so this
-- can't miss some other privilege type the same way the first pass did.
-- ============================================================================

revoke all on sonario.invoice_settings, sonario.invoice_runs, sonario.invoices from anon;
revoke all on sonario.invoice_number_seq from anon, authenticated;

revoke all on sonario.invoice_settings from authenticated;
grant select, update on sonario.invoice_settings to authenticated;

revoke all on sonario.invoice_runs from authenticated;
grant select on sonario.invoice_runs to authenticated;

revoke all on sonario.invoices from authenticated;
grant select, update on sonario.invoices to authenticated;

-- ============================================================================
-- Verification — via pg_class.relacl/aclexplode directly, not information_schema. The
-- table-privilege views (role_table_grants, table_privileges) came back empty here even when
-- pg_class.relacl proved real grants existed, seemingly filtered by the querying role's own
-- membership. role_usage_grants (used for the sequence in 0015) did report correctly, but
-- aclexplode is used uniformly below so every check here rests on the same, unambiguous source.
-- ============================================================================
select 'anon has zero privileges on invoice tables/sequence' as check_name, '0' as expected,
  (select count(*)::text
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join lateral aclexplode(c.relacl) a
   join pg_roles r on r.oid = a.grantee
   where n.nspname = 'sonario'
   and c.relname in ('invoice_settings', 'invoice_runs', 'invoices', 'invoice_number_seq')
   and r.rolname = 'anon') as actual
union all
select 'authenticated has zero privileges on invoice_number_seq', '0',
  (select count(*)::text
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join lateral aclexplode(c.relacl) a
   join pg_roles r on r.oid = a.grantee
   where n.nspname = 'sonario' and c.relname = 'invoice_number_seq'
   and r.rolname = 'authenticated') as actual
union all
select 'authenticated has only SELECT on invoice_runs', '0',
  (select count(*)::text
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join lateral aclexplode(c.relacl) a
   join pg_roles r on r.oid = a.grantee
   where n.nspname = 'sonario' and c.relname = 'invoice_runs'
   and r.rolname = 'authenticated' and a.privilege_type <> 'SELECT') as actual
union all
select 'authenticated has only SELECT/UPDATE on invoice_settings + invoices', '0',
  (select count(*)::text
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join lateral aclexplode(c.relacl) a
   join pg_roles r on r.oid = a.grantee
   where n.nspname = 'sonario' and c.relname in ('invoice_settings', 'invoices')
   and r.rolname = 'authenticated' and a.privilege_type not in ('SELECT', 'UPDATE')) as actual;

-- ============================================================================
-- Rollback
-- ============================================================================
-- Not meaningful to roll back to the broken default-privilege state on purpose; if ever needed,
-- re-run the relevant `grant all ... to anon, authenticated` lines by hand.
