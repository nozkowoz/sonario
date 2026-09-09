-- ============================================================================
-- 0004 — Stop anonymous sign-ins creating Sonario membership requests.
--
-- THE BUG. `sonario.handle_new_auth_user()` is a trigger on `auth.users` INSERT, and it fired for
-- *every* new auth identity regardless of what created it. This Supabase project is shared with
-- Nina's other app, Page Turners, which signs its users in anonymously
-- (`signInAnonymously()`) — so every single Page Turners visitor was silently creating a
-- `sonario.profiles` row and a `pending` `sonario.memberships` row. Sonario's approval queue was
-- filling up with phantom "New member" requests from people who have never heard of the choir:
-- nine of them appeared in a 75-minute window on 2026-09-09 while this was being diagnosed.
--
-- NOT a security hole — those rows are `pending`, and every Sonario policy is gated on
-- `is_active_member()` or `is_super()`, so an anonymous identity could never read choir data.
-- It's a data-quality bug, and a bad one: an approval queue nobody can trust is an approval queue
-- nobody will use, and the real requests get lost among the noise.
--
-- THE FIX. Skip anonymous identities. A member of the choir arrives via Google or an email magic
-- link, both of which are non-anonymous; nothing in Sonario has any use for an anonymous one.
--
-- SIDE EFFECT ON TESTING, worth knowing before it surprises someone: the established test pattern
-- for this project (HANDOVER.md §9) is `signInAnonymously()` from the browser console, then
-- promoting that identity to active/super with direct SQL. That relied on this trigger creating
-- the profile and membership rows automatically — it no longer will. Test setup now has to insert
-- them explicitly, e.g.:
--
--   insert into sonario.profiles (id, display_name, google_email)
--   values ('<anon uuid>', 'Zed Tester', '');
--   insert into sonario.memberships (profile_id, status, role)
--   values ('<anon uuid>', 'active', 'super');
--
-- That's arguably an improvement: a test identity now exists because a test asked for it, rather
-- than as a side effect of signing in.
-- ============================================================================

create or replace function sonario.handle_new_auth_user()
returns trigger as $$
begin
  -- Anonymous identities belong to the other app sharing this Supabase project. They are not
  -- prospective choir members and must not land in the approval queue.
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;

  insert into sonario.profiles (id, display_name, google_email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'New member'),
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into sonario.memberships (profile_id)
  values (new.id)
  on conflict (profile_id) do nothing;

  return new;
end;
$$ language plpgsql security definer set search_path = '';

-- Clear out the phantom rows this bug already created. Scoped to anonymous identities that are
-- still `pending` and have never been decided on, so a real membership decision can't be caught
-- by it even if an anonymous identity had somehow been approved deliberately. Deleting the
-- profile cascades the membership away with it.
delete from sonario.profiles p
where exists (select 1 from auth.users u where u.id = p.id and u.is_anonymous)
  and exists (
    select 1 from sonario.memberships m
    where m.profile_id = p.id and m.status = 'pending' and m.decided_at is null
  );

-- ============================================================================
-- Rollback (run manually if this migration needs to be reverted)
-- ============================================================================
-- Restores the previous behaviour, phantom requests included. The deleted rows are not restored —
-- they were junk, and Page Turners visitors will regenerate equivalents immediately.
--
-- create or replace function sonario.handle_new_auth_user()
-- returns trigger as $$
-- begin
--   insert into sonario.profiles (id, display_name, google_email, avatar_url)
--   values (
--     new.id,
--     coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'New member'),
--     coalesce(new.email, ''),
--     new.raw_user_meta_data ->> 'avatar_url'
--   )
--   on conflict (id) do nothing;
--   insert into sonario.memberships (profile_id) values (new.id) on conflict (profile_id) do nothing;
--   return new;
-- end;
-- $$ language plpgsql security definer set search_path = '';
