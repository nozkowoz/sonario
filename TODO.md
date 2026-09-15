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
- ~~**Melbourne Cup Day shouldn't say "cancelled."**~~ DONE 2026-09-15 — migration `0012_public_holidays_and_checkin_backfill.sql` adds `rehearsals.status = 'not_scheduled'`, shown everywhere as "No rehearsal (public holiday)"; Admin's event kebab menu has the option for every future public holiday too. Migration written, NOT yet applied — Nina still needs to paste it.
- **Push notification rule: first + last Tuesday of every term.** Nina, 2026-09-14: when the push-notifications project is built, add a scheduled notification sent on the first and last Tuesday of each term (in addition to whatever the Push Notification Rules doc already specifies for recaps/lyrics-release/etc. — comparison delivered 2026-09-13, not yet implemented). Needs term start/end dates as the trigger source, so depends on however Terms end up modelled (see the term-boundary/school-holidays item above) — not scoped further yet.
- ~~**Super-only import of past-term attendance.**~~ DONE 2026-09-15 — same migration adds a `super_backfill` checkins source + insert/delete policies, and Admin > Attendance is now a real per-member-per-week checklist (rehearsals only, past weeks only), writing to `attendance_corrections` for an audit trail. Migration written, NOT yet applied.
- **"You're here" shouldn't outlive the rehearsal.** Nina, 2026-09-15 (found live-testing check-in): after the event's end time (she saw it past 9pm), the check-in status still reads "You're here" — should stop showing that once the rehearsal is over. Small bug, not a new feature — needs the check-in badge logic to compare against the event's end_time, not just whether a checkins row exists. Still open — not part of the 2026-09-15 checkin work, which was scoped to backfill/edit-time only.
- ~~**Editable check-in time (best-guess correction).**~~ DONE 2026-09-15 — same migration adds an own-row-or-super UPDATE policy on `checkins`; `CheckInPanel` has an "Edit time" control, no time window, no separate "verified" state (Nina's explicit call: "I think we don't need it 'verified'"). Migration written, NOT yet applied.
- **Social events need a real Going/Not going/Maybe RSVP, not the rehearsal "You're expected" default.** Nina, 2026-09-15: `checkin.js`'s `AttendanceStatus` currently shows "You're expected — See you there!" for ANY future event nobody's marked a status on, including `event_type === 'social'` — wrong, since a social is optional unlike a rehearsal. Confirmed answer: social events should show a genuine three-state Going/Not going/Maybe RSVP. `useSocialEvents`/`useSocialRsvps` already exist in `store.js` (reading `social_events`/`social_rsvps`) but aren't wired to any UI or mutation function yet — this is a real feature to scope (RSVP write function + UI + how it interacts with `AttendanceStatus`'s existing rehearsal-only assumption), not a one-line fix. Not started.

## Build queue, agreed 2026-09-14

1. Song Detail redesign + lyrics release (in progress — Stage 1 migration `0011_song_lyrics.sql` drafted, awaiting approval to test/apply)
2. Invoicing (see "Invoice generation and emailing" above)
3. Push notifications (see Push Notification Rules doc comparison + the term-boundary rule above)
