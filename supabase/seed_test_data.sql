-- ============================================================================
-- Sonario — test MEMBERS (test data, not real content)
--
-- This used to seed invented terms, events, absences and check-ins as well. It doesn't any more:
-- the real schedule lives in `supabase/real_schedule_2026.sql` (Victorian school terms, Tuesdays,
-- EASTMINT), and having a second set of made-up events sitting alongside the real calendar was
-- worse than useless. What's left is eight fake people, which is the part that's still genuinely
-- handy: it's the only way to see the approval queue, the member directory and the super-only
-- attendance views with more than one name in them before real members have signed up.
--
-- Run it in the Supabase SQL editor on project `jpffnazfjxvdzqnfueue`. Safe to re-run.
--
-- THESE PEOPLE ARE NOT REAL and cannot sign in: their `auth.users` rows carry no password and no
-- identity row, and the addresses are @example.test (a reserved TLD), so nothing here can reach
-- an inbox. **Delete them before real choir members start using the app** — otherwise Marguerite
-- Okafor and friends turn up in a real member's attendance list. The teardown at the bottom is
-- one statement.
--
-- No absences or check-ins are seeded. They'd have to hang off real, dated rehearsals, and
-- inventing "who came to the 25th of August" for a real Tuesday is fiction that would then be
-- indistinguishable from a genuine record.
-- ============================================================================

-- --- Clear previous run (safe to re-run) ------------------------------------
-- Deleting the auth.users row cascades to the profile, and from there to the membership.
delete from auth.users where id::text like 'f0000000-0000-0000-0000-%';

-- --- People -----------------------------------------------------------------
-- Inserting into auth.users fires sonario.handle_new_auth_user(), which creates the matching
-- profile (reading display_name out of raw_user_meta_data.full_name, exactly as Google's OAuth
-- payload would) and a `pending` membership. Statuses are set below. Note that the trigger skips
-- anonymous identities as of migration 0004, but these are non-anonymous, so it still fires.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','marguerite.okafor@example.test','{"provider":"google","providers":["google"]}','{"full_name":"Marguerite Okafor"}', now() - interval '400 days', now() - interval '400 days'),
  ('f0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','dev.raman@example.test','{"provider":"google","providers":["google"]}','{"full_name":"Dev Raman"}', now() - interval '380 days', now() - interval '380 days'),
  ('f0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','priya.venkatesan@example.test','{"provider":"google","providers":["google"]}','{"full_name":"Priya Venkatesan"}', now() - interval '300 days', now() - interval '300 days'),
  ('f0000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tom.hollis@example.test','{"provider":"google","providers":["google"]}','{"full_name":"Tom Hollis"}', now() - interval '210 days', now() - interval '210 days'),
  ('f0000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bea.nowak@example.test','{"provider":"google","providers":["google"]}','{"full_name":"Bea Nowak"}', now() - interval '150 days', now() - interval '150 days'),
  ('f0000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ines.ferreira@example.test','{"provider":"google","providers":["google"]}','{"full_name":"Ines Ferreira"}', now() - interval '60 days', now() - interval '60 days'),
  ('f0000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','callum.whitmore@example.test','{"provider":"google","providers":["google"]}','{"full_name":"Callum Whitmore"}', now() - interval '2 days', now() - interval '2 days'),
  ('f0000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rowan.deakin@example.test','{"provider":"google","providers":["google"]}','{"full_name":"Rowan Deakin"}', now() - interval '500 days', now() - interval '500 days');

-- One of each membership state worth being able to look at: a second super, four ordinary active
-- members, one pending request (so the approval queue isn't empty), one deactivated.
update sonario.memberships m set
  status = v.status,
  role = v.role,
  decided_at = case when v.status = 'pending' then null else now() - interval '30 days' end,
  decided_by = case when v.status = 'pending' then null else 'f0000000-0000-0000-0000-000000000001'::uuid end
from (values
  ('f0000000-0000-0000-0000-000000000001'::uuid, 'active',      'super'),
  ('f0000000-0000-0000-0000-000000000002'::uuid, 'active',      'member'),
  ('f0000000-0000-0000-0000-000000000003'::uuid, 'active',      'member'),
  ('f0000000-0000-0000-0000-000000000004'::uuid, 'active',      'member'),
  ('f0000000-0000-0000-0000-000000000005'::uuid, 'active',      'member'),
  ('f0000000-0000-0000-0000-000000000006'::uuid, 'active',      'member'),
  ('f0000000-0000-0000-0000-000000000007'::uuid, 'pending',     'member'),
  ('f0000000-0000-0000-0000-000000000008'::uuid, 'deactivated', 'member')
) as v(profile_id, status, role)
where m.profile_id = v.profile_id;

select p.display_name, m.status, m.role
from sonario.profiles p join sonario.memberships m on m.profile_id = p.id
where p.id::text like 'f0000000-0000-0000-0000-%'
order by m.role desc, p.display_name;

-- ============================================================================
-- Teardown — RUN THIS BEFORE REAL MEMBERS USE THE APP
-- ============================================================================
-- delete from auth.users where id::text like 'f0000000-0000-0000-0000-%';
