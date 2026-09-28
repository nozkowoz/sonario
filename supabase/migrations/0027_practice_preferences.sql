-- Practice Mode's own remembered "what to practise" choice per member/song, deliberately
-- separate from song_assignments (the member's real choir part). Nina, 2026-09-28: a member whose
-- assigned part has no usable recording can pick a different one to practise with (including
-- full_choir), and Practice Mode should remember that choice next time rather than asking again.
-- One row per (song, member) — a preference has no history worth keeping, so it's a plain upsert,
-- never an archive-and-replace like song_assignments.
create table sonario.practice_preferences (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references sonario.songs(id) on delete cascade,
  profile_id uuid not null references sonario.profiles(id) on delete cascade,
  part_label text not null references sonario.part_labels(key),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (song_id, profile_id)
);

alter table sonario.practice_preferences enable row level security;

-- Member-only, both directions: profile_id = auth.uid() gates every command (select included), so
-- a member can never see or touch another member's practice preference. No super policy — this is
-- personal practice state, not choir administration data (Nina, 2026-09-28).
create policy "member manages own practice preferences"
  on sonario.practice_preferences for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

grant all on sonario.practice_preferences to anon, authenticated;
