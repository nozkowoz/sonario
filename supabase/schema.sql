-- Sonario — schema
-- Lives in its own `sonario` Postgres schema rather than `public`, so it can safely share a
-- Supabase project with another app (e.g. The Page Turners) without any risk of table-name
-- collisions or one app's future migrations touching the other's data. Run this once in the
-- Supabase SQL editor (Dashboard → SQL Editor → New query → Run) — safe to re-run.
--
-- One extra one-time step after running this: Dashboard → Project Settings → API → Exposed
-- schemas → add `sonario` alongside `public`. Without that, PostgREST won't serve this schema
-- and every request from the app will 404.

create schema if not exists sonario;

-- Unlike `public`, a freshly created schema grants the PostgREST API roles nothing by default —
-- without this, every request 42501s with "permission denied for schema sonario" regardless of
-- RLS policies or JWT claims (RLS only gets evaluated once these base grants already allow the
-- operation). `alter default privileges` covers tables/sequences/functions created later too, so
-- adding a table to this schema in future won't silently need this repeated.
grant usage on schema sonario to anon, authenticated;
grant all on all tables in schema sonario to anon, authenticated;
grant all on all sequences in schema sonario to anon, authenticated;
grant execute on all functions in schema sonario to anon, authenticated;
alter default privileges in schema sonario grant all on tables to anon, authenticated;
alter default privileges in schema sonario grant all on sequences to anon, authenticated;
alter default privileges in schema sonario grant execute on functions to anon, authenticated;

create table if not exists sonario.rehearsals (
  id uuid primary key default gen_random_uuid(),
  rehearsal_date date not null,
  start_time time,
  end_time time,
  location text not null default '',
  focus text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sonario.rehearsal_rsvps (
  id uuid primary key default gen_random_uuid(),
  rehearsal_id uuid not null references sonario.rehearsals(id) on delete cascade,
  member_name text not null,
  status text not null check (status in ('yes', 'no', 'maybe')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rehearsal_id, member_name)
);

-- Social events (~4/year, roughly one per term) — same shape as rehearsals but with a title,
-- since "End of Term 3 Trivia Night" needs a name in a way "the weekly rehearsal" doesn't.
create table if not exists sonario.social_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_date date not null,
  start_time time,
  end_time time,
  location text not null default '',
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sonario.social_rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references sonario.social_events(id) on delete cascade,
  member_name text not null,
  status text not null check (status in ('yes', 'no', 'maybe')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, member_name)
);

create table if not exists sonario.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  composer text not null default '',
  voicing text not null default '',
  status text not null default 'learning' check (status in ('learning', 'performance_ready', 'retired')),
  sheet_music_url text not null default '',
  recording_url text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Notice board: a flat feed, same loose trust model as a small-group chat — anyone can post,
-- anyone can delete (RLS-level), the UI just hides the delete control unless you're the author
-- or signed in with the super passphrase. `pinned` keeps important notices at the top; only
-- super can toggle it (enforced below, unlike delete).
create table if not exists sonario.notices (
  id uuid primary key default gen_random_uuid(),
  author_name text not null,
  message text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

-- Every name anyone has signed in as, so the sign-in screen can offer autocomplete without a
-- hardcoded seed list (choir membership changes; nobody wants to edit a JS file for that).
create table if not exists sonario.members (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists rehearsal_rsvps_rehearsal_id_idx on sonario.rehearsal_rsvps(rehearsal_id);
create index if not exists rehearsals_date_idx on sonario.rehearsals(rehearsal_date);
create index if not exists social_rsvps_event_id_idx on sonario.social_rsvps(event_id);
create index if not exists social_events_date_idx on sonario.social_events(event_date);
create index if not exists notices_pinned_created_idx on sonario.notices(pinned desc, created_at desc);

create or replace function sonario.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists rehearsals_set_updated_at on sonario.rehearsals;
create trigger rehearsals_set_updated_at
  before update on sonario.rehearsals
  for each row execute function sonario.set_updated_at();

drop trigger if exists rehearsal_rsvps_set_updated_at on sonario.rehearsal_rsvps;
create trigger rehearsal_rsvps_set_updated_at
  before update on sonario.rehearsal_rsvps
  for each row execute function sonario.set_updated_at();

drop trigger if exists social_events_set_updated_at on sonario.social_events;
create trigger social_events_set_updated_at
  before update on sonario.social_events
  for each row execute function sonario.set_updated_at();

drop trigger if exists social_rsvps_set_updated_at on sonario.social_rsvps;
create trigger social_rsvps_set_updated_at
  before update on sonario.social_rsvps
  for each row execute function sonario.set_updated_at();

drop trigger if exists songs_set_updated_at on sonario.songs;
create trigger songs_set_updated_at
  before update on sonario.songs
  for each row execute function sonario.set_updated_at();

-- Row Level Security. Two passphrases at sign-in (see js/auth.js) set a `role` of 'member' or
-- 'super' in the anonymous session's user_metadata, which lands in the JWT and is readable here
-- via auth.jwt(). Reads are open to anyone signed in either way. Writes to the "curated" content
-- — the rehearsal schedule and the song repertoire — are genuinely locked to 'super' at this
-- layer, not just hidden in the UI, since a chorister asked specifically for a real permission
-- split here. The notice board keeps the looser everyone-can-delete trust model instead.
alter table sonario.rehearsals enable row level security;
alter table sonario.rehearsal_rsvps enable row level security;
alter table sonario.social_events enable row level security;
alter table sonario.social_rsvps enable row level security;
alter table sonario.songs enable row level security;
alter table sonario.notices enable row level security;
alter table sonario.members enable row level security;

create or replace function sonario.is_super()
returns boolean as $$
  select coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'super';
$$ language sql stable;

drop policy if exists "members read rehearsals" on sonario.rehearsals;
create policy "members read rehearsals" on sonario.rehearsals for select using (auth.role() = 'authenticated');
drop policy if exists "super write rehearsals" on sonario.rehearsals;
create policy "super write rehearsals" on sonario.rehearsals for insert with check (sonario.is_super());
drop policy if exists "super update rehearsals" on sonario.rehearsals;
create policy "super update rehearsals" on sonario.rehearsals for update using (sonario.is_super());
drop policy if exists "super delete rehearsals" on sonario.rehearsals;
create policy "super delete rehearsals" on sonario.rehearsals for delete using (sonario.is_super());

drop policy if exists "members read rsvps" on sonario.rehearsal_rsvps;
create policy "members read rsvps" on sonario.rehearsal_rsvps for select using (auth.role() = 'authenticated');
drop policy if exists "members write rsvps" on sonario.rehearsal_rsvps;
create policy "members write rsvps" on sonario.rehearsal_rsvps for insert with check (auth.role() = 'authenticated');
drop policy if exists "members update rsvps" on sonario.rehearsal_rsvps;
create policy "members update rsvps" on sonario.rehearsal_rsvps for update using (auth.role() = 'authenticated');

drop policy if exists "members read social_events" on sonario.social_events;
create policy "members read social_events" on sonario.social_events for select using (auth.role() = 'authenticated');
drop policy if exists "super write social_events" on sonario.social_events;
create policy "super write social_events" on sonario.social_events for insert with check (sonario.is_super());
drop policy if exists "super update social_events" on sonario.social_events;
create policy "super update social_events" on sonario.social_events for update using (sonario.is_super());
drop policy if exists "super delete social_events" on sonario.social_events;
create policy "super delete social_events" on sonario.social_events for delete using (sonario.is_super());

drop policy if exists "members read social_rsvps" on sonario.social_rsvps;
create policy "members read social_rsvps" on sonario.social_rsvps for select using (auth.role() = 'authenticated');
drop policy if exists "members write social_rsvps" on sonario.social_rsvps;
create policy "members write social_rsvps" on sonario.social_rsvps for insert with check (auth.role() = 'authenticated');
drop policy if exists "members update social_rsvps" on sonario.social_rsvps;
create policy "members update social_rsvps" on sonario.social_rsvps for update using (auth.role() = 'authenticated');

drop policy if exists "members read songs" on sonario.songs;
create policy "members read songs" on sonario.songs for select using (auth.role() = 'authenticated');
drop policy if exists "super write songs" on sonario.songs;
create policy "super write songs" on sonario.songs for insert with check (sonario.is_super());
drop policy if exists "super update songs" on sonario.songs;
create policy "super update songs" on sonario.songs for update using (sonario.is_super());
drop policy if exists "super delete songs" on sonario.songs;
create policy "super delete songs" on sonario.songs for delete using (sonario.is_super());

drop policy if exists "members read notices" on sonario.notices;
create policy "members read notices" on sonario.notices for select using (auth.role() = 'authenticated');
drop policy if exists "members write notices" on sonario.notices;
create policy "members write notices" on sonario.notices for insert with check (auth.role() = 'authenticated');
drop policy if exists "members delete notices" on sonario.notices;
create policy "members delete notices" on sonario.notices for delete using (auth.role() = 'authenticated');
drop policy if exists "super pin notices" on sonario.notices;
create policy "super pin notices" on sonario.notices for update using (sonario.is_super());

-- members is readable by anyone, signed in or not — the sign-in screen's name autocomplete
-- needs this before an auth session exists.
drop policy if exists "anyone reads members" on sonario.members;
create policy "anyone reads members" on sonario.members for select using (true);
drop policy if exists "members write members" on sonario.members;
create policy "members write members" on sonario.members for insert with check (auth.role() = 'authenticated');

-- Realtime: push live changes to every open tab so the choir shares one live view.
-- `alter publication ... add table` errors if the table's already a member (not idempotent on
-- its own, unlike everything else in this file), so this loop checks first — makes the whole
-- script safe to re-run, including after the first time it's been run.
do $$
declare
  t text;
begin
  foreach t in array array['rehearsals', 'rehearsal_rsvps', 'social_events', 'social_rsvps', 'songs', 'notices', 'members']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'sonario' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table sonario.%I', t);
    end if;
  end loop;
end $$;
