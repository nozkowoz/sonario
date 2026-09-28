-- ============================================================================
-- 0018 — Grant `service_role` access to the `sonario` schema.
--
-- 0000_schema_and_grants.sql only ever granted `anon`/`authenticated` — the two roles PostgREST
-- uses for a normal signed-in-user request. Nothing needed `service_role` until Stage A's
-- send-test-notification Edge Function came along, which deliberately uses the service-role key
-- to read/write on behalf of members OTHER than the caller (every subscriber's push subscription,
-- not just their own row) — the same reason RLS is bypassed there. `service_role` does have
-- BYPASSRLS, but that only skips RLS POLICIES — it still needs the base table-level GRANT, and
-- without one PostgREST returned a plain permission-denied, which:
--   * before the 0018-and-earlier schema-path fix, surfaced as a 500 on `push_subscriptions`
--   * after that fix, still 500'd — because push_subscriptions/notification_log still had no
--     service_role grant either
--   * after adding the super-only membership check, surfaced as a MISLEADING 403 "not a super",
--     because the membership SELECT itself failed and got treated as "not found"
-- Same bug class as 0000's original anon/authenticated gap, just on the one role nothing had
-- exercised yet. Idempotent — safe to run more than once.
-- ============================================================================

grant usage on schema sonario to service_role;
grant all on all tables in schema sonario to service_role;
grant all on all sequences in schema sonario to service_role;
grant execute on all functions in schema sonario to service_role;

-- Forward-looking, so a future table/sequence/function added to this schema doesn't silently
-- repeat this gap for service_role the way it did for anon/authenticated before 0000 existed.
alter default privileges in schema sonario grant all on tables to service_role;
alter default privileges in schema sonario grant all on sequences to service_role;
alter default privileges in schema sonario grant execute on functions to service_role;
