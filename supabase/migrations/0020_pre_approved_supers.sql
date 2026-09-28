-- ============================================================================
-- 0020 — Pre-approved supers: skip the approval queue for named leadership.
--
-- Nina, 2026-09-28: when Sean/Jo/Amy/Sass actually sign in, they shouldn't land in the
-- pending-approval queue like every other new member — they should get super access
-- immediately, the moment they sign in with the Google account whose email is on this list.
--
-- `sonario.pre_approved_members` is deliberately tiny: email -> role. handle_new_auth_user()
-- (0001_foundation.sql) now checks it BEFORE inserting the membership row, and if the signing-in
-- email matches, creates an already-`active` membership at that role instead of the usual
-- `pending`/`member` default. Nobody's own sign-in can add themselves to this list — it's
-- populated only by a super, via direct SQL for now (no Admin UI yet; add one if this needs to
-- happen often).
-- ============================================================================

create table if not exists sonario.pre_approved_members (
  email text primary key,
  role text not null default 'member' check (role in ('member', 'super')),
  note text not null default '',
  created_at timestamptz not null default now()
);

grant select on sonario.pre_approved_members to service_role;
-- No anon/authenticated grants at all — this table has no member-facing reason to be readable,
-- and RLS on a super-only table is a second lock on a door with no other doors, not a boundary
-- anything relies on. Only super's own migrations/direct SQL touch it. Revoked from PUBLIC by
-- the same blanket revoke every other function in 0001 uses, for symmetry:
revoke all on sonario.pre_approved_members from public, anon, authenticated;
grant all on sonario.pre_approved_members to postgres;

create or replace function sonario.handle_new_auth_user()
returns trigger as $$
declare
  approved sonario.pre_approved_members;
begin
  insert into sonario.profiles (id, display_name, google_email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  select * into approved from sonario.pre_approved_members where email = new.email;

  if approved.email is not null then
    insert into sonario.memberships (profile_id, status, role, decided_at)
    values (new.id, 'active', approved.role, now())
    on conflict (profile_id) do nothing;
  else
    insert into sonario.memberships (profile_id)
    values (new.id)
    on conflict (profile_id) do nothing;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = '';

-- Seed rows go here once Nina supplies the real sign-in emails for Sean/Jo/Amy/Sass — deliberately
-- left empty in this migration so it's safe to run before those emails are known, e.g.:
-- insert into sonario.pre_approved_members (email, role) values ('sean@example.com', 'super');
