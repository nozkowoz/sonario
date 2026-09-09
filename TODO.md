# TODO

## Rebuild in progress (2026-09-09 onward)

Sonario is mid-rebuild onto real accounts (Google auth), membership approval, attendance/
punctuality tracking, recordings + practice mode, away dates, and rehearsal recaps. Full
architecture (schema, RLS, notifications, storage, PWA limitations) and the 16-checkpoint plan
are in Claude Code's saved plan for this project — ask Claude to re-surface it if this file is
your only reference. Work proceeds one checkpoint at a time, each stopped for explicit approval
before the next starts. Do not resume the old feature backlog below until the rebuild is
checkpoint-complete — most of it is superseded by the rebuild brief.

**Checkpoint status:**
- [x] 1 — Architecture (reviewed and approved)
- [~] 2 — Database foundation (in progress — see `supabase/migrations/0001_foundation.sql`)
- [ ] 3 — Google sign-in + approval queue
- [ ] 4 — Visual system + app shell
- [ ] 5 — Home + rehearsals (maintenance screen comes down at the end of this one)
- [ ] 6–16 — see the plan

## Superseded by the rebuild (kept for reference only, do not action separately)

- Push notifications, real per-account logins, direct recording uploads, practice playlist,
  per-person super passphrases — all now part of the rebuild brief above, scoped properly there
  rather than as standalone items here.

## Genuinely still separate, not part of the rebuild brief

- Swap the placeholder "S" icon for something more Sonario (icons/*) — do this whenever, unrelated to the rebuild
- A "next rehearsal" summary if Home's design in Checkpoint 5 doesn't already cover it
- Paste-in quick-add for rehearsal/event details copied from WhatsApp (manual copy-paste works fine today; this would just save the retyping)
