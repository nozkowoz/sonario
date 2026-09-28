-- ============================================================================
-- 0029 — Move every OPERATIONAL (non-financial) policy from is_super() to is_staff()
--
-- Mechanical, one table at a time, reproducing each policy's exact existing qual/with_check text
-- with only is_super() swapped for is_staff() — nothing else about any of these policies changes.
-- Financial policies (invoice_runs, invoice_settings, invoices) are NOT touched here; they stay on
-- is_super() exactly as they are today. See 0028 for the memberships policy, which needed a real
-- redesign rather than a mechanical swap.
-- ============================================================================

-- attendance_corrections
drop policy if exists "super write corrections" on sonario.attendance_corrections;
create policy "staff write corrections" on sonario.attendance_corrections for insert
  with check (sonario.is_staff() and corrected_by = auth.uid());

-- away_dates
drop policy if exists "own away dates or super reads" on sonario.away_dates;
create policy "own away dates or staff reads" on sonario.away_dates for select
  using (profile_id = auth.uid() or sonario.is_staff());

drop policy if exists "super confirms away dates" on sonario.away_dates;
create policy "staff confirms away dates" on sonario.away_dates for update
  using (sonario.is_staff());

-- checkins
drop policy if exists "super removes backfill checkin" on sonario.checkins;
create policy "staff removes backfill checkin" on sonario.checkins for delete
  using (sonario.is_staff() and source = 'super_backfill');

drop policy if exists "super backfills past checkin" on sonario.checkins;
create policy "staff backfills past checkin" on sonario.checkins for insert
  with check (
    sonario.is_staff() and source = 'super_backfill' and exists (
      select 1 from sonario.rehearsals r
      where r.id = checkins.rehearsal_id and r.status = 'scheduled'
        and r.rehearsal_date < ((now() at time zone 'Australia/Melbourne'))::date
    )
  );

drop policy if exists "own checkin or super reads" on sonario.checkins;
create policy "own checkin or staff reads" on sonario.checkins for select
  using (profile_id = auth.uid() or sonario.is_staff());

drop policy if exists "own or super edits checkin time" on sonario.checkins;
create policy "own or staff edits checkin time" on sonario.checkins for update
  using (profile_id = auth.uid() or sonario.is_staff())
  with check (source = 'live');

-- notification_log
drop policy if exists "super reads notification log" on sonario.notification_log;
create policy "staff reads notification log" on sonario.notification_log for select
  using (sonario.is_staff());

-- profiles
drop policy if exists "own profile or super" on sonario.profiles;
create policy "own profile or staff" on sonario.profiles for select
  using (id = auth.uid() or sonario.is_staff());

-- push_subscriptions
drop policy if exists "super reads all subscriptions" on sonario.push_subscriptions;
create policy "staff reads all subscriptions" on sonario.push_subscriptions for select
  using (sonario.is_staff());

-- recordings
drop policy if exists "uploader or super deletes recordings" on sonario.recordings;
create policy "uploader or staff deletes recordings" on sonario.recordings for delete
  using (uploaded_by = auth.uid() or sonario.is_staff());

drop policy if exists "uploader or super updates recording metadata" on sonario.recordings;
create policy "uploader or staff updates recording metadata" on sonario.recordings for update
  using (uploaded_by = auth.uid() or sonario.is_staff())
  with check (uploaded_by = auth.uid() or sonario.is_staff());

-- rehearsal_absences
drop policy if exists "members reverse own absence" on sonario.rehearsal_absences;
create policy "members reverse own absence" on sonario.rehearsal_absences for delete
  using (profile_id = auth.uid() or sonario.is_staff());

drop policy if exists "members mark own absence" on sonario.rehearsal_absences;
create policy "members mark own absence" on sonario.rehearsal_absences for insert
  with check (sonario.is_active_member() and (profile_id = auth.uid() or sonario.is_staff()));

drop policy if exists "own absence or super reads" on sonario.rehearsal_absences;
create policy "own absence or staff reads" on sonario.rehearsal_absences for select
  using (profile_id = auth.uid() or sonario.is_staff());

-- rehearsal_recap_items
drop policy if exists "super manage recap items" on sonario.rehearsal_recap_items;
create policy "staff manage recap items" on sonario.rehearsal_recap_items for all
  using (sonario.is_staff()) with check (sonario.is_staff());

drop policy if exists "recap items visibility" on sonario.rehearsal_recap_items;
create policy "recap items visibility" on sonario.rehearsal_recap_items for select
  using (exists (
    select 1 from sonario.rehearsal_recaps r
    where r.id = rehearsal_recap_items.recap_id and (r.published or sonario.is_staff())
  ));

-- rehearsal_recaps
drop policy if exists "super manage recaps" on sonario.rehearsal_recaps;
create policy "staff manage recaps" on sonario.rehearsal_recaps for all
  using (sonario.is_staff()) with check (sonario.is_staff());

drop policy if exists "recap visibility" on sonario.rehearsal_recaps;
create policy "recap visibility" on sonario.rehearsal_recaps for select
  using (published or sonario.is_staff());

-- rehearsal_songs
drop policy if exists "super manage rehearsal songs" on sonario.rehearsal_songs;
create policy "staff manage rehearsal songs" on sonario.rehearsal_songs for all
  using (sonario.is_staff()) with check (sonario.is_staff());

-- rehearsals
drop policy if exists "super manage rehearsals" on sonario.rehearsals;
create policy "staff manage rehearsals" on sonario.rehearsals for all
  using (sonario.is_staff()) with check (sonario.is_staff());

-- song_collection_items
drop policy if exists "super manage collection items" on sonario.song_collection_items;
create policy "staff manage collection items" on sonario.song_collection_items for all
  using (sonario.is_staff()) with check (sonario.is_staff());

-- song_collections
drop policy if exists "super manage collections" on sonario.song_collections;
create policy "staff manage collections" on sonario.song_collections for all
  using (sonario.is_staff()) with check (sonario.is_staff());

-- song_lyrics
drop policy if exists "super manage lyrics" on sonario.song_lyrics;
create policy "staff manage lyrics" on sonario.song_lyrics for all
  using (sonario.is_staff()) with check (sonario.is_staff());

-- songs
drop policy if exists "super manage songs" on sonario.songs;
create policy "staff manage songs" on sonario.songs for all
  using (sonario.is_staff()) with check (sonario.is_staff());

-- terms
drop policy if exists "super manage terms" on sonario.terms;
create policy "staff manage terms" on sonario.terms for all
  using (sonario.is_staff()) with check (sonario.is_staff());

-- ============================================================================
-- Verification — every table above should show ZERO remaining is_super()-only policies
-- (the financial ones are expected and excluded here), and the new staff policies should exist.
-- ============================================================================
select tablename, policyname, cmd
from pg_policies
where schemaname = 'sonario'
  and (qual ilike '%is_super%' or with_check ilike '%is_super%')
  and tablename not in ('invoice_runs', 'invoice_settings', 'invoices')
order by tablename;
-- expect: zero rows
