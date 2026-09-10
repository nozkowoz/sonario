-- ============================================================================
-- FABRICATED attendance history for Nina's own profile, Term 3 2026.
--
-- This is invented data, created 2026-09-10 so the attendance views have something real-shaped to
-- render before the choir has actually used the app. It is NOT a record of what happened.
--
-- Nine Term 3 rehearsals have already passed (14 Jul - 8 Sep; the 15 Sep one is still to come).
-- This marks two of them as "couldn't make it" and checks in to the other seven, with arrival
-- times scattered either side of the 7:00pm start. The spread averages about 2 minutes early,
-- which is the kind of figure the punctuality display in the mockups was showing.
--
-- Missed:    28 Jul, 25 Aug  — recorded as absences, i.e. she told the choir in advance.
-- Attended:  14 Jul (-7), 21 Jul (-3), 4 Aug (+2), 11 Aug (-10), 18 Aug (+6), 1 Sep (-4),
--            8 Sep (-1)     — minutes relative to the 7:00pm start; negative is early.
--
-- Run in the Supabase SQL editor on project `jpffnazfjxvdzqnfueue`. Safe to re-run (both tables
-- have a unique constraint on rehearsal + member, so re-running only refreshes the times).
--
-- DELETE THIS BEFORE THE CHOIR USES THE APP FOR REAL, or it becomes indistinguishable from a
-- genuine record — the teardown is at the bottom. Same reasoning as the fake seed members.
-- ============================================================================

-- --- Two rehearsals she couldn't make ---------------------------------------
insert into sonario.rehearsal_absences (rehearsal_id, profile_id)
select r.id, (select id from auth.users where email = 'ninakowalski1997@gmail.com')
from sonario.rehearsals r
where r.term_id = 'a0000000-0000-0000-0000-000000002603'
  and r.rehearsal_date in ('2026-07-28', '2026-08-25')
on conflict do nothing;

-- --- Checked in to every other Term 3 rehearsal that has already happened ---
insert into sonario.checkins (rehearsal_id, profile_id, source)
select r.id, (select id from auth.users where email = 'ninakowalski1997@gmail.com'), 'live'
from sonario.rehearsals r
where r.term_id = 'a0000000-0000-0000-0000-000000002603'
  and r.status <> 'cancelled'
  and r.rehearsal_date < (now() at time zone 'Australia/Melbourne')::date
  and r.rehearsal_date not in ('2026-07-28', '2026-08-25')
on conflict do nothing;

-- --- Arrival times ----------------------------------------------------------
-- Set by UPDATE, not on insert: the `checkins_server_timestamp` trigger from migration 0003
-- deliberately overwrites checked_in_at with the server clock on INSERT, which is the whole point
-- of it. No policy lets a member do this — it's only possible here because the SQL editor runs
-- with elevated rights.
update sonario.checkins c
set checked_in_at = ((r.rehearsal_date + r.start_time) at time zone 'Australia/Melbourne')
                    + (v.mins * interval '1 minute')
from sonario.rehearsals r, (values
  ('2026-07-14'::date, -7),
  ('2026-07-21',       -3),
  ('2026-08-04',        2),
  ('2026-08-11',      -10),
  ('2026-08-18',        6),
  ('2026-09-01',       -4),
  ('2026-09-08',       -1)
) as v(d, mins)
where c.rehearsal_id = r.id
  and r.rehearsal_date = v.d
  and c.profile_id = (select id from auth.users where email = 'ninakowalski1997@gmail.com');

-- --- Check what you got -----------------------------------------------------
select r.rehearsal_date,
       to_char(r.rehearsal_date, 'Dy') as day,
       case
         when c.id is not null then 'checked in ' || to_char(c.checked_in_at at time zone 'Australia/Melbourne', 'HH12:MIam')
         when a.id is not null then 'absent (told the choir)'
         when r.rehearsal_date >= (now() at time zone 'Australia/Melbourne')::date then 'still to come'
         else 'no record'
       end as my_status,
       case when c.checked_in_at is not null
            then round(extract(epoch from (c.checked_in_at - ((r.rehearsal_date + r.start_time) at time zone 'Australia/Melbourne'))) / 60)
       end as mins_vs_start
from sonario.rehearsals r
left join sonario.checkins c
  on c.rehearsal_id = r.id
 and c.profile_id = (select id from auth.users where email = 'ninakowalski1997@gmail.com')
left join sonario.rehearsal_absences a
  on a.rehearsal_id = r.id
 and a.profile_id = (select id from auth.users where email = 'ninakowalski1997@gmail.com')
where r.term_id = 'a0000000-0000-0000-0000-000000002603'
order by r.rehearsal_date;

-- ============================================================================
-- Teardown — RUN THIS BEFORE THE CHOIR USES THE APP FOR REAL
-- ============================================================================
-- delete from sonario.checkins
--  where profile_id = (select id from auth.users where email = 'ninakowalski1997@gmail.com');
-- delete from sonario.rehearsal_absences
--  where profile_id = (select id from auth.users where email = 'ninakowalski1997@gmail.com');
