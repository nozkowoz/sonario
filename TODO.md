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

## Future feature ideas — not scoped, added 2026-09-13

- **Repertoire: preload + release lyrics.** Store a song's lyrics ahead of a rehearsal, hidden from members. Sean can "release" it once he announces what they're doing — triggers a push notification to everyone, and only then do the lyrics become visible to them. Would sit on top of the existing `songs`/`rehearsal_songs` schema (see HANDOVER §5) but needs a "released" state on top of it, plus the push notification infrastructure (Checkpoint 14, not built yet).
- **Invoice generation and emailing.** Replaces Sean's manual per-term process (identical template, one PDF per member, hand-created each time). Amount is flat/identical for every member, no per-person variation.
  - v1: generate a PDF per active member from a template (client-side, no new backend needed — same pattern as everything else in this app). Sean still sends them himself.
  - v2 (the actually-wanted end state): the app sends them, plus automatic reminders to whoever hasn't paid. Needs a Supabase Edge Function + a transactional email service (Resend fits alongside Supabase), since a static site can't hold an email API key safely. Also needs a small `invoices` table (per member per term: sent/paid status, sent_at) to know who to remind and to stop reminding once paid.
- **Calendar/Home: clearer term boundaries + school holidays.** Nina, 2026-09-13: make it more visually obvious which dates fall in Term 3 vs Term 4, and show the school-holiday gap explicitly ("No rehearsals — school holidays") rather than just a blank stretch.
- **Melbourne Cup Day shouldn't say "cancelled."** Nina, 2026-09-13: that rehearsal was never planned in the first place (public holiday), so "cancelled" is the wrong word — it implies something was called off. Still needs to visibly show as "not on," just not with cancellation language. Relates to `DESIGN-RULES.md`'s existing note that `rehearsals.status` only has `scheduled`/`cancelled` — this is a similar case to the flagged-but-not-built "Tentative" status; may need a third status or a separate "never scheduled" concept rather than reusing cancelled.
- **Push notification rule: first + last Tuesday of every term.** Nina, 2026-09-14: when the push-notifications project is built, add a scheduled notification sent on the first and last Tuesday of each term (in addition to whatever the Push Notification Rules doc already specifies for recaps/lyrics-release/etc. — comparison delivered 2026-09-13, not yet implemented). Needs term start/end dates as the trigger source, so depends on however Terms end up modelled (see the term-boundary/school-holidays item above) — not scoped further yet.
- **Super-only import of past-term attendance.** Nina, 2026-09-15: let supers (Sean, Amy, Jo) backfill attendance for a term that predates the app. Likely home is `sonario.attendance_corrections` (0003's note: "a super fixing someone else's attendance is the job of attendance_corrections... at a later checkpoint" — already has an audit trail for who corrected what and why) rather than the live `checkins` table, since 0003's checkin insert policy deliberately restricts check-ins to the event's actual day and this is retroactive by definition. Needs a bulk/import-shaped UI (per-rehearsal-per-member grid or CSV-style paste), not the one-at-a-time correction flow that table was built for — flagging that mismatch now rather than assuming the existing correction UI (if any exists yet) just scales up.

## Build queue, agreed 2026-09-14

1. Song Detail redesign + lyrics release (in progress — Stage 1 migration `0011_song_lyrics.sql` drafted, awaiting approval to test/apply)
2. Invoicing (see "Invoice generation and emailing" above)
3. Push notifications (see Push Notification Rules doc comparison + the term-boundary rule above)
