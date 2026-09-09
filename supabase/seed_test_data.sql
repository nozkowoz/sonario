-- ============================================================================
-- Sonario — realistic test data (Step E of the MVP run)
--
-- This is TEST DATA, not a migration: it is not in the migration ledger, it can be re-run at
-- any time (it clears its own rows first), and every row it creates can be removed again with
-- the teardown block at the bottom. Nothing here is required for the app to work — it exists so
-- the app can be clicked through as a real member and a real super before anyone relies on it.
--
-- WHAT IT CREATES
--   * 8 fake choir members, one of each membership state worth seeing: 1 super, 5 active,
--     1 pending (so the approval queue has something in it), 1 deactivated.
--   * 2 terms and 11 events spanning rehearsals, a workshop, a performance and a social.
--   * A handful of absences and a history of check-ins with varied arrival times.
--
-- EVERY DATE IS RELATIVE TO TODAY (Melbourne), not hardcoded. Fixed dates would look right the
-- day they were written and wrong a fortnight later — and one of these events has to be *today*
-- or check-in can't be exercised at all (migration 0003 only allows checking in on the day).
-- Re-run this file whenever the data has drifted out of usefulness.
--
-- FAKE MEMBERS CANNOT SIGN IN. Their `auth.users` rows deliberately carry no password and no
-- identity row, so they exist only as names attached to attendance data. Emails are @example.test
-- (a reserved TLD) so nothing here can ever reach a real inbox.
--
-- NOTE ON THE FIRST REAL SUPER: `memberships`'s update policy is
-- `is_super() AND profile_id <> auth.uid()`, so nobody can approve or promote themselves, and
-- the seeded super above can't log in to approve anyone either. After signing in with Google for
-- the first time, the real account has to be promoted with one direct SQL statement:
--   update sonario.memberships set status = 'active', role = 'super'
--    where profile_id = (select id from auth.users where email = '<your google address>');
-- ============================================================================

-- --- Clear previous run (safe to re-run) ------------------------------------
-- Deleting the auth.users rows cascades to profiles, and from there to memberships, absences and
-- check-ins, so the fake people take all their own data with them.
delete from auth.users where id::text like 'f0000000-0000-0000-0000-%';
delete from sonario.rehearsals where id::text like 'f2000000-0000-0000-0000-%';
delete from sonario.terms where id::text like 'f1000000-0000-0000-0000-%';

-- --- People -----------------------------------------------------------------
-- Inserting into auth.users fires sonario.handle_new_auth_user(), which creates the matching
-- profile (reading display_name out of raw_user_meta_data.full_name, exactly as Google's OAuth
-- payload would) and a `pending` membership. The statuses are then set below.
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

-- Marguerite runs the choir; Callum has just asked to join; Rowan has moved away.
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

-- --- Terms ------------------------------------------------------------------
-- Term 3 contains today, so the Calendar tab shows "My term" with its banner rather than the
-- generic "Calendar" heading.
insert into sonario.terms (id, name, starts_on, ends_on)
values
  ('f1000000-0000-0000-0000-000000000001','Term 3 2026', ((now() at time zone 'Australia/Melbourne')::date - 70), ((now() at time zone 'Australia/Melbourne')::date + 18)),
  ('f1000000-0000-0000-0000-000000000002','Term 4 2026', ((now() at time zone 'Australia/Melbourne')::date + 20), ((now() at time zone 'Australia/Melbourne')::date + 90));

-- --- Events -----------------------------------------------------------------
-- A term's worth of weekly rehearsals, all on the same weekday as today so the pattern reads as
-- a real rehearsal night, plus the things that happen around them: a weekend sectional workshop,
-- a cancelled night (hall double-booked), end-of-term drinks that don't count towards
-- attendance, and a Saturday concert that does.
insert into sonario.rehearsals
  (id, term_id, rehearsal_date, start_time, end_time, location, status, event_type, counts_towards_attendance, title, description)
select
  e.id,
  e.term_id,
  (now() at time zone 'Australia/Melbourne')::date + e.day_offset,
  e.start_time, e.end_time, e.location, e.status, e.event_type, e.counts, e.title, e.description
from (values
  ('f2000000-0000-0000-0000-000000000001'::uuid,'f1000000-0000-0000-0000-000000000001'::uuid,-21,'19:30'::time,'21:30'::time,'Northcote Uplands Hall','scheduled','rehearsal',true, null, ''),
  ('f2000000-0000-0000-0000-000000000002'::uuid,'f1000000-0000-0000-0000-000000000001'::uuid,-14,'19:30'::time,'21:30'::time,'Northcote Uplands Hall','scheduled','rehearsal',true, null, 'Running the whole first half.'),
  ('f2000000-0000-0000-0000-000000000003'::uuid,'f1000000-0000-0000-0000-000000000001'::uuid,-10,'10:00'::time,'15:00'::time,'Northcote Uplands Hall','scheduled','workshop',true, 'Sectional workshop', 'Altos and tenors in the morning, everyone together after lunch. Bring your own lunch.'),
  ('f2000000-0000-0000-0000-000000000004'::uuid,'f1000000-0000-0000-0000-000000000001'::uuid, -7,'19:30'::time,'21:30'::time,'Northcote Uplands Hall','scheduled','rehearsal',true, null, ''),
  ('f2000000-0000-0000-0000-000000000005'::uuid,'f1000000-0000-0000-0000-000000000001'::uuid,-28,'19:30'::time,'21:30'::time,'Northcote Uplands Hall','cancelled','rehearsal',true, null, 'Cancelled — hall double-booked. Sorry all.'),
  ('f2000000-0000-0000-0000-000000000006'::uuid,'f1000000-0000-0000-0000-000000000001'::uuid,  0,'19:30'::time,'21:30'::time,'Northcote Uplands Hall','scheduled','rehearsal',true, null, 'Bring the concert folder — running the programme in order.'),
  ('f2000000-0000-0000-0000-000000000007'::uuid,'f1000000-0000-0000-0000-000000000001'::uuid,  7,'19:30'::time,'21:30'::time,'Northcote Uplands Hall','scheduled','rehearsal',true, null, ''),
  ('f2000000-0000-0000-0000-000000000008'::uuid,'f1000000-0000-0000-0000-000000000001'::uuid, 11,'18:00'::time,'20:00'::time,'The Retreat, High St','scheduled','social',false,'End-of-term drinks', 'No music, no folders. Partners welcome.'),
  ('f2000000-0000-0000-0000-000000000009'::uuid,'f1000000-0000-0000-0000-000000000001'::uuid, 14,'19:30'::time,'21:30'::time,'Northcote Uplands Hall','scheduled','rehearsal',true, null, 'Last rehearsal before the concert.'),
  ('f2000000-0000-0000-0000-00000000000a'::uuid,'f1000000-0000-0000-0000-000000000001'::uuid, 17,'14:00'::time,'16:30'::time,'Northcote Town Hall','scheduled','performance',true,'Spring Sing', 'Call at 1pm for a warm-up. Blacks, please.'),
  ('f2000000-0000-0000-0000-00000000000b'::uuid,'f1000000-0000-0000-0000-000000000002'::uuid, 21,'19:30'::time,'21:30'::time,'Northcote Uplands Hall','scheduled','rehearsal',true, null, 'First night of Term 4 — new music.')
) as e(id, term_id, day_offset, start_time, end_time, location, status, event_type, counts, title, description);

-- --- Absences ("can't make it" — the only member-side signal there is) ------
insert into sonario.rehearsal_absences (rehearsal_id, profile_id) values
  ('f2000000-0000-0000-0000-000000000006','f0000000-0000-0000-0000-000000000006'),  -- Ines, tonight
  ('f2000000-0000-0000-0000-000000000007','f0000000-0000-0000-0000-000000000002'),  -- Dev, next week
  ('f2000000-0000-0000-0000-000000000007','f0000000-0000-0000-0000-000000000005'),  -- Bea, next week
  ('f2000000-0000-0000-0000-000000000008','f0000000-0000-0000-0000-000000000003'),  -- Priya, drinks
  ('f2000000-0000-0000-0000-000000000009','f0000000-0000-0000-0000-000000000004');  -- Tom, last rehearsal

-- --- Check-ins --------------------------------------------------------------
-- Inserted first, then back-dated. The `checkins_server_timestamp` trigger (migration 0003)
-- deliberately overwrites `checked_in_at` with the server clock on INSERT — that's the whole
-- point of it — so historical arrival times have to be written afterwards with an UPDATE, which
-- no policy allows a member to do. `minutes_late` is negative for arriving early; the spread is
-- there so punctuality tiers have something real to colour when that feature is eventually built.
insert into sonario.checkins (rehearsal_id, profile_id, source) values
  ('f2000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','live'),
  ('f2000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','live'),
  ('f2000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000003','live'),
  ('f2000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000004','live'),
  ('f2000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000005','live'),
  ('f2000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000001','live'),
  ('f2000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000003','live'),
  ('f2000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000004','live'),
  ('f2000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000006','live'),
  ('f2000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000001','live'),
  ('f2000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000002','live'),
  ('f2000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000003','live'),
  ('f2000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000005','live'),
  ('f2000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000006','live'),
  ('f2000000-0000-0000-0000-000000000004','f0000000-0000-0000-0000-000000000001','live'),
  ('f2000000-0000-0000-0000-000000000004','f0000000-0000-0000-0000-000000000002','live'),
  ('f2000000-0000-0000-0000-000000000004','f0000000-0000-0000-0000-000000000004','live'),
  ('f2000000-0000-0000-0000-000000000004','f0000000-0000-0000-0000-000000000005','live'),
  ('f2000000-0000-0000-0000-000000000004','f0000000-0000-0000-0000-000000000006','live'),
  -- Tonight: Marguerite and Dev are already in the room, the rest haven't arrived.
  ('f2000000-0000-0000-0000-000000000006','f0000000-0000-0000-0000-000000000001','live'),
  ('f2000000-0000-0000-0000-000000000006','f0000000-0000-0000-0000-000000000002','live');

update sonario.checkins c set
  checked_in_at = ((r.rehearsal_date + r.start_time) at time zone 'Australia/Melbourne')
                  + (v.minutes_late * interval '1 minute')
from sonario.rehearsals r, (values
  ('f2000000-0000-0000-0000-000000000001'::uuid,'f0000000-0000-0000-0000-000000000001'::uuid,-12),
  ('f2000000-0000-0000-0000-000000000001'::uuid,'f0000000-0000-0000-0000-000000000002'::uuid, -4),
  ('f2000000-0000-0000-0000-000000000001'::uuid,'f0000000-0000-0000-0000-000000000003'::uuid,  6),
  ('f2000000-0000-0000-0000-000000000001'::uuid,'f0000000-0000-0000-0000-000000000004'::uuid, 18),
  ('f2000000-0000-0000-0000-000000000001'::uuid,'f0000000-0000-0000-0000-000000000005'::uuid, -2),
  ('f2000000-0000-0000-0000-000000000002'::uuid,'f0000000-0000-0000-0000-000000000001'::uuid,-15),
  ('f2000000-0000-0000-0000-000000000002'::uuid,'f0000000-0000-0000-0000-000000000003'::uuid, -1),
  ('f2000000-0000-0000-0000-000000000002'::uuid,'f0000000-0000-0000-0000-000000000004'::uuid, 25),
  ('f2000000-0000-0000-0000-000000000002'::uuid,'f0000000-0000-0000-0000-000000000006'::uuid,  3),
  ('f2000000-0000-0000-0000-000000000003'::uuid,'f0000000-0000-0000-0000-000000000001'::uuid,-20),
  ('f2000000-0000-0000-0000-000000000003'::uuid,'f0000000-0000-0000-0000-000000000002'::uuid, -6),
  ('f2000000-0000-0000-0000-000000000003'::uuid,'f0000000-0000-0000-0000-000000000003'::uuid,  0),
  ('f2000000-0000-0000-0000-000000000003'::uuid,'f0000000-0000-0000-0000-000000000005'::uuid,  9),
  ('f2000000-0000-0000-0000-000000000003'::uuid,'f0000000-0000-0000-0000-000000000006'::uuid, -3),
  ('f2000000-0000-0000-0000-000000000004'::uuid,'f0000000-0000-0000-0000-000000000001'::uuid,-11),
  ('f2000000-0000-0000-0000-000000000004'::uuid,'f0000000-0000-0000-0000-000000000002'::uuid,  2),
  ('f2000000-0000-0000-0000-000000000004'::uuid,'f0000000-0000-0000-0000-000000000004'::uuid, 14),
  ('f2000000-0000-0000-0000-000000000004'::uuid,'f0000000-0000-0000-0000-000000000005'::uuid, -5),
  ('f2000000-0000-0000-0000-000000000004'::uuid,'f0000000-0000-0000-0000-000000000006'::uuid,  7)
) as v(rehearsal_id, profile_id, minutes_late)
where c.rehearsal_id = v.rehearsal_id and c.profile_id = v.profile_id and r.id = c.rehearsal_id;

-- Tonight's two are pegged to the clock rather than to the event's start time, so they read as
-- "arrived a little while ago" whatever time of day this file is run. Marguerite's is over an
-- hour old (no undo offered), Dev's is recent (still inside the one-hour window) — which is the
-- pair of states worth being able to see side by side.
update sonario.checkins c set checked_in_at = now() - v.ago
from (values
  ('f0000000-0000-0000-0000-000000000001'::uuid, interval '95 minutes'),
  ('f0000000-0000-0000-0000-000000000002'::uuid, interval '12 minutes')
) as v(profile_id, ago)
where c.rehearsal_id = 'f2000000-0000-0000-0000-000000000006' and c.profile_id = v.profile_id;

-- ============================================================================
-- Teardown (removes everything this file created, and nothing else)
-- ============================================================================
-- delete from auth.users where id::text like 'f0000000-0000-0000-0000-%';
-- delete from sonario.rehearsals where id::text like 'f2000000-0000-0000-0000-%';
-- delete from sonario.terms where id::text like 'f1000000-0000-0000-0000-%';
