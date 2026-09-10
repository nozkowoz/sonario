-- ============================================================================
-- PHASE B — recreate the test identities in the NEW Sonario project.
--
-- Run AFTER 0007 and AFTER Nina has signed in with Google at least once.
-- Order matters, and step 1 is not SQL.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1 (NOT SQL): make Nina a super.
--
-- Her auth.users row only exists once she has signed in with Google against the NEW project. The
-- signup trigger will have created her profile and a `pending` membership automatically. This
-- promotes it. The id is LOOKED UP rather than assumed — never paste a guessed UUID.
-- ----------------------------------------------------------------------------
update sonario.memberships m
set status = 'active', role = 'super', decided_at = now(), decided_by = m.profile_id
where m.profile_id = (select id from auth.users
                      where email = 'ninakowalski1997@gmail.com' and not coalesce(is_anonymous, false))
returning m.profile_id, m.status, m.role;
-- EXPECT ONE ROW BACK. Zero rows means she hasn't signed in yet, or the email differs — stop and
-- check, don't retry blindly. (Yes, `decided_by` is herself. Somebody has to be first.)

-- ----------------------------------------------------------------------------
-- STEP 2 (NOT SQL): create the Leave Test identity.
--
-- Nina asked for "a dedicated non-super identity for testing RLS, leave and normal-member
-- behaviour", and confirmed it does NOT need the old UUID.
--
-- In a private browser window, on the deployed app pointed at the NEW project, open the console:
--
--     await supabase.auth.signInAnonymously()
--
-- then read the id:
--
--     (await supabase.auth.getUser()).data.user.id
--
-- WHY THIS IS MANUAL: migration 0004 makes the signup trigger SKIP anonymous identities, so no
-- profile or membership is created for it. That was the fix for Page Turners' visitors filling
-- Sonario's approval queue. The side effect is that an anonymous test identity now needs its rows
-- inserted by hand — which HANDOVER §9 already documents, and which is arguably better: the
-- identity exists because a test asked for it, not as a side effect of signing in.
-- ----------------------------------------------------------------------------

-- STEP 3: paste the anonymous uuid from step 2 into BOTH places below.
insert into sonario.profiles (id, display_name, google_email)
values ('PASTE-ANON-UUID-HERE', 'Leave Test', '')
on conflict (id) do nothing;

insert into sonario.memberships (profile_id, status, role, decided_at)
values ('PASTE-ANON-UUID-HERE', 'active', 'member', now())
on conflict (profile_id) do update set status = 'active', role = 'member';
-- `role = 'member'`, deliberately and explicitly. The whole point of this identity is that it is
-- NOT a super — if it were, every "verified as a plain member" RLS result obtained with it would
-- be worthless.

-- ----------------------------------------------------------------------------
-- STEP 4: the seed and fabricated data, in this order. Each is a separate file.
--
--   supabase/real_schedule_2026.sql      -- terms + all 21 events (generated, deterministic)
--   supabase/seed_test_data.sql          -- the 8 fake members (fixed f0000000-… uuids)
--   supabase/dev_my_attendance_term3.sql -- Nina's Term 3 check-ins and absences
--
-- real_schedule FIRST: the attendance script needs the events to exist.
-- dev_my_attendance LAST: it looks Nina up by email, so it self-heals to her new uuid without
-- anything being edited.
--
-- Both seed files are marked "delete before the choir uses this for real" and carry teardown
-- blocks. Nina has confirmed she wants them in the new project for testing Home, My Term,
-- Calendar, Attendance and Admin.
-- ----------------------------------------------------------------------------

-- STEP 5: confirm who exists, and that Leave Test is not a super.
select p.display_name,
       coalesce(nullif(p.google_email, ''), '(none)') as email,
       m.status, m.role,
       case
         when p.id::text like 'f0000000-0000-0000-0000-%' then 'seeded fake'
         when u.is_anonymous then 'anonymous test identity'
         else 'real sign-in'
       end as kind
from sonario.profiles p
left join sonario.memberships m on m.profile_id = p.id
left join auth.users u on u.id = p.id
order by (m.role = 'super') desc, kind, p.display_name;
-- EXPECT: 10 rows. 2 supers (Nina, and the seeded fake Marguerite Okafor). Leave Test as
-- active/member. Callum pending, Rowan deactivated.
