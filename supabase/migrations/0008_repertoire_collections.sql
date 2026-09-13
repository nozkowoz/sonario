-- ============================================================================
-- 0008 — Repertoire collections (Stage 1 of Repertoire/Practice Mode)
--
-- Schema + RLS only, agreed 2026-09-13. No UI, no Storage — those are later stages.
--
-- Adds two tables so songs can be grouped into named, ordered collections — the Figma's
-- "Semester 2 · 2026" (current), "Semester 1 · 2026", "Sonario Classics · All-time favourites".
-- A join table rather than a column on `songs`, because a song can belong to more than one
-- collection over time (e.g. added to Classics after already sitting in a semester) — the same
-- shape `rehearsal_songs` already uses for setlists.
--
-- Also adds the one recordings policy 0001 was missing: an UPDATE for the uploader or a super,
-- so metadata (title, etc.) can be corrected without deleting and re-uploading the audio file.
-- ============================================================================

create table if not exists sonario.song_collections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('semester', 'classics')),
  -- Only a semester can ever be "current" — Sonario Classics is all-time by definition and has
  -- no current/not-current state. Enforced here, not left for the UI to respect on its own.
  is_current boolean not null default false check (kind = 'semester' or is_current = false),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one collection is ever current, system-wide. A unique index on `is_current` itself,
-- filtered to only the rows where it's true, is the standard way to enforce "at most one row with
-- flag = true" — every qualifying row indexes the same value, so a second one collides.
create unique index if not exists song_collections_one_current_idx
  on sonario.song_collections (is_current) where is_current;

create table if not exists sonario.song_collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references sonario.song_collections(id) on delete cascade,
  song_id uuid not null references sonario.songs(id) on delete cascade,
  -- Explicit manual ordering within a collection, not alphabetical — a super sets this per song.
  -- Plain integer, client-assigned; no trigger auto-increments it, same as rehearsal_songs.position.
  position integer not null default 0,
  unique (collection_id, song_id)
);

create index if not exists song_collection_items_collection_id_idx
  on sonario.song_collection_items(collection_id);
create index if not exists song_collection_items_song_id_idx
  on sonario.song_collection_items(song_id);

drop trigger if exists song_collections_set_updated_at on sonario.song_collections;
create trigger song_collections_set_updated_at before update on sonario.song_collections
  for each row execute function sonario.set_updated_at();

alter table sonario.song_collections enable row level security;
alter table sonario.song_collection_items enable row level security;

drop policy if exists "members read collections" on sonario.song_collections;
create policy "members read collections" on sonario.song_collections
  for select using (sonario.is_active_member());
drop policy if exists "super manage collections" on sonario.song_collections;
create policy "super manage collections" on sonario.song_collections
  for all using (sonario.is_super()) with check (sonario.is_super());

drop policy if exists "members read collection items" on sonario.song_collection_items;
create policy "members read collection items" on sonario.song_collection_items
  for select using (sonario.is_active_member());
drop policy if exists "super manage collection items" on sonario.song_collection_items;
create policy "super manage collection items" on sonario.song_collection_items
  for all using (sonario.is_super()) with check (sonario.is_super());

-- Belt-and-braces base grants: `alter default privileges` in 0000 already covers new tables
-- created by the same role (postgres, via the SQL editor), but this project has been bitten
-- before by a grant silently not applying — see 0000's own history. Cheap, idempotent, harmless
-- if redundant.
grant all on sonario.song_collections, sonario.song_collection_items to anon, authenticated;

-- --- The one missing recordings policy --------------------------------------
-- 0001 gave recordings insert (upload) and delete (uploader-or-super), but no update — so a
-- typo'd title could only be fixed by deleting and re-uploading the whole audio file. This adds
-- metadata correction without touching the underlying file.
drop policy if exists "uploader or super updates recording metadata" on sonario.recordings;
create policy "uploader or super updates recording metadata" on sonario.recordings
  for update
  using (uploaded_by = auth.uid() or sonario.is_super())
  with check (uploaded_by = auth.uid() or sonario.is_super());

-- --- Realtime ----------------------------------------------------------------
-- Same guarded pattern as 0001 §10, so the Repertoire UI gets live updates once it exists —
-- consistent with songs/song_assignments/recordings/rehearsal_songs already being on this list.
do $$
declare
  t text;
begin
  foreach t in array array['song_collections', 'song_collection_items']
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
-- Verification — run after applying. Expect every `actual` to equal its `expected`.
-- ============================================================================
select 'tables' as check_name, '2' as expected,
  (select count(*)::text from information_schema.tables
   where table_schema = 'sonario' and table_name in ('song_collections', 'song_collection_items')) as actual
union all
select 'song_collections policies', '2',
  (select count(*)::text from pg_policies where schemaname = 'sonario' and tablename = 'song_collections')
union all
select 'song_collection_items policies', '2',
  (select count(*)::text from pg_policies where schemaname = 'sonario' and tablename = 'song_collection_items')
union all
select 'recordings policies (now 4)', '4',
  (select count(*)::text from pg_policies where schemaname = 'sonario' and tablename = 'recordings')
union all
select 'one-current partial unique index', '1',
  (select count(*)::text from pg_indexes where schemaname = 'sonario' and indexname = 'song_collections_one_current_idx')
union all
select 'realtime tables added', '2',
  (select count(*)::text from pg_publication_tables where pubname = 'supabase_realtime'
   and schemaname = 'sonario' and tablename in ('song_collections', 'song_collection_items'));

-- ============================================================================
-- Rollback
-- ============================================================================
-- drop policy if exists "uploader or super updates recording metadata" on sonario.recordings;
-- alter publication supabase_realtime drop table sonario.song_collection_items;
-- alter publication supabase_realtime drop table sonario.song_collections;
-- drop table if exists sonario.song_collection_items;
-- drop table if exists sonario.song_collections;
