-- ============================================================================
-- 0011 — Song lyrics (Stage 1 of Song Detail redesign / lyrics release)
--
-- Schema + RLS only, agreed 2026-09-14. No UI yet.
--
-- Deliberately a separate table, not columns on `songs`. Members already SELECT `songs` rows
-- for ordinary Repertoire browsing (title, composer, status, etc.) — putting unreleased lyrics
-- on that same row would mean an unreleased song's lyrics live inside a row members can already
-- read, relying on column-level care in every future `songs` query to not leak it. A separate
-- table with its own RLS means "can this member see this song" and "can this member see this
-- song's lyrics" are two independent questions, enforced independently.
--
-- One row per song (song_id is unique) — release state is a property of the song itself, not of
-- a particular semester/collection it appears in. Once released, lyrics stay released even if
-- the song is retaught in a later term. A super's "Hide lyrics" action (accidental release or
-- corrections) is just clearing released_at back to null — no separate status/boolean needed.
--
-- updated_by / released_by are NOT client-suppliable, even though a super's insert/update would
-- otherwise legitimately pass RLS: a BEFORE trigger overwrites both from auth.uid() every time,
-- so nothing sent by the client for these two columns is ever trusted (see
-- enforce_lyrics_audit() below). Same shape as checkins.checked_in_at in 0003.
--
-- No Realtime here (deliberately, agreed 2026-09-14): nothing in the product needs a released
-- lyric to appear live in an already-open screen the instant it happens — Song Detail can just
-- fetch on open/refresh. Future push notifications are a separate system layered on top of the
-- Release action itself, not on this table's replication.
-- ============================================================================

create table if not exists sonario.song_lyrics (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references sonario.songs(id) on delete cascade,
  lyrics text not null default '',
  released_at timestamptz,
  released_by uuid references sonario.profiles(id),
  updated_by uuid references sonario.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists song_lyrics_song_id_idx on sonario.song_lyrics(song_id);

drop trigger if exists song_lyrics_set_updated_at on sonario.song_lyrics;
create trigger song_lyrics_set_updated_at before update on sonario.song_lyrics
  for each row execute function sonario.set_updated_at();

-- --- Server-derived audit columns --------------------------------------------
-- updated_by always becomes the acting user, on every insert and every update, regardless of
-- what the client sent. released_by only moves when released_at actually transitions from null
-- to a timestamp (a genuine Release action) — editing already-released lyrics' text, or leaving
-- released_at untouched on an update, must not silently reassign credit for the original release
-- to whoever happens to save next. Hide lyrics (released_at set back to null) clears released_by
-- too, so a later re-release always re-stamps the super who actually did it.
create or replace function sonario.enforce_lyrics_audit()
returns trigger as $$
begin
  new.updated_by = auth.uid();

  if new.released_at is null then
    new.released_by = null;
  elsif tg_op = 'INSERT' then
    new.released_by = auth.uid();
  elsif old.released_at is null then
    new.released_by = auth.uid();
  else
    new.released_by = old.released_by;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = '';

drop trigger if exists song_lyrics_enforce_audit on sonario.song_lyrics;
create trigger song_lyrics_enforce_audit
  before insert or update on sonario.song_lyrics
  for each row execute function sonario.enforce_lyrics_audit();

revoke execute on function sonario.enforce_lyrics_audit() from public;

alter table sonario.song_lyrics enable row level security;

-- Supers: full read/write of every row regardless of release state (drafting/editing unreleased
-- lyrics, releasing, and hiding are all covered by this one policy).
drop policy if exists "super manage lyrics" on sonario.song_lyrics;
create policy "super manage lyrics" on sonario.song_lyrics
  for all using (sonario.is_super()) with check (sonario.is_super());

-- Active members: read-only, and only rows that have actually been released. is_active_member()
-- already excludes pending/deactivated accounts, so they fall through both policies to nothing.
drop policy if exists "members read released lyrics" on sonario.song_lyrics;
create policy "members read released lyrics" on sonario.song_lyrics
  for select using (sonario.is_active_member() and released_at is not null);

-- Belt-and-braces base grant — see 0008's note on why this is added even though `alter default
-- privileges` in 0000 should already cover it.
grant all on sonario.song_lyrics to anon, authenticated;

-- HOOK FOR LATER, do not build now: once the push-notification project (queued after invoicing)
-- exists, it should attach to the client-side release call (store.js's releaseLyrics(), added in
-- Stage 2) and fire a notification the moment released_at transitions from null to a timestamp.

-- ============================================================================
-- Verification — run after applying. Expect every `actual` to equal its `expected`.
-- ============================================================================
select 'table exists' as check_name, '1' as expected,
  (select count(*)::text from information_schema.tables
   where table_schema = 'sonario' and table_name = 'song_lyrics') as actual
union all
select 'one row per song (unique index)', '1',
  (select count(*)::text from pg_indexes where schemaname = 'sonario' and indexname = 'song_lyrics_song_id_idx')
union all
select 'policies (super manage + members read released)', '2',
  (select count(*)::text from pg_policies where schemaname = 'sonario' and tablename = 'song_lyrics')
union all
select 'triggers (updated_at + audit enforcement)', '2',
  (select count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'song_lyrics' and not t.tgisinternal)
union all
select 'not in realtime (deliberate)', '0',
  (select count(*)::text from pg_publication_tables where pubname = 'supabase_realtime'
   and schemaname = 'sonario' and tablename = 'song_lyrics');

-- ============================================================================
-- Rollback
-- ============================================================================
-- drop policy if exists "members read released lyrics" on sonario.song_lyrics;
-- drop policy if exists "super manage lyrics" on sonario.song_lyrics;
-- drop trigger if exists song_lyrics_enforce_audit on sonario.song_lyrics;
-- drop function if exists sonario.enforce_lyrics_audit();
-- drop trigger if exists song_lyrics_set_updated_at on sonario.song_lyrics;
-- drop table if exists sonario.song_lyrics;
