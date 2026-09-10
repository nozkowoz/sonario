-- ============================================================================
-- 0000 — The `sonario` schema and the API grants it needs.
--
-- RUN THIS FIRST on a new project, BEFORE 0001. Then run it ONCE MORE after 0006 (see "the
-- sweep" below). It is fully idempotent, so running it twice — or ten times — is safe.
--
-- WHY THIS FILE EXISTS. It was written 2026-09-10 while planning the split onto a dedicated
-- Sonario project (supabase/SPLIT-PLAN.md), and it closes a gap that made the migration chain
-- unable to build this app from scratch:
--
--   * `create schema sonario` lived ONLY in supabase/schema.sql, which HANDOVER.md correctly
--     calls stale. Every table in 0001 is `create table if not exists sonario.…`, so on a fresh
--     project the very first one fails with "schema sonario does not exist".
--
--   * The GRANTS lived only there too, and they matter more. Unlike `public`, a freshly created
--     schema gives the PostgREST API roles nothing. Without these, every request fails 42501
--     "permission denied for schema sonario" REGARDLESS OF RLS — RLS is only consulted once the
--     base grant already allows the operation. The app would look comprehensively broken while
--     every table, policy and function was in fact perfectly correct.
--
-- Neither gap is visible in the current shared project, because both were applied by the old
-- schema.sql before the rebuild. They only appear the moment anyone tries to rebuild Sonario
-- somewhere else — which is exactly what the split does.
--
-- ONE MORE THING THAT IS NOT SQL. The dashboard must also list `sonario` under
-- Settings → API → Data API → Exposed schemas. There is no statement that can do this. Without
-- it PostgREST won't serve the schema at all and every request 404s, because the client is
-- pinned to `db.schema = 'sonario'` (js/supabaseClient.js).
-- ============================================================================

create schema if not exists sonario;

-- --- Base grants -----------------------------------------------------------
-- Both roles, matching what the live shared project already has. `anon` is granted deliberately
-- even though nothing member-facing is readable without a session: PostgREST resolves an
-- unauthenticated request as `anon`, and every table's RLS still denies it. Removing `anon` here
-- would be a behaviour change dressed up as tightening, and RLS is the boundary, not the grant.
grant usage on schema sonario to anon, authenticated;

-- --- Forward-looking defaults ----------------------------------------------
-- Set BEFORE 0001 runs, so all 18 tables it creates pick these up automatically, and so adding a
-- table in a future migration doesn't silently need a manual grant.
--
-- CAVEAT worth knowing: `alter default privileges` applies only to objects created by the role
-- that ran this statement. In the Supabase SQL editor everything runs as `postgres`, so as long
-- as 0000 and 0001-0006 are all pasted into that editor, this holds. If the migrations are ever
-- applied by some other role, the defaults won't apply — which is what the sweep below is for.
alter default privileges in schema sonario grant all on tables to anon, authenticated;
alter default privileges in schema sonario grant all on sequences to anon, authenticated;
alter default privileges in schema sonario grant execute on functions to anon, authenticated;

-- --- The sweep lives in 0007 ---------------------------------------------
-- An earlier draft of this file carried a `grant all on all tables` sweep plus a commented-out
-- block of revokes, with an instruction to run this file a second time after 0006. Both are gone.
-- The sweep and the revokes are now `0007_grant_sweep_and_revokes.sql`, which runs ONCE, LAST,
-- and as real SQL rather than as comments somebody has to notice and uncomment.

-- ============================================================================
-- Rollback
-- ============================================================================
-- There is deliberately no `drop schema` here. Dropping the sonario schema in the SHARED project
-- can break Page Turners sign-in, and the order that makes it safe is documented in
-- SPLIT-PLAN.md §5 Phase E. Do not improvise it from this file.
