-- ============================================================================
-- 0036 — Notify every active member when a song's lyrics are released
--
-- Nina's spec: send one push only on a TRUE release transition (released_at: NULL -> non-NULL).
-- No push for draft creation, editing draft lyrics, editing already-released lyrics, or hiding
-- lyrics again (released_at going back to NULL). The WHEN clauses below encode exactly that —
-- an ordinary lyrics edit (released_at unchanged) never matches either trigger.
--
-- Unlike the new-member-request notification (Admin/Super Admin only), this goes to every active
-- member — releasing lyrics is an announcement to the whole choir, not an operational alert.
-- ============================================================================

create or replace function sonario.notify_lyrics_released()
returns trigger
language plpgsql security definer set search_path to ''
as $$
declare
  service_key text;
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets where name = 'service_role_key' limit 1;

  if service_key is null then
    return new; -- never block the actual release action over this
  end if;

  perform net.http_post(
    url := 'https://rwkaofshfatqqkupeqoe.supabase.co/functions/v1/notify-lyrics-released',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object('songId', new.song_id)
  );
  return new;
end;
$$;

-- INSERT case: a lyrics row created already-released in one step (not how the current UI works,
-- but the same "true release transition" logic applies if it ever happens another way).
drop trigger if exists song_lyrics_notify_released_insert on sonario.song_lyrics;
create trigger song_lyrics_notify_released_insert
  after insert on sonario.song_lyrics
  for each row
  when (new.released_at is not null)
  execute function sonario.notify_lyrics_released();

-- UPDATE case: the real path today — draft created first, released separately.
drop trigger if exists song_lyrics_notify_released_update on sonario.song_lyrics;
create trigger song_lyrics_notify_released_update
  after update on sonario.song_lyrics
  for each row
  when (old.released_at is null and new.released_at is not null)
  execute function sonario.notify_lyrics_released();

-- ============================================================================
-- Verification
-- ============================================================================
select 'notify_lyrics_released() exists' as check_name, 'true' as expected,
  (exists (select 1 from pg_proc where proname = 'notify_lyrics_released' and pronamespace = 'sonario'::regnamespace))::text
union all
select 'insert trigger exists', 'true',
  (exists (select 1 from pg_trigger where tgname = 'song_lyrics_notify_released_insert'))::text
union all
select 'update trigger exists', 'true',
  (exists (select 1 from pg_trigger where tgname = 'song_lyrics_notify_released_update'))::text;
