-- ============================================================================
-- 0009 — The `recordings` Storage bucket + object policies (Stage 2)
--
-- Schema/RLS only, agreed 2026-09-13. No Repertoire UI yet.
--
-- Path shape agreed: {song_id}/{part_label}/{recording_id}.{ext} — matches the columns already
-- on sonario.recordings, so a Storage object's path is always derivable from its DB row and vice
-- versa.
--
-- DESIGN: rather than trying to authorise from the path string alone (the path has no uploader
-- identity in it — {song_id}/{part_label}/{recording_id} says nothing about who uploaded it),
-- every policy here JOINS storage.objects back to sonario.recordings on storage_path = name and
-- reuses the exact same predicates already proven correct on that table (is_active_member(),
-- uploaded_by = auth.uid(), is_super()). This is what "keep Storage RLS aligned with the existing
-- recordings table policies" means concretely — one source of truth for who can do what, not two
-- parallel authorisation systems that could drift apart.
--
-- CONSEQUENCE WORTH KNOWING: because insert requires a matching sonario.recordings row to
-- already exist with you as uploaded_by, the upload path is HARD-REQUIRED to be DB-row-first —
-- not just a client convention. Uploading straight to Storage without first inserting the row is
-- structurally impossible, which is exactly the ordering already agreed.
--
-- CONSEQUENCE FOR DELETE ORDER: because the delete policy also joins to the recordings row, the
-- Storage object must be deleted BEFORE the DB row, not after — deleting the DB row first would
-- remove the very thing the Storage policy checks against, and the Storage delete would then
-- always fail. This matches the agreed order (Storage object first, then DB row) but is worth
-- flagging as a hard dependency, not just a nicety.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

drop policy if exists "active members read recording objects" on storage.objects;
create policy "active members read recording objects" on storage.objects
  for select
  using (
    bucket_id = 'recordings'
    and sonario.is_active_member()
    and exists (select 1 from sonario.recordings r where r.storage_path = storage.objects.name)
  );

drop policy if exists "active members upload their own recording objects" on storage.objects;
create policy "active members upload their own recording objects" on storage.objects
  for insert
  with check (
    bucket_id = 'recordings'
    and sonario.is_active_member()
    and exists (
      select 1 from sonario.recordings r
      where r.storage_path = storage.objects.name
        and r.uploaded_by = auth.uid()
    )
  );

-- Mirrors the recordings table's delete policy exactly, including what it does NOT check: no
-- is_active_member() gate, same as 0001's "uploader or super deletes recordings". A deactivated
-- former member could still delete their own old recording, same as they already could at the
-- table level — not a new decision introduced here, just carried across consistently.
drop policy if exists "uploader or super deletes recording objects" on storage.objects;
create policy "uploader or super deletes recording objects" on storage.objects
  for delete
  using (
    bucket_id = 'recordings'
    and exists (
      select 1 from sonario.recordings r
      where r.storage_path = storage.objects.name
        and (r.uploaded_by = auth.uid() or sonario.is_super())
    )
  );

-- No UPDATE policy on storage.objects: metadata correction (title etc.) lives on the
-- sonario.recordings row (0008's new UPDATE policy), never on the underlying file. Swapping the
-- audio itself stays delete-and-reupload, per the decision already made.

-- ============================================================================
-- Verification — run after applying
-- ============================================================================
select 'bucket exists and is private' as check_name,
  (select public::text from storage.buckets where id = 'recordings') as actual,
  case when (select public from storage.buckets where id = 'recordings') = false then 'ok' else 'WRONG' end as verdict
union all
select 'storage.objects policies on this bucket',
  (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects'
   and policyname in ('active members read recording objects',
                       'active members upload their own recording objects',
                       'uploader or super deletes recording objects')),
  case when (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname in ('active members read recording objects',
                                 'active members upload their own recording objects',
                                 'uploader or super deletes recording objects')) = 3
       then 'ok' else 'WRONG' end;

-- ============================================================================
-- Rollback
-- ============================================================================
-- drop policy if exists "active members read recording objects" on storage.objects;
-- drop policy if exists "active members upload their own recording objects" on storage.objects;
-- drop policy if exists "uploader or super deletes recording objects" on storage.objects;
-- delete from storage.objects where bucket_id = 'recordings';
-- delete from storage.buckets where id = 'recordings';
