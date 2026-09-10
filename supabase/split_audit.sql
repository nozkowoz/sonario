-- ============================================================================
-- A1 — SPLIT AUDIT.  READ-ONLY.  Run this against the CURRENT (shared) project.
--
-- Purpose: reconcile what is ACTUALLY in the live database against what
-- supabase/migrations/0001..0006 would build. Anything live but not in the
-- migrations is a hand-applied change that a fresh rebuild would silently lose.
-- Live state is the truth; the migrations are the thing being checked.
--
-- This script only SELECTs and only reads system catalogues. It creates
-- nothing, changes nothing, and touches no application data. Safe to run on a
-- project that Page Turners depends on.
--
-- Expected values below were generated from the migration files rather than
-- typed by hand, so they can't drift from what the chain actually does.
--
-- HOW TO USE: run the whole thing. Paste back every row it returns. A clean
-- database returns ONLY the rows whose section starts with 'summary' or
-- 'pageturners' — anything else is a discrepancy worth talking about.
-- ============================================================================

with
expected_tables(name)   as (values ('attendance_confirmation_requests'), ('attendance_corrections'), ('away_dates'), ('checkins'), ('memberships'), ('notification_log'), ('part_labels'), ('profiles'), ('push_subscriptions'), ('recordings'), ('rehearsal_absences'), ('rehearsal_recap_items'), ('rehearsal_recaps'), ('rehearsal_songs'), ('rehearsals'), ('song_assignments'), ('songs'), ('terms')),
expected_funcs(name)    as (values ('current_membership'), ('enforce_assignable_part'), ('enforce_checkin_timestamp'), ('handle_new_auth_user'), ('is_active_member'), ('is_super'), ('member_directory'), ('set_updated_at')),
expected_policies(tbl, name) as (values ('attendance_confirmation_requests','confirmer responds if eligible'), ('attendance_confirmation_requests','members create own requests'), ('attendance_confirmation_requests','members read confirmation requests'), ('attendance_corrections','members read corrections'), ('attendance_corrections','super write corrections'), ('away_dates','members cancel own pending away dates'), ('away_dates','members submit own away dates'), ('away_dates','own away dates or super reads'), ('away_dates','super confirms away dates'), ('checkins','members check in to today''s event'), ('checkins','members undo own checkin within an hour'), ('checkins','own checkin or super reads'), ('memberships','own membership row'), ('memberships','super decides memberships'), ('notification_log','super reads notification log'), ('part_labels','members read part labels'), ('profiles','own profile or super'), ('profiles','update own profile'), ('push_subscriptions','members manage own subscription'), ('recordings','members read recordings'), ('recordings','members upload recordings'), ('recordings','uploader or super deletes recordings'), ('rehearsal_absences','members mark own absence'), ('rehearsal_absences','members reverse own absence'), ('rehearsal_absences','own absence or super reads'), ('rehearsal_recap_items','recap items visibility'), ('rehearsal_recap_items','super manage recap items'), ('rehearsal_recaps','recap visibility'), ('rehearsal_recaps','super manage recaps'), ('rehearsal_songs','members read rehearsal songs'), ('rehearsal_songs','super manage rehearsal songs'), ('rehearsals','members read rehearsals'), ('rehearsals','super manage rehearsals'), ('song_assignments','members manage song assignments'), ('song_assignments','members read song assignments'), ('song_assignments','members update song assignments'), ('songs','members read songs'), ('songs','super manage songs'), ('terms','members read terms'), ('terms','super manage terms')),
expected_triggers(name, tbl) as (values ('checkins_server_timestamp','checkins'), ('rehearsal_recaps_set_updated_at','rehearsal_recaps'), ('rehearsals_set_updated_at','rehearsals'), ('song_assignments_enforce_assignable','song_assignments'), ('songs_set_updated_at','songs')),
expected_realtime(name) as (values ('attendance_confirmation_requests'), ('away_dates'), ('checkins'), ('memberships'), ('recordings'), ('rehearsal_absences'), ('rehearsal_recap_items'), ('rehearsal_recaps'), ('rehearsal_songs'), ('rehearsals'), ('song_assignments'), ('songs')),
expected_indexes(name)  as (values ('attendance_confirmation_requests_rehearsal_id_idx'), ('away_dates_profile_id_idx'), ('away_dates_range_idx'), ('checkins_rehearsal_id_idx'), ('recordings_song_id_idx'), ('rehearsal_absences_rehearsal_id_idx'), ('rehearsal_songs_rehearsal_id_idx'), ('rehearsals_date_idx'), ('rehearsals_event_type_idx'), ('song_assignments_one_part_per_person_per_song'), ('song_assignments_profile_id_idx'), ('song_assignments_song_id_idx')),

live_tables as (
  select table_name::text as name from information_schema.tables
  where table_schema = 'sonario' and table_type = 'BASE TABLE'),
live_funcs as (
  select p.proname::text as name from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'sonario'),
live_policies as (
  select tablename::text as tbl, policyname::text as name from pg_policies
  where schemaname = 'sonario'),
live_triggers as (
  select t.tgname::text as name, c.relname::text as tbl
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'sonario' and not t.tgisinternal),
live_realtime as (
  select tablename::text as name from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'sonario'),
live_indexes as (
  select indexname::text as name from pg_indexes where schemaname = 'sonario'),

-- ---- AM I IN THE RIGHT PROJECT? ------------------------------------------
-- Read this row FIRST. The shared project is the only one with BOTH the `sonario` schema and
-- Page Turners' tables in `public`. North Island Diary has neither. A dedicated Sonario project
-- (once it exists) will have the schema but not books/ratings/meetings. This is a self-contained
-- check that doesn't require reading a project ref off the dashboard.
identity as (
  select 0 as ord, '00: WHICH PROJECT AM I IN?' as section,
         'shared (sonario + page turners)' as expected,
         (case
            when exists (select 1 from pg_namespace where nspname = 'sonario')
             and (select count(*) from information_schema.tables
                  where table_schema = 'public'
                    and table_name in ('books', 'ratings', 'meetings')) = 3
              then 'SHARED PROJECT — correct, carry on'
            when exists (select 1 from pg_namespace where nspname = 'sonario')
              then 'sonario present but Page Turners tables absent — a dedicated Sonario project?'
            when (select count(*) from information_schema.tables
                  where table_schema = 'public'
                    and table_name in ('books', 'ratings', 'meetings')) > 0
              then 'Page Turners present, NO sonario schema — STOP, wrong project'
            else 'NEITHER found — STOP, this is some other project entirely'
          end) as live,
         'if this row does not say SHARED PROJECT, stop and ignore every row below it' as detail
),

-- ---- counts, so a single glance says whether anything is off at all --------
summary as (
  select 1 as ord, 'summary: tables' as section,
         (select count(*)::text from expected_tables) as expected,
         (select count(*)::text from live_tables) as live, '' as detail
  union all select 2, 'summary: functions',
         (select count(*)::text from expected_funcs), (select count(*)::text from live_funcs), ''
  union all select 3, 'summary: policies',
         (select count(*)::text from expected_policies), (select count(*)::text from live_policies), ''
  union all select 4, 'summary: triggers on sonario tables',
         (select count(*)::text from expected_triggers), (select count(*)::text from live_triggers), ''
  union all select 5, 'summary: realtime tables',
         (select count(*)::text from expected_realtime), (select count(*)::text from live_realtime), ''
  union all select 6, 'summary: indexes',
         (select count(*)::text from expected_indexes), (select count(*)::text from live_indexes), ''
  union all select 7, 'summary: rls disabled on a sonario table', '0',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'sonario' and c.relkind = 'r' and not c.relrowsecurity), 'must be 0'
),

-- ---- the grants the migration chain never sets (see report) ---------------
grants as (
  select 10 as ord, 'grant: usage on schema sonario' as section, 'anon, authenticated' as expected,
         -- Read the ACL rather than calling has_schema_privilege(): that function RAISES if the
         -- schema doesn't exist, so pointing this audit at the wrong project would abort the whole
         -- run with a confusing error instead of telling you the schema isn't there. Which is a
         -- mistake this project has already made once.
         coalesce((select string_agg(distinct a.grantee::regrole::text, ', ' order by a.grantee::regrole::text)
                   from pg_namespace n, aclexplode(n.nspacl) a
                   where n.nspname = 'sonario' and a.privilege_type = 'USAGE'
                     and a.grantee::regrole::text in ('anon', 'authenticated')),
                  'MISSING (or no sonario schema in this project)') as live,
         'without this every request fails regardless of RLS' as detail
  union all
  select 11, 'grant: select on sonario tables (authenticated)',
         (select count(*)::text from live_tables),
         (select count(distinct table_name)::text from information_schema.role_table_grants
          where table_schema = 'sonario' and grantee = 'authenticated' and privilege_type = 'SELECT'),
         'expected = live table count'
  union all
  select 12, 'grant: default privileges on schema sonario', 'present',
         coalesce((select 'set' from pg_default_acl a join pg_namespace n on n.oid = a.defaclnamespace
                   where n.nspname = 'sonario' limit 1), 'MISSING'),
         'covers tables created later'
),

-- ---- Page Turners safety: anything on the shared auth surface ------------
pageturners as (
  select 20 as ord, 'pageturners: triggers on auth.users' as section, 'see detail' as expected,
         t.tgname::text as live,
         'function: ' || p.proname || ' in schema ' || fn.nspname as detail
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace fn on fn.oid = p.pronamespace
  where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal
  union all
  select 21, 'pageturners: tables in public schema', 'untouched by this plan',
         (select count(*)::text from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'), 'informational'
  union all
  select 22, 'pageturners: storage buckets in this project', 'informational',
         coalesce((select string_agg(name, ', ' order by name) from storage.buckets), 'none'),
         'if Page Turners uses Storage, the split leaves its buckets where they are'
  union all
  select 23, 'pageturners: anonymous auth users', 'informational',
         (select count(*)::text from auth.users where coalesce(is_anonymous, false)),
         'these are Page Turners visitors and MUST keep working'
  union all
  select 24, 'pageturners: non-anonymous auth users', 'informational',
         (select count(*)::text from auth.users where not coalesce(is_anonymous, false)),
         'Sonario identities plus the 8 seeded fakes'
  union all
  select 25, 'pageturners: seeded fake members still present', 'informational',
         (select count(*)::text from auth.users where id::text like 'f0000000-0000-0000-0000-%'),
         'expect 8 if the seed is still in place'
  union all
  select 26, 'pageturners: functions in public referencing sonario', '0',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prokind = 'f'
            and pg_get_functiondef(p.oid) ilike '%sonario.%'),
         'must be 0 — a public function calling sonario would break when the schema goes'
),

-- ---- discrepancies, both directions --------------------------------------
diff as (
  select 30 as ord, 'MISSING LIVE: table' as section, name as expected, '—' as live,
         'in the migrations but not in the database' as detail
  from expected_tables where name not in (select name from live_tables)
  union all select 31, 'EXTRA LIVE: table', '—', name,
         'in the database but NOT in any migration — a rebuild would lose this'
  from live_tables where name not in (select name from expected_tables)
  union all select 32, 'MISSING LIVE: function', name, '—', 'in the migrations, not in the database'
  from expected_funcs where name not in (select name from live_funcs)
  union all select 33, 'EXTRA LIVE: function', '—', name, 'not in any migration'
  from live_funcs where name not in (select name from expected_funcs)
  union all select 34, 'MISSING LIVE: policy', tbl || ' / ' || name, '—', 'in the migrations, not in the database'
  from expected_policies e where not exists (
    select 1 from live_policies l where l.tbl = e.tbl and l.name = e.name)
  union all select 35, 'EXTRA LIVE: policy', '—', tbl || ' / ' || name,
         'not in any migration — a rebuild would lose this policy'
  from live_policies l where not exists (
    select 1 from expected_policies e where e.tbl = l.tbl and e.name = l.name)
  union all select 36, 'MISSING LIVE: trigger', name || ' on ' || tbl, '—', 'in the migrations, not in the database'
  from expected_triggers e where not exists (
    select 1 from live_triggers l where l.name = e.name and l.tbl = e.tbl)
  union all select 37, 'EXTRA LIVE: trigger', '—', name || ' on ' || tbl, 'not in any migration'
  from live_triggers l where not exists (
    select 1 from expected_triggers e where e.name = l.name and e.tbl = l.tbl)
  union all select 38, 'MISSING LIVE: realtime', name, '—', 'not published for realtime'
  from expected_realtime where name not in (select name from live_realtime)
  union all select 39, 'EXTRA LIVE: realtime', '—', name, 'published but not in any migration'
  from live_realtime where name not in (select name from expected_realtime)
  union all select 40, 'MISSING LIVE: index', name, '—', 'in the migrations, not in the database'
  from expected_indexes where name not in (select name from live_indexes)
  union all select 41, 'EXTRA LIVE: index', '—', name, 'not in any migration (constraint indexes are normal here)'
  from live_indexes where name not in (select name from expected_indexes)
),

-- ---- row counts, so the reseed can be checked afterwards -----------------
rowcounts as (
  select 50 as ord, 'rows: terms' as section, 'informational' as expected,
         (select count(*)::text from sonario.terms) as live, '' as detail
  union all select 51, 'rows: rehearsals (all event types)', 'informational',
         (select count(*)::text from sonario.rehearsals), ''
  union all select 52, 'rows: rehearsals cancelled', 'informational',
         (select count(*)::text from sonario.rehearsals where status = 'cancelled'), ''
  union all select 53, 'rows: profiles', 'informational',
         (select count(*)::text from sonario.profiles), ''
  union all select 54, 'rows: memberships active / super', 'informational',
         (select (count(*) filter (where status = 'active'))::text || ' / ' ||
                 (count(*) filter (where role = 'super'))::text from sonario.memberships), ''
  union all select 55, 'rows: checkins', 'informational',
         (select count(*)::text from sonario.checkins), ''
  union all select 56, 'rows: rehearsal_absences', 'informational',
         (select count(*)::text from sonario.rehearsal_absences), ''
  union all select 57, 'rows: away_dates', 'informational',
         (select count(*)::text from sonario.away_dates), ''
  union all select 58, 'rows: part_labels', '11 after 0006',
         (select count(*)::text from sonario.part_labels), ''
  union all select 59, 'rows: songs / recordings / recaps', '0 / 0 / 0',
         (select count(*)::text from sonario.songs) || ' / ' ||
         (select count(*)::text from sonario.recordings) || ' / ' ||
         (select count(*)::text from sonario.rehearsal_recaps), ''
)

select section, expected, live, detail
from (
  select * from identity union all select * from summary union all select * from grants union all
  select * from pageturners union all select * from diff union all select * from rowcounts
) x
order by ord, section, expected, live;
