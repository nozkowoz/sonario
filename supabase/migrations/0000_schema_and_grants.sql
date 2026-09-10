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

-- --- The sweep -------------------------------------------------------------
-- No-ops on the first run (there is nothing in the schema yet). It exists so that running this
-- file AGAIN after 0006 guarantees every object created in between is granted, whatever role
-- created it and whether or not the defaults above took effect. That second run is the cheap
-- insurance against the single most confusing failure mode this app has.
grant all on all tables in schema sonario to anon, authenticated;
grant all on all sequences in schema sonario to anon, authenticated;
grant execute on all functions in schema sonario to anon, authenticated;

-- NOTE on the security-definer helpers: 0001 deliberately REVOKES execute from public on
-- `handle_new_auth_user`, `set_updated_at`, `enforce_assignable_part` and the membership
-- predicates, then grants execute back to `authenticated` only where a client legitimately calls
-- it. Running the sweep above AFTER 0001 would re-grant execute on all of them to anon and
-- authenticated, undoing those revokes.
--
-- So: if you run this file a second time as the post-0006 sweep, RE-RUN THE REVOKES afterwards.
-- They are idempotent too, and they are gathered here for convenience:
--
--   revoke execute on function sonario.handle_new_auth_user() from public, anon, authenticated;
--   revoke execute on function sonario.set_updated_at() from public, anon, authenticated;
--   revoke execute on function sonario.enforce_assignable_part() from public, anon, authenticated;
--   revoke execute on function sonario.enforce_checkin_timestamp() from public, anon, authenticated;
--   revoke execute on function sonario.current_membership() from public;
--   revoke execute on function sonario.is_super() from public;
--   revoke execute on function sonario.is_active_member() from public;
--   revoke execute on function sonario.member_directory() from public;
--   grant execute on function sonario.current_membership() to authenticated;
--   grant execute on function sonario.is_super() to authenticated;
--   grant execute on function sonario.is_active_member() to authenticated;
--   grant execute on function sonario.member_directory() to authenticated;
--
-- The trigger functions take `from public, anon, authenticated` rather than just `from public`
-- because the sweep granted them explicitly to those two roles, and REVOKE FROM PUBLIC does not
-- remove an explicit grant. Nothing breaks if a client can't execute them — they are invoked by
-- triggers, which run as the table owner.

-- ============================================================================
-- Rollback
-- ============================================================================
-- There is deliberately no `drop schema` here. Dropping the sonario schema in the SHARED project
-- can break Page Turners sign-in, and the order that makes it safe is documented in
-- SPLIT-PLAN.md §5 Phase E. Do not improvise it from this file.
