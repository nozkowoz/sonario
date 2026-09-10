-- ============================================================================
-- 0007 — Grant sweep, then restore the security-definer restrictions.
--
-- RUN THIS LAST, after 0006. It replaces the "run 0000 a second time, then apply the revoke
-- block" instruction, and it exists because that instruction had two problems:
--
--   1. The revoke block in 0000 is COMMENTED OUT. Pasting it "as documented" runs nothing —
--      a silent no-op that leaves `anon` and `authenticated` able to execute the trigger
--      functions, which is the opposite of what it looks like it did.
--   2. "Run this file again, in a different position, for a different reason" is an instruction
--      that gets forgotten or done in the wrong order. One file that runs once, last, doesn't.
--
-- End state is identical to doing it by hand correctly. Idempotent: safe to re-run.
--
-- WHY A SWEEP IS NEEDED AT ALL. 0000 sets `alter default privileges` before 0001 creates
-- anything, which covers every object the chain creates — but only for objects created by the
-- SAME ROLE that ran the ALTER. That holds when everything is pasted into the Supabase SQL
-- editor (all `postgres`), and quietly doesn't if the migrations are ever applied some other way.
-- This sweep makes the outcome independent of that.
-- ============================================================================

-- --- 1. Sweep: make sure every object the chain created is reachable -------
grant usage on schema sonario to anon, authenticated;
grant all on all tables in schema sonario to anon, authenticated;
grant all on all sequences in schema sonario to anon, authenticated;
grant execute on all functions in schema sonario to anon, authenticated;

-- --- 2. Take back what the sweep should not have given away ---------------
-- The sweep above is deliberately broad, so it re-grants execute on the security-definer helpers
-- that 0001 carefully locked down. This puts them back.
--
-- `from public, anon, authenticated` rather than just `from public`: REVOKE FROM PUBLIC does not
-- remove an EXPLICIT grant, and step 1 just made explicit grants to both roles.
--
-- The four trigger functions need no client access at all — triggers execute as the table owner,
-- so nothing breaks by making them unreachable from the API. Leaving them reachable would let any
-- authenticated caller invoke a `security definer` function directly, which is worth avoiding
-- even where the function body looks harmless.
revoke execute on function sonario.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function sonario.set_updated_at() from public, anon, authenticated;
revoke execute on function sonario.enforce_assignable_part() from public, anon, authenticated;
revoke execute on function sonario.enforce_checkin_timestamp() from public, anon, authenticated;

-- The membership predicates and the directory RPC ARE called by clients — the first three from
-- inside RLS policies, `member_directory()` directly from the app. So: nothing for `anon`
-- (an unauthenticated caller has no membership to ask about), execute for `authenticated`.
revoke execute on function sonario.current_membership() from public, anon;
revoke execute on function sonario.is_super() from public, anon;
revoke execute on function sonario.is_active_member() from public, anon;
revoke execute on function sonario.member_directory() from public, anon;

grant execute on function sonario.current_membership() to authenticated;
grant execute on function sonario.is_super() to authenticated;
grant execute on function sonario.is_active_member() to authenticated;
grant execute on function sonario.member_directory() to authenticated;

-- --- 3. Prove it, rather than assuming ------------------------------------
-- Expected: the four trigger functions show `-` for both roles, and the four callable ones show
-- `authenticated` only. Anything else and the revokes above did not do what they look like.
select p.proname as function,
       case when has_function_privilege('anon', p.oid, 'EXECUTE') then 'anon' else '-' end as anon,
       case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'authenticated' else '-' end as authenticated,
       case
         when p.proname in ('handle_new_auth_user', 'set_updated_at', 'enforce_assignable_part',
                            'enforce_checkin_timestamp')
           then case when has_function_privilege('anon', p.oid, 'EXECUTE')
                       or has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     then 'WRONG — should be reachable by neither' else 'ok' end
         else case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    and not has_function_privilege('anon', p.oid, 'EXECUTE')
                   then 'ok' else 'WRONG — should be authenticated only' end
       end as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'sonario'
order by verdict desc, p.proname;

-- ============================================================================
-- Rollback
-- ============================================================================
-- Not applicable in any meaningful sense: this file only adjusts grants, and re-running it
-- restores the intended state. To deliberately loosen it again, re-run 0000's sweep alone.
