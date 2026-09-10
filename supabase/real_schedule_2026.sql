-- ============================================================================
-- Sonario — the REAL rehearsal schedule (not test data)
--
-- The choir rehearses 7:00–9:00pm every Tuesday of the Victorian school term at EASTMINT,
-- Northcote, and takes the school holidays off. This file turns that rule into rows.
--
-- Run it in the Supabase SQL editor on project `jpffnazfjxvdzqnfueue` (the one named "The Page
-- Turners" — Sonario shares it). Safe to re-run: it will not duplicate a rehearsal that already
-- exists on a given date, and it will not overwrite an event an organiser has edited by hand.
--
-- TERM DATES verified 2026-09-10 against vic.gov.au/school-term-dates-and-holidays-victoria,
-- not from memory — two of the four 2026 dates were wrong in a first draft written from memory
-- (Term 2 ends 26 June, not 3 July; Term 3 starts 13 July, not 20 July). If you extend this to
-- 2027, re-check the source rather than trusting the pattern:
--   2027 — T1 28 Jan-25 Mar, T2 12 Apr-25 Jun, T3 12 Jul-17 Sep, T4 4 Oct-17 Dec.
--
-- WHAT IT CREATES: Term 3 2026 (10 Tuesdays, 14 Jul - 15 Sep) and Term 4 2026 (11 Tuesdays,
-- 6 Oct - 15 Dec). Only these two terms, because they're the ones the app is actually live for —
-- Terms 1 and 2 are over and inventing attendance history for them would be fiction.
--
-- PUBLIC HOLIDAY: Melbourne Cup Day falls on Tuesday 3 November 2026, inside Term 4. It's
-- created but marked `cancelled` with a reason rather than omitted, so the gap in the calendar
-- explains itself instead of looking like a mistake. If the choir does rehearse that night, hit
-- Reinstate on the event and clear the note.
-- ============================================================================

-- --- Remove the fake events and terms from supabase/seed_test_data.sql ------
-- Only the seed's own prefixed rows. Deleting an event cascades its absences and check-ins away,
-- which is intended: they were attached to invented dates.
delete from sonario.rehearsals where id::text like 'f2000000-0000-0000-0000-%';
delete from sonario.terms where id::text like 'f1000000-0000-0000-0000-%';

-- --- The two live terms ------------------------------------------------------
-- Fixed ids so a re-run updates rather than duplicating.
insert into sonario.terms (id, name, starts_on, ends_on) values
  ('a0000000-0000-0000-0000-000000002603', 'Term 3 2026', '2026-07-13', '2026-09-18'),
  ('a0000000-0000-0000-0000-000000002604', 'Term 4 2026', '2026-10-05', '2026-12-18')
on conflict (id) do update
  set name = excluded.name, starts_on = excluded.starts_on, ends_on = excluded.ends_on;

-- --- Every Tuesday inside those terms ---------------------------------------
-- Generated from the term bounds rather than typed out, so the dates can't drift from the rule
-- and extending to another term is one more row above. `isodow = 2` is Tuesday.
insert into sonario.rehearsals
  (term_id, rehearsal_date, start_time, end_time, location, status, event_type,
   counts_towards_attendance, title, description)
select t.id, d::date, '19:00', '21:00', 'EASTMINT, Northcote', 'scheduled', 'rehearsal',
       true, null, ''
from sonario.terms t
cross join generate_series(t.starts_on::timestamp, t.ends_on::timestamp, interval '1 day') d
where t.id in ('a0000000-0000-0000-0000-000000002603', 'a0000000-0000-0000-0000-000000002604')
  and extract(isodow from d) = 2
  -- Idempotent, and it protects anything already on the calendar for that date: a rehearsal
  -- someone rescheduled by hand, or a one-off workshop.
  and not exists (select 1 from sonario.rehearsals r where r.rehearsal_date = d::date);

-- --- Melbourne Cup Day ------------------------------------------------------
update sonario.rehearsals
set status = 'cancelled',
    description = 'No rehearsal — Melbourne Cup Day public holiday.'
where rehearsal_date = '2026-11-03'
  and event_type = 'rehearsal'
  and status <> 'cancelled';

-- --- Check what you got -----------------------------------------------------
select t.name,
       count(*) as rehearsals,
       min(r.rehearsal_date) as first,
       max(r.rehearsal_date) as last,
       count(*) filter (where r.status = 'cancelled') as cancelled
from sonario.rehearsals r
join sonario.terms t on t.id = r.term_id
group by t.name, t.starts_on
order by t.starts_on;

-- ============================================================================
-- Teardown (only if you want the real schedule gone again)
-- ============================================================================
-- delete from sonario.rehearsals where term_id in
--   ('a0000000-0000-0000-0000-000000002603', 'a0000000-0000-0000-0000-000000002604');
-- delete from sonario.terms where id in
--   ('a0000000-0000-0000-0000-000000002603', 'a0000000-0000-0000-0000-000000002604');
