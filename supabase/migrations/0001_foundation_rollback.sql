-- Rollback for 0001_foundation.sql
-- Run this to undo the Checkpoint 2 foundation migration and return the `sonario` schema to its
-- pre-rebuild state. Safe to run even if only part of 0001_foundation.sql was applied.
--
-- This does NOT restore the old rehearsals/rehearsal_rsvps/songs/members tables' data (there was
-- none — confirmed before the rebuild started). It restores their STRUCTURE. If you need the
-- exact pre-rebuild schema.sql to re-run after this rollback, it's preserved at git commit
-- 904ca9a (`git show 904ca9a:supabase/schema.sql`).

-- 1. Drop everything 0001_foundation.sql created, in dependency order.
drop table if exists sonario.notification_log cascade;
drop table if exists sonario.push_subscriptions cascade;
drop table if exists sonario.rehearsal_recap_items cascade;
drop table if exists sonario.rehearsal_recaps cascade;
drop table if exists sonario.rehearsal_songs cascade;
drop table if exists sonario.recordings cascade;
drop table if exists sonario.song_assignments cascade;
drop table if exists sonario.songs cascade;
drop table if exists sonario.part_labels cascade;
drop table if exists sonario.away_dates cascade;
drop table if exists sonario.attendance_corrections cascade;
drop table if exists sonario.attendance_confirmation_requests cascade;
drop table if exists sonario.checkins cascade;
drop table if exists sonario.rehearsal_rsvps cascade;
drop table if exists sonario.rehearsals cascade;
drop table if exists sonario.terms cascade;
drop table if exists sonario.memberships cascade;
drop table if exists sonario.profiles cascade;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists sonario.handle_new_auth_user();
drop function if exists sonario.enforce_assignable_part();
drop function if exists sonario.member_directory();
drop function if exists sonario.is_active_member();
-- is_super() and set_updated_at() are NOT dropped here — they pre-date this migration (the old
-- passphrase-based is_super() and the shared set_updated_at() trigger function are both still
-- referenced by the untouched social_events/social_rsvps/notices tables). If you need the OLD
-- is_super() implementation back (JWT user_metadata based) rather than just removing the new one,
-- restore it from git commit 904ca9a's supabase/schema.sql.

-- 2. Restore the old tables this migration dropped, in their pre-rebuild shape.
--    (Copy these definitions from `git show 904ca9a:supabase/schema.sql` if a full restore is
--    needed — omitted here to avoid this rollback file silently drifting out of sync with that
--    source of truth. The tables were: sonario.rehearsals, sonario.rehearsal_rsvps,
--    sonario.rehearsal_checkins, sonario.songs, sonario.members.)

-- 3. Restore the app itself: `git checkout 904ca9a -- index.html js/ css/ sw.js manifest.webmanifest`
--    then redeploy (push to main). This brings back the working passphrase-based app.
