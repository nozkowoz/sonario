-- ============================================================================
-- Sonario — the REAL 2026 repertoire (not test data)
--
-- Everything in this file is real, given by Nina directly: the Mid-Year Concert 2026 setlist and
-- order (Semester 1), the songs learnt so far in Term 3 (Semester 2, current), and Nina's own real
-- voice-part assignments on the songs she named a part for.
--
-- Run on the NEW dedicated Sonario project (rwkaofshfatqqkupeqoe), after migrations 0000-0009.
-- Safe to re-run: every insert is keyed so a second run updates rather than duplicates.
--
-- ONE PLACEHOLDER, FLAGGED: the concert's end_time is not something Nina gave me, and
-- `rehearsals.end_time` is not-null with no default. Set to 18:00 (a 2-hour concert from the
-- 4:00pm start she gave) as a placeholder — correct it if wrong, it has no other effect anywhere
-- in the app today.
--
-- The concert has no `term_id`: 28 June 2026 falls in the break between Term 2 and Term 3, and
-- Term 1/2 don't exist in this database (real_schedule_2026.sql only seeds Terms 3-4 on purpose,
-- since inventing Term 1/2 rows just to hang a term_id off them would be its own fabrication).
-- ============================================================================

-- --- Songs -------------------------------------------------------------------
insert into sonario.songs (id, title, composer) values
  ('b0000000-0000-0000-0000-000000000001', 'Wherever I Go', ''),
  ('b0000000-0000-0000-0000-000000000002', 'How To Live', ''),
  ('b0000000-0000-0000-0000-000000000003', 'This Is It', ''),
  ('b0000000-0000-0000-0000-000000000004', 'Rome Wasn''t Built In A Day', ''),
  ('b0000000-0000-0000-0000-000000000005', 'Malleable', ''),
  ('b0000000-0000-0000-0000-000000000006', 'We Don''t Ever Dial', ''),
  ('b0000000-0000-0000-0000-000000000007', 'Landslide', ''),
  ('b0000000-0000-0000-0000-000000000008', 'Always Be My Baby', ''),
  ('b0000000-0000-0000-0000-000000000009', 'Dancing On The Wall', ''),
  ('b0000000-0000-0000-0000-00000000000a', 'Say Something', ''),
  ('b0000000-0000-0000-0000-00000000000b', 'Love Ruins Everything', 'Tiny Habits'),
  ('b0000000-0000-0000-0000-00000000000c', 'Can We Talk', ''),
  ('b0000000-0000-0000-0000-00000000000d', 'Seventeen', 'Sean (original)'),
  ('b0000000-0000-0000-0000-00000000000e', 'That''s Freedom', 'John Farnham')
on conflict (id) do update set title = excluded.title, composer = excluded.composer;

-- --- Collections ---------------------------------------------------------------
insert into sonario.song_collections (id, name, kind, is_current, sort_order) values
  ('b1000000-0000-0000-0000-000000000001', 'Semester 1 · 2026', 'semester', false, 2),
  ('b1000000-0000-0000-0000-000000000002', 'Semester 2 · 2026', 'semester', true, 1),
  ('b1000000-0000-0000-0000-000000000003', 'Sonario Classics', 'classics', false, 3)
on conflict (id) do update set name = excluded.name, kind = excluded.kind,
  is_current = excluded.is_current, sort_order = excluded.sort_order;

-- Sonario Classics is intentionally empty — no real "all-time favourites" list has been given yet.

-- --- Semester 1 · 2026 — the Mid-Year Concert setlist, in order -------------
insert into sonario.song_collection_items (collection_id, song_id, position) values
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 1),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 2),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 3),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000004', 4),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000005', 5),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000006', 6),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000007', 7),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000008', 8),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000009', 9),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 10)
on conflict (collection_id, song_id) do update set position = excluded.position;

-- --- Semester 2 · 2026 (current) — learnt so far this term, in the order given ---
insert into sonario.song_collection_items (collection_id, song_id, position) values
  ('b1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', 1),
  ('b1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000c', 2),
  ('b1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000d', 3),
  ('b1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000e', 4)
on conflict (collection_id, song_id) do update set position = excluded.position;

-- --- The Mid-Year Concert itself, as a real performance event ----------------
insert into sonario.rehearsals
  (id, term_id, rehearsal_date, start_time, end_time, location, status, event_type,
   counts_towards_attendance, title, description)
values
  ('b2000000-0000-0000-0000-000000000001', null, '2026-06-28', '16:00', '18:00',
   'Northcote Uniting Church', 'scheduled', 'performance', true, 'Mid-Year Concert 2026', '')
on conflict (id) do update set
  rehearsal_date = excluded.rehearsal_date, start_time = excluded.start_time,
  end_time = excluded.end_time, location = excluded.location, title = excluded.title;

-- Setlist for the concert, in performance order. Delete-then-insert rather than on-conflict:
-- rehearsal_songs has no natural unique key to target, so this is what "safe to re-run" means here.
delete from sonario.rehearsal_songs where rehearsal_id = 'b2000000-0000-0000-0000-000000000001';
insert into sonario.rehearsal_songs (rehearsal_id, song_id, position) values
  ('b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 1),
  ('b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 2),
  ('b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 3),
  ('b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000004', 4),
  ('b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000005', 5),
  ('b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000006', 6),
  ('b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000007', 7),
  ('b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000008', 8),
  ('b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000009', 9),
  ('b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 10);

-- --- Nina's own real part assignments, Term 3 (Semester 2) songs -------------
-- Only where she actually named a part. No assignment for "Seventeen" — not given, not guessed.
insert into sonario.song_assignments (song_id, profile_id, part_label, updated_by) values
  ('b0000000-0000-0000-0000-00000000000b',
   (select id from auth.users where email = 'ninakowalski1997@gmail.com'), 'tenor',
   (select id from auth.users where email = 'ninakowalski1997@gmail.com')),
  ('b0000000-0000-0000-0000-00000000000c',
   (select id from auth.users where email = 'ninakowalski1997@gmail.com'), 'alto',
   (select id from auth.users where email = 'ninakowalski1997@gmail.com')),
  ('b0000000-0000-0000-0000-00000000000e',
   (select id from auth.users where email = 'ninakowalski1997@gmail.com'), 'alto',
   (select id from auth.users where email = 'ninakowalski1997@gmail.com'))
on conflict (song_id, profile_id) where archived_at is null
  do update set part_label = excluded.part_label, updated_by = excluded.updated_by, updated_at = now();

-- --- Check what you got -------------------------------------------------------
select c.name as collection, c.is_current, count(i.song_id) as songs
from sonario.song_collections c
left join sonario.song_collection_items i on i.collection_id = c.id
group by c.name, c.is_current, c.sort_order
order by c.sort_order;

select r.title, r.rehearsal_date, count(rs.song_id) as setlist_songs
from sonario.rehearsals r
join sonario.rehearsal_songs rs on rs.rehearsal_id = r.id
where r.id = 'b2000000-0000-0000-0000-000000000001'
group by r.title, r.rehearsal_date;

select s.title, sa.part_label
from sonario.song_assignments sa
join sonario.songs s on s.id = sa.song_id
where sa.profile_id = (select id from auth.users where email = 'ninakowalski1997@gmail.com')
  and sa.archived_at is null
order by s.title;

-- ============================================================================
-- Teardown (only if you want this real data gone again — unlikely, it's real)
-- ============================================================================
-- delete from sonario.song_assignments where song_id in (select id from sonario.songs where id like 'b0000000-%');
-- delete from sonario.rehearsal_songs where rehearsal_id = 'b2000000-0000-0000-0000-000000000001';
-- delete from sonario.rehearsals where id = 'b2000000-0000-0000-0000-000000000001';
-- delete from sonario.song_collection_items where collection_id like 'b1000000-%';
-- delete from sonario.song_collections where id like 'b1000000-%';
-- delete from sonario.songs where id like 'b0000000-%';
