-- ============================================================================
-- PHASE B VERIFICATION.  READ-ONLY.  Run against the NEW dedicated Sonario project,
-- after 0000 -> 0001..0006 -> 0007 and after the reseed.
--
-- This answers, in order, the five questions Phase B has to report on:
--   1. did every migration run cleanly            -> sections 10-16 (structure)
--   2. do schema/policies/functions/grants match  -> sections 10-16 and 20-23 (grants)
--   3. does the seed data reconcile               -> sections 30-39 (data)
--   4. auth/config differences                    -> sections 40-44
--   5. anything blocking cutover                  -> any row whose `verdict` is not "ok"
--
-- Expected values are generated from the migration files, and account for policies the chain
-- later drops, so they are what the chain LEAVES BEHIND rather than every statement it contains.
--
-- READ THE FIRST ROW FIRST. If it doesn't say NEW SONARIO PROJECT, stop.
-- ============================================================================

with
expected_tables(name)   as (values ('attendance_confirmation_requests'), ('attendance_corrections'), ('away_dates'), ('checkins'), ('memberships'), ('notification_log'), ('part_labels'), ('profiles'), ('push_subscriptions'), ('recordings'), ('rehearsal_absences'), ('rehearsal_recap_items'), ('rehearsal_recaps'), ('rehearsal_songs'), ('rehearsals'), ('song_assignments'), ('songs'), ('terms')),
expected_funcs(name)    as (values ('current_membership'), ('enforce_assignable_part'), ('enforce_checkin_timestamp'), ('handle_new_auth_user'), ('is_active_member'), ('is_super'), ('member_directory'), ('set_updated_at')),
expected_policies(tbl, name) as (values ('attendance_confirmation_requests','confirmer responds if eligible'), ('attendance_confirmation_requests','members create own requests'), ('attendance_confirmation_requests','members read confirmation requests'), ('attendance_corrections','members read corrections'), ('attendance_corrections','super write corrections'), ('away_dates','members cancel own pending away dates'), ('away_dates','members submit own away dates'), ('away_dates','own away dates or super reads'), ('away_dates','super confirms away dates'), ('checkins','members check in to today''s event'), ('checkins','members undo own checkin within an hour'), ('checkins','own checkin or super reads'), ('memberships','own membership row'), ('memberships','super decides memberships'), ('notification_log','super reads notification log'), ('part_labels','members read part labels'), ('profiles','own profile or super'), ('profiles','update own profile'), ('push_subscriptions','members manage own subscription'), ('recordings','members read recordings'), ('recordings','members upload recordings'), ('recordings','uploader or super deletes recordings'), ('rehearsal_absences','members mark own absence'), ('rehearsal_absences','members reverse own absence'), ('rehearsal_absences','own absence or super reads'), ('rehearsal_recap_items','recap items visibility'), ('rehearsal_recap_items','super manage recap items'), ('rehearsal_recaps','recap visibility'), ('rehearsal_recaps','super manage recaps'), ('rehearsal_songs','members read rehearsal songs'), ('rehearsal_songs','super manage rehearsal songs'), ('rehearsals','members read rehearsals'), ('rehearsals','super manage rehearsals'), ('song_assignments','members manage song assignments'), ('song_assignments','members read song assignments'), ('song_assignments','members update song assignments'), ('songs','members read songs'), ('songs','super manage songs'), ('terms','members read terms'), ('terms','super manage terms')),
expected_triggers(name, tbl) as (values ('checkins_server_timestamp','checkins'), ('rehearsal_recaps_set_updated_at','rehearsal_recaps'), ('rehearsals_set_updated_at','rehearsals'), ('song_assignments_enforce_assignable','song_assignments'), ('songs_set_updated_at','songs')),
expected_realtime(name) as (values ('attendance_confirmation_requests'), ('away_dates'), ('checkins'), ('memberships'), ('recordings'), ('rehearsal_absences'), ('rehearsal_recap_items'), ('rehearsal_recaps'), ('rehearsal_songs'), ('rehearsals'), ('song_assignments'), ('songs')),
expected_indexes(name)  as (values ('attendance_confirmation_requests_rehearsal_id_idx'), ('away_dates_profile_id_idx'), ('away_dates_range_idx'), ('checkins_rehearsal_id_idx'), ('recordings_song_id_idx'), ('rehearsal_absences_rehearsal_id_idx'), ('rehearsal_songs_rehearsal_id_idx'), ('rehearsals_date_idx'), ('rehearsals_event_type_idx'), ('song_assignments_one_part_per_person_per_song'), ('song_assignments_profile_id_idx'), ('song_assignments_song_id_idx')),

live_tables as (select table_name::text as name from information_schema.tables
  where table_schema = 'sonario' and table_type = 'BASE TABLE'),
live_funcs as (select p.proname::text as name from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'sonario'),
live_policies as (select tablename::text as tbl, policyname::text as name from pg_policies
  where schemaname = 'sonario'),
live_triggers as (select t.tgname::text as name, c.relname::text as tbl
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'sonario' and not t.tgisinternal),
live_realtime as (select tablename::text as name from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'sonario'),
live_indexes as (select indexname::text as name from pg_indexes where schemaname = 'sonario'),

chk as (
  -- ---- 0. am I in the right place? ---------------------------------------
  select 0 as ord, 'WHICH PROJECT AM I IN?' as check_name,
    'sonario, and NO page turners tables' as expected,
    (case
       when not exists (select 1 from pg_namespace where nspname = 'sonario')
         then 'no sonario schema — 0000 has not run'
       when (select count(*) from information_schema.tables where table_schema = 'public'
             and table_name in ('books','ratings','meetings')) > 0
         then 'STOP — this is the OLD SHARED project'
       else 'NEW SONARIO PROJECT — correct' end)::text as actual,
    (case
       when not exists (select 1 from pg_namespace where nspname = 'sonario') then 'BLOCKER'
       when (select count(*) from information_schema.tables where table_schema = 'public'
             and table_name in ('books','ratings','meetings')) > 0 then 'BLOCKER'
       else 'ok' end) as verdict

  -- ---- 1. structure: did the migrations run cleanly? --------------------
  union all select 10, 'tables', '18', (select count(*)::text from live_tables),
    case when (select count(*) from live_tables) = 18 then 'ok' else 'BLOCKER' end
  union all select 11, 'functions', '8', (select count(*)::text from live_funcs),
    case when (select count(*) from live_funcs) = 8 then 'ok' else 'BLOCKER' end
  union all select 12, 'policies', '40', (select count(*)::text from live_policies),
    case when (select count(*) from live_policies) = 40 then 'ok' else 'BLOCKER' end
  union all select 13, 'triggers on sonario tables', '5', (select count(*)::text from live_triggers),
    case when (select count(*) from live_triggers) = 5 then 'ok' else 'BLOCKER' end
  union all select 14, 'realtime tables', '12', (select count(*)::text from live_realtime),
    case when (select count(*) from live_realtime) = 12 then 'ok' else 'BLOCKER' end
  union all select 15, 'explicit indexes present', '12',
    (select count(*)::text from expected_indexes e where e.name in (select name from live_indexes)),
    case when (select count(*) from expected_indexes e where e.name in (select name from live_indexes)) = 12
         then 'ok' else 'BLOCKER' end
  union all select 16, 'tables with RLS switched off', '0',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'sonario' and c.relkind = 'r' and not c.relrowsecurity),
    case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'sonario' and c.relkind = 'r' and not c.relrowsecurity) = 0
         then 'ok' else 'BLOCKER' end
  union all select 17, 'legacy tables correctly ABSENT', 'none of the 3',
    coalesce((select string_agg(table_name, ', ') from information_schema.tables
              where table_schema = 'sonario'
                and table_name in ('notices','social_events','social_rsvps')), 'none present'),
    case when not exists (select 1 from information_schema.tables where table_schema = 'sonario'
                          and table_name in ('notices','social_events','social_rsvps'))
         then 'ok' else 'review — these were meant to stay behind' end

  -- ---- 2. grants: the failure mode that looks like a broken app ---------
  union all select 20, 'schema usage granted', 'anon, authenticated',
    coalesce((select string_agg(distinct a.grantee::regrole::text, ', ' order by a.grantee::regrole::text)
              from pg_namespace n, aclexplode(n.nspacl) a
              where n.nspname = 'sonario' and a.privilege_type = 'USAGE'
                and a.grantee::regrole::text in ('anon','authenticated')), 'MISSING'),
    case when (select count(distinct a.grantee::regrole::text)
               from pg_namespace n, aclexplode(n.nspacl) a
               where n.nspname = 'sonario' and a.privilege_type = 'USAGE'
                 and a.grantee::regrole::text in ('anon','authenticated')) = 2
         then 'ok' else 'BLOCKER — every request will 42501' end
  union all select 21, 'tables selectable by authenticated', '18',
    (select count(distinct table_name)::text from information_schema.role_table_grants
     where table_schema = 'sonario' and grantee = 'authenticated' and privilege_type = 'SELECT'),
    case when (select count(distinct table_name) from information_schema.role_table_grants
               where table_schema = 'sonario' and grantee = 'authenticated'
                 and privilege_type = 'SELECT') = 18
         then 'ok' else 'BLOCKER — 0007 did not run' end
  union all select 22, 'trigger fns unreachable from the API', '4 of 4',
    (select count(*)::text || ' of 4' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'sonario'
       and p.proname in ('handle_new_auth_user','set_updated_at','enforce_assignable_part','enforce_checkin_timestamp')
       and not has_function_privilege('anon', p.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', p.oid, 'EXECUTE')),
    case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'sonario'
                 and p.proname in ('handle_new_auth_user','set_updated_at','enforce_assignable_part','enforce_checkin_timestamp')
                 and not has_function_privilege('anon', p.oid, 'EXECUTE')
                 and not has_function_privilege('authenticated', p.oid, 'EXECUTE')) = 4
         then 'ok' else 'review — 0007 revokes did not fully apply' end
  union all select 23, 'callable fns are authenticated-only', '4 of 4',
    (select count(*)::text || ' of 4' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'sonario'
       and p.proname in ('current_membership','is_super','is_active_member','member_directory')
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and not has_function_privilege('anon', p.oid, 'EXECUTE')),
    case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'sonario'
                 and p.proname in ('current_membership','is_super','is_active_member','member_directory')
                 and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                 and not has_function_privilege('anon', p.oid, 'EXECUTE')) = 4
         then 'ok' else 'review — 0007 grants did not fully apply' end

  -- ---- 3. seed data reconciliation --------------------------------------
  union all select 30, 'terms', '2', (select count(*)::text from sonario.terms),
    case when (select count(*) from sonario.terms) = 2 then 'ok' else 'review' end
  union all select 31, 'events total', '21', (select count(*)::text from sonario.rehearsals),
    case when (select count(*) from sonario.rehearsals) = 21 then 'ok' else 'review' end
  union all select 32, 'events cancelled (Melbourne Cup)', '1',
    (select count(*)::text from sonario.rehearsals where status = 'cancelled'),
    case when (select count(*) from sonario.rehearsals where status = 'cancelled') = 1 then 'ok' else 'review' end
  union all select 33, 'Term 3 Tuesdays 14 Jul - 15 Sep', '10',
    (select count(*)::text from sonario.rehearsals r join sonario.terms t on t.id = r.term_id
     where t.name like 'Term 3%' and extract(isodow from r.rehearsal_date) = 2),
    case when (select count(*) from sonario.rehearsals r join sonario.terms t on t.id = r.term_id
               where t.name like 'Term 3%' and extract(isodow from r.rehearsal_date) = 2) = 10
         then 'ok' else 'review' end
  union all select 34, 'profiles', '10', (select count(*)::text from sonario.profiles),
    case when (select count(*) from sonario.profiles) = 10 then 'ok' else 'review' end
  union all select 35, 'memberships active', '8',
    (select count(*)::text from sonario.memberships where status = 'active'),
    case when (select count(*) from sonario.memberships where status = 'active') = 8 then 'ok' else 'review' end
  union all select 36, 'memberships super (Nina + 1 seeded fake)', '2',
    (select count(*)::text from sonario.memberships where role = 'super'),
    case when (select count(*) from sonario.memberships where role = 'super') = 2 then 'ok' else 'review' end
  union all select 37, 'Nina check-ins / absences', '7 / 2',
    (select count(*)::text from sonario.checkins) || ' / ' ||
    (select count(*)::text from sonario.rehearsal_absences),
    case when (select count(*) from sonario.checkins) = 7
          and (select count(*) from sonario.rehearsal_absences) = 2 then 'ok' else 'review' end
  union all select 38, 'part_labels (4 common)', '11 / 4',
    (select count(*)::text from sonario.part_labels) || ' / ' ||
    (select count(*)::text from sonario.part_labels where common),
    case when (select count(*) from sonario.part_labels) = 11
          and (select count(*) from sonario.part_labels where common) = 4 then 'ok' else 'BLOCKER — 0006' end
  union all select 39, 'Leave Test is an ORDINARY member', 'active / member',
    coalesce((select m.status || ' / ' || m.role from sonario.profiles p
              join sonario.memberships m on m.profile_id = p.id
              where p.display_name = 'Leave Test'), 'NOT PRESENT'),
    case when exists (select 1 from sonario.profiles p join sonario.memberships m on m.profile_id = p.id
                      where p.display_name = 'Leave Test' and m.status = 'active' and m.role = 'member')
         then 'ok' else 'review — RLS testing needs a true ordinary member' end

  -- ---- 4. auth / config -------------------------------------------------
  union all select 40, 'triggers on auth.users', '1 (on_auth_user_created)',
    coalesce((select string_agg(t.tgname, ', ') from pg_trigger t
              join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal), 'NONE'),
    case when (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
               join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal) = 1
         then 'ok' else 'BLOCKER — signup will not create a profile' end
  union all select 41, 'auth identities: real / anonymous', '9 real + 1 anonymous',
    (select count(*) filter (where not coalesce(is_anonymous,false))::text from auth.users) || ' real + ' ||
    (select count(*) filter (where coalesce(is_anonymous,false))::text from auth.users) || ' anonymous',
    'informational'
  union all select 42, 'Google sign-in used at least once', 'yes',
    case when exists (select 1 from auth.identities where provider = 'google') then 'yes' else 'NOT YET' end,
    case when exists (select 1 from auth.identities where provider = 'google') then 'ok'
         else 'BLOCKER — Google provider unverified' end
  union all select 43, 'storage buckets (should be none yet)', 'none',
    coalesce((select string_agg(name, ', ') from storage.buckets), 'none'), 'informational'
  union all select 44, 'seeded fakes present', '8',
    (select count(*)::text from auth.users where id::text like 'f0000000-0000-0000-0000-%'),
    case when (select count(*) from auth.users where id::text like 'f0000000-0000-0000-0000-%') = 8
         then 'ok' else 'review' end
)
select check_name, expected, actual, verdict
from chk
order by (verdict like 'BLOCKER%') desc, (verdict like 'review%') desc, ord;
