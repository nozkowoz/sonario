-- Sonario rebuild — Checkpoint 2: Database foundation
-- Scope: profiles/memberships/roles/RLS foundation, rehearsals + RSVPs + check-ins + away dates +
-- attendance confirmation/corrections, repertoire (songs/part_labels/song_assignments/recordings),
-- rehearsal songs/recaps (structure only, publishing logic is Checkpoint 13), push_subscriptions +
-- notification_log (inert tables only — nothing reads/writes them until Checkpoint 14, per the
-- approved architecture plan).
--
-- Deliberately OUT of scope for this migration: social_events, social_rsvps, notices are left
-- completely untouched (still member_name-based) — their member_name -> profile_id repoint is
-- Checkpoint 15's job, not foundation work. No Google auth, no interface, no notification sending
-- happens as a result of this migration — it only prepares data structure.
--
-- BEFORE RUNNING THIS: take the manual safety snapshot described in the Checkpoint 2 handover
-- message (Supabase Dashboard → Database → Backups, or `pg_dump`). The full pre-rebuild schema is
-- also preserved permanently in git at commit 904ca9a, independent of this snapshot.
--
-- Run this once, in order, in the Supabase SQL editor. Rollback: see
-- supabase/migrations/0001_foundation_rollback.sql.

-- ============================================================================
-- 1. Drop the tables this migration replaces. No real data exists in any of them
--    (confirmed) — this is a clean replacement, not a data migration.
-- ============================================================================
drop table if exists sonario.rehearsal_checkins cascade;
drop table if exists sonario.rehearsal_rsvps cascade;
drop table if exists sonario.rehearsals cascade;
drop table if exists sonario.songs cascade;
drop table if exists sonario.members cascade;

-- ============================================================================
-- 2. profiles + memberships — the auth/role foundation. Roles live ONLY here,
--    never in JWT/user_metadata (closes the self-escalation hole in the old design).
-- ============================================================================
create table if not exists sonario.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  google_email text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists sonario.memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references sonario.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'declined', 'deactivated')),
  role text not null default 'member' check (role in ('member', 'super')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references sonario.profiles(id)
);

-- On first Google sign-in, auth.users gains a row — this trigger creates the matching profile +
-- pending membership automatically, so there's no separate "join flow" screen. Signing in *is*
-- requesting. Runs as the trigger owner (implicitly elevated, same as any auth.users trigger) —
-- narrow by construction: it only ever inserts exactly one profiles + one memberships row, for
-- the exact new auth.users row that fired it.
create or replace function sonario.handle_new_auth_user()
returns trigger as $$
begin
  insert into sonario.profiles (id, display_name, google_email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into sonario.memberships (profile_id)
  values (new.id)
  on conflict (profile_id) do nothing;

  return new;
end;
$$ language plpgsql security definer set search_path = '';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function sonario.handle_new_auth_user();

-- ============================================================================
-- 3. Helper functions — every RLS policy that checks role/status goes through these,
--    never a bare JWT claim. Fixed empty search_path on every one (Nina's requirement):
--    forces full schema-qualification inside the function body, closing off search-path
--    hijacking as an attack vector entirely rather than relying on careful qualification.
-- ============================================================================
create or replace function sonario.current_membership()
returns sonario.memberships as $$
  select * from sonario.memberships where profile_id = auth.uid() and status = 'active' limit 1;
$$ language sql stable security definer set search_path = '';

create or replace function sonario.is_super()
returns boolean as $$
  select coalesce((select role from sonario.current_membership()) = 'super', false);
$$ language sql stable security definer set search_path = '';

create or replace function sonario.is_active_member()
returns boolean as $$
  select sonario.current_membership() is not null;
$$ language sql stable security definer set search_path = '';

revoke execute on function sonario.current_membership() from public;
revoke execute on function sonario.is_super() from public;
revoke execute on function sonario.is_active_member() from public;
grant execute on function sonario.current_membership() to authenticated;
grant execute on function sonario.is_super() to authenticated;
grant execute on function sonario.is_active_member() to authenticated;

-- member_directory(): a SECURITY DEFINER RPC, not a security_invoker view — a view running under
-- the caller's own RLS could only ever return the caller's own row (profiles' base RLS below
-- restricts non-supers to their own row), which can't serve as a shared directory. This function
-- does the narrow, controlled elevation instead: gated on the CALLER's own active status (a
-- pending/declined/deactivated caller gets zero rows back, not an error), returns only active
-- members' profiles (pending/declined/deactivated profiles never appear to anyone via this path),
-- and the return type itself only has three columns — no google_email, structurally.
create or replace function sonario.member_directory()
returns table (id uuid, display_name text, avatar_url text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.display_name, p.avatar_url
  from sonario.profiles p
  join sonario.memberships m on m.profile_id = p.id
  where m.status = 'active'
    and exists (
      select 1 from sonario.memberships caller
      where caller.profile_id = auth.uid() and caller.status = 'active'
    );
$$;

revoke execute on function sonario.member_directory() from public;
grant execute on function sonario.member_directory() to authenticated;

create or replace function sonario.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql security definer set search_path = '';

-- ============================================================================
-- 4. profiles / memberships RLS
-- ============================================================================
alter table sonario.profiles enable row level security;
alter table sonario.memberships enable row level security;

drop policy if exists "own profile or super" on sonario.profiles;
create policy "own profile or super" on sonario.profiles for select
  using (id = auth.uid() or sonario.is_super());
drop policy if exists "update own profile" on sonario.profiles;
create policy "update own profile" on sonario.profiles for update
  using (id = auth.uid());

drop policy if exists "own membership row" on sonario.memberships;
create policy "own membership row" on sonario.memberships for select
  using (profile_id = auth.uid() or sonario.is_super());
-- Self-approval blocked structurally: a super user cannot change status/role on their OWN row
-- via the app — profile_id != auth.uid() is required, not just sonario.is_super(). Only the
-- manual, no-app-code-path bootstrap procedure (below) can make the very first super user.
drop policy if exists "super decides memberships" on sonario.memberships;
create policy "super decides memberships" on sonario.memberships for update
  using (sonario.is_super() and profile_id != auth.uid());

-- ============================================================================
-- 5. terms
-- ============================================================================
create table if not exists sonario.terms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now()
);

alter table sonario.terms enable row level security;
drop policy if exists "members read terms" on sonario.terms;
create policy "members read terms" on sonario.terms for select using (sonario.is_active_member());
drop policy if exists "super manage terms" on sonario.terms;
create policy "super manage terms" on sonario.terms for all using (sonario.is_super()) with check (sonario.is_super());

-- ============================================================================
-- 6. rehearsals + rsvps + checkins + attendance confirmation/corrections + away_dates
-- ============================================================================
create table if not exists sonario.rehearsals (
  id uuid primary key default gen_random_uuid(),
  term_id uuid references sonario.terms(id),
  rehearsal_date date not null,
  start_time time not null,
  end_time time not null,
  location text not null default '',
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sonario.rehearsal_rsvps (
  id uuid primary key default gen_random_uuid(),
  rehearsal_id uuid not null references sonario.rehearsals(id) on delete cascade,
  profile_id uuid not null references sonario.profiles(id) on delete cascade,
  -- 'away' is deliberately NOT a valid status here — away_dates is the single source of truth
  -- (requirement from Nina's review). A stored 'away' RSVP could drift out of sync if the away
  -- date is later edited or cancelled; computing it at read time from away_dates can't drift.
  status text not null check (status in ('yes', 'no', 'maybe')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rehearsal_id, profile_id)
);

create table if not exists sonario.checkins (
  id uuid primary key default gen_random_uuid(),
  rehearsal_id uuid not null references sonario.rehearsals(id) on delete cascade,
  profile_id uuid not null references sonario.profiles(id) on delete cascade,
  checked_in_at timestamptz,
  source text not null check (source in ('live', 'friend_confirmed')),
  -- A friend-confirmed row can never carry a real arrival time — there isn't one to record, and
  -- fabricating one would corrupt punctuality stats. Enforced by the database, not app convention.
  check (source = 'live' or checked_in_at is null),
  unique (rehearsal_id, profile_id)
);

create table if not exists sonario.attendance_confirmation_requests (
  id uuid primary key default gen_random_uuid(),
  rehearsal_id uuid not null references sonario.rehearsals(id) on delete cascade,
  requester_id uuid not null references sonario.profiles(id) on delete cascade,
  confirmer_id uuid not null references sonario.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'unsure', 'cancelled', 'expired')),
  requested_at timestamptz not null default now(),
  responded_at timestamptz
);

create table if not exists sonario.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid references sonario.checkins(id) on delete set null,
  rehearsal_id uuid not null references sonario.rehearsals(id) on delete cascade,
  profile_id uuid not null references sonario.profiles(id) on delete cascade,
  corrected_by uuid not null references sonario.profiles(id),
  reason text not null default '',
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create table if not exists sonario.away_dates (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references sonario.profiles(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  submitted_at timestamptz not null default now(),
  confirmed_by uuid references sonario.profiles(id),
  confirmed_at timestamptz,
  check (ends_on >= starts_on)
);

create index if not exists rehearsals_date_idx on sonario.rehearsals(rehearsal_date);
create index if not exists rehearsal_rsvps_rehearsal_id_idx on sonario.rehearsal_rsvps(rehearsal_id);
create index if not exists checkins_rehearsal_id_idx on sonario.checkins(rehearsal_id);
create index if not exists attendance_confirmation_requests_rehearsal_id_idx on sonario.attendance_confirmation_requests(rehearsal_id);
create index if not exists away_dates_profile_id_idx on sonario.away_dates(profile_id);
create index if not exists away_dates_range_idx on sonario.away_dates(starts_on, ends_on);

drop trigger if exists rehearsals_set_updated_at on sonario.rehearsals;
create trigger rehearsals_set_updated_at before update on sonario.rehearsals
  for each row execute function sonario.set_updated_at();
drop trigger if exists rehearsal_rsvps_set_updated_at on sonario.rehearsal_rsvps;
create trigger rehearsal_rsvps_set_updated_at before update on sonario.rehearsal_rsvps
  for each row execute function sonario.set_updated_at();

alter table sonario.rehearsals enable row level security;
alter table sonario.rehearsal_rsvps enable row level security;
alter table sonario.checkins enable row level security;
alter table sonario.attendance_confirmation_requests enable row level security;
alter table sonario.attendance_corrections enable row level security;
alter table sonario.away_dates enable row level security;

drop policy if exists "members read rehearsals" on sonario.rehearsals;
create policy "members read rehearsals" on sonario.rehearsals for select using (sonario.is_active_member());
drop policy if exists "super manage rehearsals" on sonario.rehearsals;
create policy "super manage rehearsals" on sonario.rehearsals for all using (sonario.is_super()) with check (sonario.is_super());

drop policy if exists "members read rsvps" on sonario.rehearsal_rsvps;
create policy "members read rsvps" on sonario.rehearsal_rsvps for select using (sonario.is_active_member());
-- The core fix vs. the old free-text model: you can only ever write an RSVP as YOURSELF.
drop policy if exists "members write own rsvp" on sonario.rehearsal_rsvps;
create policy "members write own rsvp" on sonario.rehearsal_rsvps for insert
  with check (sonario.is_active_member() and profile_id = auth.uid());
drop policy if exists "members update own rsvp" on sonario.rehearsal_rsvps;
create policy "members update own rsvp" on sonario.rehearsal_rsvps for update
  using (profile_id = auth.uid());

drop policy if exists "members read checkins" on sonario.checkins;
create policy "members read checkins" on sonario.checkins for select using (sonario.is_active_member());
-- Same fix: nobody can check in as another member. Live check-ins only via the app (source is
-- constrained; friend_confirmed rows are written by a separate, more restrictive path below once
-- that feature exists — for now this policy only actually permits 'live' inserts in practice,
-- since nothing populates 'friend_confirmed' until Checkpoint 11).
drop policy if exists "members write own checkin" on sonario.checkins;
create policy "members write own checkin" on sonario.checkins for insert
  with check (sonario.is_active_member() and profile_id = auth.uid());

drop policy if exists "members read confirmation requests" on sonario.attendance_confirmation_requests;
create policy "members read confirmation requests" on sonario.attendance_confirmation_requests for select
  using (sonario.is_active_member());
drop policy if exists "members create own requests" on sonario.attendance_confirmation_requests;
create policy "members create own requests" on sonario.attendance_confirmation_requests for insert
  with check (sonario.is_active_member() and requester_id = auth.uid());
-- A confirmer can only respond to a request naming them, AND only if they themselves have a live
-- check-in for that same rehearsal — you can't vouch for someone if you weren't actually there.
drop policy if exists "confirmer responds if eligible" on sonario.attendance_confirmation_requests;
create policy "confirmer responds if eligible" on sonario.attendance_confirmation_requests for update
  using (
    confirmer_id = auth.uid()
    and exists (
      select 1 from sonario.checkins c
      where c.rehearsal_id = attendance_confirmation_requests.rehearsal_id
        and c.profile_id = auth.uid()
        and c.source = 'live'
    )
  );

drop policy if exists "members read corrections" on sonario.attendance_corrections;
create policy "members read corrections" on sonario.attendance_corrections for select using (sonario.is_active_member());
drop policy if exists "super write corrections" on sonario.attendance_corrections;
create policy "super write corrections" on sonario.attendance_corrections for insert
  with check (sonario.is_super() and corrected_by = auth.uid());

drop policy if exists "members read away dates" on sonario.away_dates;
create policy "members read away dates" on sonario.away_dates for select using (sonario.is_active_member());
drop policy if exists "members submit own away dates" on sonario.away_dates;
create policy "members submit own away dates" on sonario.away_dates for insert
  with check (sonario.is_active_member() and profile_id = auth.uid());
drop policy if exists "members cancel own pending away dates" on sonario.away_dates;
create policy "members cancel own pending away dates" on sonario.away_dates for update
  using (profile_id = auth.uid() and status = 'pending');
drop policy if exists "super confirms away dates" on sonario.away_dates;
create policy "super confirms away dates" on sonario.away_dates for update using (sonario.is_super());

-- ============================================================================
-- 7. Repertoire: part_labels, songs, song_assignments, recordings, rehearsal_songs
-- ============================================================================
create table if not exists sonario.part_labels (
  key text primary key,
  label text not null,
  assignable boolean not null default true,
  sort_order integer not null default 0
);

insert into sonario.part_labels (key, label, assignable, sort_order) values
  ('sop', 'Sop', true, 1),
  ('alto', 'Alto', true, 2),
  ('alto_1', 'Alto 1', true, 3),
  ('alto_2', 'Alto 2', true, 4),
  ('tenor', 'Tenor', true, 5),
  ('tenor_1', 'Tenor 1', true, 6),
  ('tenor_2', 'Tenor 2', true, 7),
  ('barry', 'Barry', true, 8),
  ('full_choir', 'Full choir', false, 9)
on conflict (key) do update set label = excluded.label, assignable = excluded.assignable, sort_order = excluded.sort_order;

create table if not exists sonario.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  composer text not null default '',
  voicing text not null default '',
  status text not null default 'learning' check (status in ('learning', 'performance_ready', 'retired')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sonario.song_assignments (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references sonario.songs(id) on delete cascade,
  profile_id uuid not null references sonario.profiles(id) on delete cascade,
  part_label text not null references sonario.part_labels(key),
  updated_by uuid not null references sonario.profiles(id),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references sonario.profiles(id)
);

-- Assignable-only enforcement: a plain FK can't conditionally restrict on a second column, so a
-- trigger checks it. "Full choir" exists in part_labels (for recordings) but is rejected here.
create or replace function sonario.enforce_assignable_part()
returns trigger as $$
begin
  if not exists (select 1 from sonario.part_labels where key = new.part_label and assignable) then
    raise exception 'part_label % is not assignable to a person', new.part_label;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = '';

drop trigger if exists song_assignments_enforce_assignable on sonario.song_assignments;
create trigger song_assignments_enforce_assignable
  before insert or update on sonario.song_assignments
  for each row execute function sonario.enforce_assignable_part();

create table if not exists sonario.recordings (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references sonario.songs(id) on delete cascade,
  part_label text not null references sonario.part_labels(key),
  storage_path text not null,
  title text not null default '',
  uploaded_by uuid not null references sonario.profiles(id),
  uploaded_at timestamptz not null default now(),
  duration_seconds numeric,
  mime_type text not null check (mime_type in ('audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/wav')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 52428800)
);

create table if not exists sonario.rehearsal_songs (
  id uuid primary key default gen_random_uuid(),
  rehearsal_id uuid not null references sonario.rehearsals(id) on delete cascade,
  song_id uuid not null references sonario.songs(id) on delete cascade,
  position integer not null default 0
);

create index if not exists song_assignments_song_id_idx on sonario.song_assignments(song_id);
create index if not exists song_assignments_profile_id_idx on sonario.song_assignments(profile_id);
create index if not exists recordings_song_id_idx on sonario.recordings(song_id);
create index if not exists rehearsal_songs_rehearsal_id_idx on sonario.rehearsal_songs(rehearsal_id);

drop trigger if exists songs_set_updated_at on sonario.songs;
create trigger songs_set_updated_at before update on sonario.songs
  for each row execute function sonario.set_updated_at();

alter table sonario.part_labels enable row level security;
alter table sonario.songs enable row level security;
alter table sonario.song_assignments enable row level security;
alter table sonario.recordings enable row level security;
alter table sonario.rehearsal_songs enable row level security;

drop policy if exists "members read part labels" on sonario.part_labels;
create policy "members read part labels" on sonario.part_labels for select using (sonario.is_active_member());

drop policy if exists "members read songs" on sonario.songs;
create policy "members read songs" on sonario.songs for select using (sonario.is_active_member());
drop policy if exists "super manage songs" on sonario.songs;
create policy "super manage songs" on sonario.songs for all using (sonario.is_super()) with check (sonario.is_super());

drop policy if exists "members read song assignments" on sonario.song_assignments;
create policy "members read song assignments" on sonario.song_assignments for select using (sonario.is_active_member());
-- Collaborative editing: any active member (not just song owners) can insert/update, per the
-- brief. Removal is an archive (an update setting archived_at), so no delete policy exists here.
-- `profile_id` (whose part this is) is deliberately unrestricted here — collaborative editing
-- means assigning someone ELSE's part is exactly the point. `updated_by` is restricted to
-- yourself though, so the audit trail can't be spoofed to attribute a change to someone else.
drop policy if exists "members manage song assignments" on sonario.song_assignments;
create policy "members manage song assignments" on sonario.song_assignments for insert
  with check (sonario.is_active_member() and updated_by = auth.uid());
drop policy if exists "members update song assignments" on sonario.song_assignments;
create policy "members update song assignments" on sonario.song_assignments for update
  using (sonario.is_active_member()) with check (updated_by = auth.uid());

drop policy if exists "members read recordings" on sonario.recordings;
create policy "members read recordings" on sonario.recordings for select using (sonario.is_active_member());
drop policy if exists "members upload recordings" on sonario.recordings;
create policy "members upload recordings" on sonario.recordings for insert
  with check (sonario.is_active_member() and uploaded_by = auth.uid());
drop policy if exists "uploader or super deletes recordings" on sonario.recordings;
create policy "uploader or super deletes recordings" on sonario.recordings for delete
  using (uploaded_by = auth.uid() or sonario.is_super());

drop policy if exists "members read rehearsal songs" on sonario.rehearsal_songs;
create policy "members read rehearsal songs" on sonario.rehearsal_songs for select using (sonario.is_active_member());
drop policy if exists "super manage rehearsal songs" on sonario.rehearsal_songs;
create policy "super manage rehearsal songs" on sonario.rehearsal_songs for all using (sonario.is_super()) with check (sonario.is_super());

-- ============================================================================
-- 8. Rehearsal recaps (structure only — publishing/notification logic is Checkpoint 13)
-- ============================================================================
create table if not exists sonario.rehearsal_recaps (
  id uuid primary key default gen_random_uuid(),
  rehearsal_id uuid not null references sonario.rehearsals(id) on delete cascade,
  summary_text text not null default '',
  published boolean not null default false,
  published_by uuid references sonario.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rehearsal_id)
);

create table if not exists sonario.rehearsal_recap_items (
  id uuid primary key default gen_random_uuid(),
  recap_id uuid not null references sonario.rehearsal_recaps(id) on delete cascade,
  song_id uuid references sonario.songs(id) on delete set null,
  recording_id uuid references sonario.recordings(id) on delete set null,
  note text not null default '',
  position integer not null default 0
);

drop trigger if exists rehearsal_recaps_set_updated_at on sonario.rehearsal_recaps;
create trigger rehearsal_recaps_set_updated_at before update on sonario.rehearsal_recaps
  for each row execute function sonario.set_updated_at();

alter table sonario.rehearsal_recaps enable row level security;
alter table sonario.rehearsal_recap_items enable row level security;

-- Unpublished recaps are only visible to super users (the author drafting it); once published,
-- all active members can read it. Publishing itself (the notification side-effect) is Checkpoint 13.
drop policy if exists "recap visibility" on sonario.rehearsal_recaps;
create policy "recap visibility" on sonario.rehearsal_recaps for select
  using (published or sonario.is_super());
drop policy if exists "super manage recaps" on sonario.rehearsal_recaps;
create policy "super manage recaps" on sonario.rehearsal_recaps for all
  using (sonario.is_super()) with check (sonario.is_super());

drop policy if exists "recap items visibility" on sonario.rehearsal_recap_items;
create policy "recap items visibility" on sonario.rehearsal_recap_items for select
  using (exists (
    select 1 from sonario.rehearsal_recaps r
    where r.id = rehearsal_recap_items.recap_id and (r.published or sonario.is_super())
  ));
drop policy if exists "super manage recap items" on sonario.rehearsal_recap_items;
create policy "super manage recap items" on sonario.rehearsal_recap_items for all
  using (sonario.is_super()) with check (sonario.is_super());

-- ============================================================================
-- 9. Push infrastructure — INERT structure only. Nothing reads or writes these tables until
--    Checkpoint 14. Included now because retrofitting them onto live rehearsal/checkin data
--    later would be more disruptive than including empty tables today.
-- ============================================================================
create table if not exists sonario.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references sonario.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table if not exists sonario.notification_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references sonario.profiles(id) on delete cascade,
  type text not null,
  related_rehearsal_id uuid references sonario.rehearsals(id) on delete set null,
  dedupe_key text not null unique,
  sent_at timestamptz not null default now(),
  delivery_result text
);

alter table sonario.push_subscriptions enable row level security;
alter table sonario.notification_log enable row level security;

drop policy if exists "members manage own subscription" on sonario.push_subscriptions;
create policy "members manage own subscription" on sonario.push_subscriptions for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists "super reads notification log" on sonario.notification_log;
create policy "super reads notification log" on sonario.notification_log for select using (sonario.is_super());

-- ============================================================================
-- 10. Realtime — same guarded pattern already used in this project (alter publication ... add
--     table errors if already a member, so this checks first, keeping the whole script re-runnable).
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'rehearsals', 'rehearsal_rsvps', 'checkins', 'attendance_confirmation_requests', 'away_dates',
    'songs', 'song_assignments', 'recordings', 'rehearsal_songs', 'rehearsal_recaps', 'rehearsal_recap_items',
    'memberships'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'sonario' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table sonario.%I', t);
    end if;
  end loop;
end $$;

-- ============================================================================
-- 11. First-super-user bootstrap — DO NOT RUN THIS YET.
--     This requires a real auth.users row created by Google sign-in, which doesn't exist until
--     Checkpoint 3 ships. Documented here for reference; the actual run happens after Checkpoint 3,
--     using Nina's real profile_id (found via the query below), never a guessed/assumed value.
-- ============================================================================
-- Step 1 (after Checkpoint 3, after signing in with Google for the first time), find your own
-- profile_id:
--   select id, display_name, google_email from sonario.profiles where google_email = 'YOUR_EMAIL_HERE';
--
-- Step 2, bootstrap yourself as the first super user. The `not exists` guard makes this a no-op
-- the moment any super user already exists — safe to leave this exact statement lying around,
-- it cannot be reused to create a second super user or re-triggered after the first real use:
--   update sonario.memberships
--   set role = 'super', status = 'active', decided_at = now()
--   where profile_id = 'YOUR_PROFILE_ID_HERE'
--   and not exists (select 1 from sonario.memberships where role = 'super');
