# Sonario — Handover / Context Preservation

**Purpose of this file:** Nina is switching Claude Code accounts on the same laptop. This
document exists so a brand-new Claude session (no memory of prior conversations) can pick up
this project safely. Generated 2026-09-09 by inspecting the repo, git history, and the live
Supabase database directly — not from memory alone. Where something couldn't be verified from
the repo/database, it's marked as unconfirmed rather than guessed.

---

## 1. Project overview

**What it is:** Sonario is a personal web app Nina is building for her choir — replacing an
ad-hoc WhatsApp/paper workflow with a proper member app: rehearsal scheduling, attendance/
check-in, a song repertoire with per-part recordings, and a notice board.

**Who it's for:** A small community choir. Ordinary members get a simple, polished experience;
a handful of "super" users (committee/section leaders) get operational controls (scheduling,
approving members, managing records) layered on top of the same app, not a separate admin tool.

**Core product concept:** "A simple, polished choir-member experience with more powerful
operational controls available to admins when needed" — this exact phrase has been the stated
product priority throughout the rebuild and should keep steering scope calls.

**Current MVP scope (agreed 2026-09-09, see §8):** login/account, member/admin roles and
permissions, a simplified Home, events/rehearsals, a Calendar/"My Term" view, basic attendance/
check-in, core admin event management, and realistic seed/test data — deliberately excluding
profile photo upload, peer attendance verification ("Message a Friend"), advanced/push
notifications, public-holiday polish, recordings/practice mode, and the leaderboard, all of which
are real, already-designed future work, not abandoned.

**Important terminology:**
- **Checkpoint** — a unit of work in the original 16-step build plan (see §8). Each checkpoint is
  built, tested, and reported before the next starts.
- **Super** vs **member** — the two membership roles. Super = admin/operational access; member =
  ordinary choir member. Stored in `sonario.memberships.role`, never in the client.
- **Unified event model** — `rehearsals` is now the one table for every scheduled thing (Tuesday
  rehearsal, workshop, performance, social) via an `event_type` column, not a separate table per
  type. The table keeps its old name in the database; treat it as "events" conceptually in
  product/UI language. See Decision Log §6.
- **Absence-only attendance** — there is no Going/Maybe/Not-going RSVP. Every active member is
  assumed attending by default; a row in `rehearsal_absences` is the *only* signal that someone
  can't make it, and reversing it is just deleting that row.
- **Away dates** — a separate concept from an absence. `away_dates` records a date range a member
  is away (e.g. on leave); it suppresses notifications and is excluded from attendance maths, but
  is now private (own-row-or-super), not choir-visible — see Decision Log §6.

---

## 2. Current technical architecture

**Framework/languages:** Plain HTML/JS, zero build step, zero npm. Preact + `htm` loaded directly
from the `esm.sh` CDN (see `js/lib.js`). Same pattern as Nina's other app, "Page Turners."

**Important directories/files:**
```
index.html                 Loads the real app (`js/app.js` into `#root`) — the rebuild's maintenance screen came down at the end of Step C, per Decision 9. Its markup is in git history if ever needed
css/styles.css              All styling — CSS custom properties for the visual system (§5)
js/config.js                 Supabase URL/anon key + choir name + APP_VERSION (no secrets beyond the public anon key)
js/supabaseClient.js          Supabase client, pinned to the `sonario` Postgres schema
js/lib.js                      Preact/htm re-exports + shared date helpers (timezone-safe) + punctuality helper
js/auth.js                      Google OAuth sign-in screen + pending/declined/deactivated status screen
js/store.js                      Data hooks: useSession, useMyMembership, useAllMemberships, decideMembership,
                                  useLiveTable (generic realtime hook), plus OLD/DEAD hooks (see below)
js/approvals.js                   Super-only membership approval queue (approve/decline/deactivate/reactivate)
js/shell.js                        NEW (Checkpoint 4): LoadingState/EmptyState/ErrorState components, BottomNav
js/app.js                           Top-level app: auth gate → membership gate → Main shell (Home/Calendar/More tabs)
js/rehearsals.js, leaderboard.js,    OLD/DEAD — pre-rebuild passphrase-era components, not imported by app.js,
  repertoire.js, noticeboard.js,     reference tables/columns that no longer match the schema (e.g. rehearsal_rsvps,
  social.js                          rehearsal_checkins). Left in place deliberately, to be rebuilt against the new
                                      schema at their respective checkpoints, not deleted and not currently wired up.
supabase/migrations/*.sql             Versioned migrations, source of truth for schema (see §3)
supabase/schema.sql                    A STALE generated snapshot from before the rebuild — do not trust it,
                                        migrations are the real source of truth (README.md says otherwise; also stale)
manifest.webmanifest, sw.js, icons/     PWA install support. manifest theme_color is still the OLD purple
                                        (#6a4fd6) — not yet updated to match the #7052CD system built in Checkpoint 4.
```

**Database/backend:** Supabase (Postgres + Auth + Realtime). Project ref `jpffnazfjxvdzqnfueue`
("The Page Turners" — see below). Client is pinned to `db.schema = 'sonario'` so all app queries
implicitly target that schema.

**Authentication:** Google OAuth via Supabase Auth (`supabase.auth.signInWithOAuth({ provider:
'google' })`). A DB trigger (`sonario.handle_new_auth_user`) auto-creates a `profiles` row and a
`pending` `memberships` row on first sign-in — there's no separate "request access" screen.
**Unconfirmed / needs verification:** whether the Google Cloud OAuth client and the Supabase Auth
Google provider are actually configured and working — see §7 and §9. Zero real (non-anonymous)
users exist in the database as of this writing (see §3), so this flow has not been exercised for
real, only via anonymous-user stand-ins.

**Storage:** Not yet built. Planned for Checkpoint 7 (recording uploads) — a `recordings` bucket,
member-uploaded, ~50MB/file cap enforced at both the table (`recordings.file_size_bytes` check)
and (planned) bucket policy level. No Storage bucket exists yet.

**Hosting/deployment:** Vercel, project presumed named `sonario` under Nina's account, auto-
deploys on push to `main` of GitHub repo `nozkowoz/sonario`. **Important:** the local git history
is currently **5 commits ahead of `origin/main`** — Nina has not pushed since Checkpoint 2, so
as of 2026-09-09 local and `origin/main` are in step at `8358564` and the live deployment serves
the real app. That can drift again at any time, because Claude commits locally and Nina pushes
herself — so don't assume "deployed" matches "committed locally", check it. See §10.

**Environment/config structure:** `js/config.js` holds `SUPABASE_URL` and `SUPABASE_ANON_KEY`
(the anon key is meant to be public — RLS is the real boundary) plus `CHOIR_NAME` and
`APP_VERSION`. No `.env` file, no build-time secrets — this is a static site.

**External services:** Supabase (DB/auth/realtime, and later Storage + Edge Functions), Google
Cloud (OAuth client, owned under Nina's personal Google account per the approved architecture
plan), Vercel (hosting), GitHub (`nozkowoz/sonario`).

**How the pieces connect:** Browser loads static files from Vercel → `js/app.js` boots a Preact
tree → `supabaseClient.js` talks directly to Supabase's REST/Realtime API (no server layer at
all) → Postgres RLS policies are the actual authorization boundary, not the client code.

---

## 3. Current database state

**Shared Supabase project.** This project (`jpffnazfjxvdzqnfueue`) also hosts Nina's other app,
"Page Turners," in the `public` schema. Sonario is fully isolated in its own `sonario` schema —
confirmed via a cross-schema foreign-key check earlier in the rebuild (zero FKs cross between
`public` and `sonario`). Nothing in this handover concerns the `public`-schema tables.

### Confirmed current state (verified live, 2026-09-09)

**Tables in `sonario` schema (21 total, all with RLS enabled):**
`profiles`, `memberships`, `terms`, `rehearsals`, `rehearsal_absences`, `checkins`,
`attendance_confirmation_requests`, `attendance_corrections`, `away_dates`, `part_labels`,
`songs`, `song_assignments`, `recordings`, `rehearsal_songs`, `rehearsal_recaps`,
`rehearsal_recap_items`, `push_subscriptions`, `notification_log`, and three **pre-rebuild
leftovers**: `social_events`, `social_rsvps`, `notices` — these still use the old free-text
`member_name`/`author_name` columns (not `profile_id`), are not touched by any current
Checkpoint 2–4 code, and are explicitly slated for a small mechanical rebuild at Checkpoint 15
(per the architecture plan). Don't extend them as-is; don't delete them either.

**Key tables for the current MVP work:**
- `profiles` — `id` (= `auth.users.id`), `display_name`, `google_email`, `avatar_url`,
  `created_at`. `google_email` is not broadly readable — see RLS below.
- `memberships` — `id`, `profile_id` (unique), `status` (`pending`/`active`/`declined`/
  `deactivated`), `role` (`member`/`super`), `requested_at`, `decided_at`, `decided_by`. This is
  the **only** place role/status live — never in JWT/`user_metadata` (this was the specific
  security hole the whole rebuild started from — see §6).
- `rehearsals` — the unified event table. Columns: `id`, `term_id`, `rehearsal_date`,
  `start_time`, `end_time`, `location`, `status` (`scheduled`/`cancelled`), `created_at`,
  `updated_at`, plus (added in migration 0002) `event_type` (`rehearsal`/`workshop`/
  `performance`/`social`, default `'rehearsal'`), `counts_towards_attendance` (boolean, default
  `true`), `title` (nullable), `description` (default `''`).
- `rehearsal_absences` — `id`, `rehearsal_id`, `profile_id`, `noted_at`, unique
  `(rehearsal_id, profile_id)`. Presence of a row = the entire "can't make it" signal, no status
  column.
- `checkins` — `id`, `rehearsal_id`, `profile_id`, `checked_in_at` (nullable, server-default
  `now()`), `source` (`live`/`friend_confirmed`), unique `(rehearsal_id, profile_id)`, with a
  check constraint preventing a friend-confirmed row from ever carrying a timestamp.
- `away_dates` — `id`, `profile_id`, `starts_on`, `ends_on`, `note`, `status` (`pending`/
  `confirmed`/`cancelled`), `submitted_at`, `confirmed_by`, `confirmed_at`.
- `part_labels` — seeded lookup (Sop/Alto/Alto 1/Alto 2/Tenor/Tenor 1/Tenor 2/Barry, all
  assignable; Full Choir, not assignable).

**Security-definer functions (all `set search_path = ''`, `revoke ... from public`, `grant ... to
authenticated`):** `current_membership()`, `is_super()`, `is_active_member()`, `member_directory()`
(3-column safe directory read), `enforce_assignable_part()` (trigger), `handle_new_auth_user()`
(trigger, on `auth.users` insert), `set_updated_at()` (trigger).

**RLS model, the parts that matter most:**
- `checkins` and `rehearsal_absences`: **own-row-or-super only** — no member can read anyone
  else's attendance/absence record. This was a deliberate privacy correction mid-Checkpoint-2
  (see §6) — the original brief assumed these were choir-visible; they are not.
- `away_dates`: **own-row-or-super only** (tightened in migration 0002, 2026-09-09) — this
  reverses the *original* brief's "public away calendar" spec. See §6.
- `memberships`: self-approval is structurally blocked — the update policy requires
  `is_super() AND profile_id != auth.uid()`. A super user cannot promote or approve themselves
  via the app.
- **`profiles`: also own-row-or-super only, not just `checkins`/`away_dates`.** A regular member
  cannot `select` anyone else's profile row directly — `approvals.js`'s current profile lookups
  only work because that screen is super-only. **This matters for Step C/D:** any member-facing
  UI that needs to show *another* member's name (an attendee list, "who's coming," etc.) must go
  through the `sonario.member_directory()` RPC (returns only `id`/`display_name`/`avatar_url` for
  active members, gated on the caller also being active), not a direct `profiles` query — a
  direct query will silently return nothing for anyone but supers. `member_directory()` is not
  called from anywhere in the current code yet.
- Pending members see nothing except their own `memberships` row (for the "you're nearly in"
  screen) — no choir-data table has a select policy that matches a pending/declined/deactivated
  caller.

**Migrations applied (in order):**
1. `0001_foundation.sql` — full Checkpoint 2 schema + RLS (with the absence-only and
   checkins-privacy corrections folded in before it was ever run live — there was no separate
   "broken" version applied to the live DB).
2. `0002_events_and_privacy.sql` — unified event model columns on `rehearsals` +
   the `away_dates` privacy correction. Applied live 2026-09-09.

3. `0003_checkin_undo_window.sql` — the one-hour check-in undo policy, a trigger making
   `checked_in_at` server-owned, and the check-in-only-on-the-day insert rule (§6 decisions 13-14).
   Applied live 2026-09-09.
4. `0004_signup_trigger_skips_anonymous.sql` — `handle_new_auth_user()` now ignores anonymous
   identities. Applied live 2026-09-09. Fixes phantom `pending` membership requests generated by
   *Page Turners* visitors (that app shares this Supabase project and uses anonymous sign-in), and
   deletes the ones already created. Not a security hole — those rows were `pending`, and every
   policy is gated on `is_active_member()`/`is_super()` — but it made the approval queue
   untrustworthy. Changes the test-identity recipe; see §9.

All have matching rollback SQL (`0001_foundation_rollback.sql`, and commented rollback blocks at
the bottom of 0002, 0003 and 0004).

**Note on migration tracking:** Supabase's own migration history table only shows some of this
work under different naming (e.g. `checkpoint2_absence_only_correction`,
`sonario_0002_events_and_privacy`) — some earlier Checkpoint 2 changes were applied via raw SQL
execution rather than the `apply_migration` tool, so Supabase's migration ledger doesn't perfectly
mirror the files in `supabase/migrations/`. The `.sql` files in the repo are the accurate,
readable record; don't rely on Supabase's migration list alone to reconstruct history.

**Live data as of 2026-09-09 (second pass):** `profiles`: 8. `memberships`: 8. `terms`: 2.
`rehearsals`: 11. `rehearsal_absences`: 5. `checkins`: 21. **All of it is seed/test data** created
by `supabase/seed_test_data.sql` (Step E) — eight fake members with no password and no identity
row, so none of them can sign in. There is still **zero real product data** and no real Google
user. Re-running that file rebuilds the set; its teardown block removes it.

`auth.users` now holds exactly those 8 seeded rows and **no anonymous users**. The ~182 leftover
anonymous test identities that earlier sessions had accumulated (each promoted to a test role by
direct SQL and not always cleaned up afterwards) were deleted on 2026-09-09 with Nina's
agreement, scoped to anonymous users having no `profiles` row. Keep cleaning test identities up
per test rather than letting that build again.

### Planned / not yet implemented
- Storage buckets (Checkpoint 7).
- `push_subscriptions`/`notification_log` tables exist (inert) but nothing reads/writes them —
  Edge Function + `pg_cron` push infrastructure is designed (see the saved plan) but not built,
  deliberately deferred to Checkpoint 14 / post-MVP.
- `leaderboard_top3()` / `rehearsal_live_attendees()` RPCs — designed, not built (Checkpoint 10/11).
- The one-hour undo window policy on `checkins` (agreed 2026-09-09, see §6) — not yet applied;
  planned to land alongside the check-in UI build (Step D of the MVP run) so it can be tested
  against real functionality rather than sitting untested.
- `social_events`/`social_rsvps`/`notices` migration to `profile_id`-based ownership — designed,
  not started (Checkpoint 15).

---

## 4. What has already been built

| Feature | Status |
|---|---|
| `sonario` schema, RLS, security-definer functions (Checkpoint 2) | Implemented and verified (adversarial RLS testing done: self-approval, check-in-as-someone-else, role self-edit all confirmed blocked) |
| Google OAuth sign-in screen + membership status screens (Checkpoint 3) | Implemented; **sign-in flow itself not verified with a real Google account** — only simulated via anonymous test identities promoted by SQL. See §9. |
| Membership approval queue (approve/decline/deactivate/reactivate, bulk-approve) | Implemented and verified live (via anonymous test identities) |
| App shell: bottom nav (Home/Calendar/More), header, visual system (`#7052CD`) | Implemented and verified live (screenshotted through all three tabs as a super test identity) |
| Loading/empty/error state components (`js/shell.js`) | Loading and empty states verified live; **error state built but not exercised live** (would need a simulated network failure) |
| Unified event model (`event_type`, `counts_towards_attendance` on `rehearsals`) | Schema and UI both implemented and verified live — all four event types render, and `counts_towards_attendance` is shown independently of type |
| Away-dates privacy correction | Implemented and verified (RLS policy confirmed live via `pg_policies` query) |
| Home tab | Implemented (Step C) and verified live: greeting, next non-cancelled event, absence toggle, check-in on the day, organiser shortcuts for supers |
| Calendar tab | Implemented (Step C) and verified live: Coming up / Earlier grouping, all event types, relative day labels, cancelled events, term banner |
| Admin event management (create/edit/cancel/reschedule) | Implemented (Step C) and verified live, including that an RLS-blocked write (no error, zero rows) is reported as a failure rather than silent success |
| Check-in / attendance UI | Implemented (Step D) and verified live: member self check-in, one-hour undo (policy-enforced), super attendance view via `member_directory()`. Migration `0003` applied |
| Seed/test data | Implemented (Step E): `supabase/seed_test_data.sql`, applied live, re-runnable, dates relative to today |
| Repertoire, recordings, practice mode, leaderboard, Message a Friend, recaps, push, social/notices/More, profile photo | All planned only — deliberately deferred past MVP |

---

## 5. Current UI / product design

**Updated 2026-09-09 (evening) — the UI was substantially restyled towards mockups Nina supplied,
so anything written about it before that date is out of date.**

**Navigation:** Bottom nav, three tabs, now with icons: **Home / Calendar / More**. Nina's mockups
show a fourth **Repertoire** tab; it is deliberately absent because there is no screen behind it
(a nav item leading nowhere is worse than one that isn't there). She confirmed on 2026-09-09 that
it stays at three for now. **Worth knowing if it's ever picked up: the repertoire schema already
exists and is empty** — `songs` (title/composer/voicing/status/notes), `song_assignments`,
`rehearsal_songs` (setlists), `recordings`, and the seeded `part_labels` — all with RLS. A songs
list and per-event setlists would need *no* database work. Recordings would, because that table
is built around Supabase **Storage** (`storage_path`, `mime_type`, a 50MB `file_size_bytes` cap)
rather than the pasted URLs the pre-rebuild app used, so it needs a bucket plus bucket policies
mirroring the RLS model.

**Header:** a purple bar (`--purple` gradient) with the choir name in white, "Super access"
beneath it for supers, and the member's avatar top-right. The avatar is the Google `avatar_url`
captured at sign-in, falling back to initials for an email sign-in — this is **not** the deferred
profile-photo *upload*, just what the provider already returned. Tapping it opens More.

**Screen structure (as built):**
- **Home** — follows mockup "Option B": no greeting line, a large weekday/day numeral beside the
  next event's details, then the two member actions stacked full width ("I'm here" once it's the
  day; "I can't make it" otherwise). Below that, the event's `description` rendered as a banner
  with an alert icon (labelled "Tonight" on the day, "Note" otherwise — it is *not* a separate
  "venue update" field), a link to the calendar, the static "Same voices. Brighter together."
  card, and organiser shortcuts for supers. **Home is shorter than the mockup on purpose:** its
  "TERM 3 / 8 of 9 eligible rehearsals / 89% attendance / usually 2 minutes early" block is
  Checkpoint 10's attendance visual plus punctuality tiers, and "LATEST RECAP" is Checkpoint 13.
- **Calendar** — "My term" (or "Calendar" out of term), a term card, then compact event rows
  grouped "Coming up" / "Earlier". Each row is a date rail (`WED` over `9 SEP`), title, time,
  location and a type pill, plus flags for your own check-in/absence. Supers get a dark
  "+ Add event" pill and a **⋮** menu per row (Edit / Reschedule / Cancel or Reinstate);
  Reschedule opens the same form as Edit but focuses the date field.
- **Event detail** — tapping a row opens it: back arrow, full date ("Wednesday" over
  "16 September"), time, location, type/term pills, a "Your status" block ("✓ You're expected",
  or your check-in with its Undo, or your noted absence), the notes, and for supers the
  attendance or who-can't-make-it view. Opening the admin form always returns to the list, so a
  form never floats over a detail screen with two meanings of "back".
- **More** — the membership Approval Queue for supers, an empty placeholder for members, and the
  Account block with Sign out (moved here from the header).

**Visual system / colours:** Primary purple **`#7052CD`** with `--purple-dark: #5b3fac` and
`--purple-light: #F1EEFA`; headings Oswald condensed/bold, body Inter. Event-type pills keep
distinct colours per type (purple/blue/amber/green) rather than the mockups' single accent — the
distinction is useful and was already built. `manifest.webmanifest`'s `theme_color` is now
correct (`#7052CD`).

**Terminology/labels in the UI:** "Continue with Google" and "Use my email address instead" on
sign-in (the Google button only appears when the provider is actually enabled — see §7).
Membership status copy is exact, agreed wording — see `js/auth.js`, don't casually reword it.

**Interaction behaviour:**
- Signing in *is* requesting access — no separate "request to join" screen.
- A pending member sees a holding screen, not the app shell.
- Check-in only appears on the day of a non-cancelled event (§6 decision 13).
- Once you've checked in, the "I can't make it" action disappears — turning up settles it.

**Empty/loading/error states:** reusable components in `js/shell.js` (`LoadingState`,
`EmptyState`, `ErrorState`) remain the established pattern; new screens should use them.

**Component map for the UI built on 2026-09-09:** `js/icons.js` (inline SVG, inherits
`currentColor`), `js/home.js` (Option B layout), `js/events.js` (`EventRow`, `EventDetail`,
`EventForm`, `KebabMenu`, `AbsenceToggle`), `js/checkin.js` (`CheckInPanel`,
`AttendanceSummary`).

---

## 6. Important decisions already made (do not reopen without cause)

1. **Role/status must live only in the database (`memberships` table), never in
   JWT/`user_metadata`.** Reason: the pre-rebuild app stored `role: 'super'` in Supabase's
   user-editable `user_metadata`, letting any signed-in user grant themselves admin access via
   `updateUser()`. This was the primary trigger for the whole rebuild. Non-negotiable.

2. **Attendance is absence-only, not Going/Maybe/Not-going.** Every active member is assumed
   attending by default; a member only ever acts to say they *can't* make it
   (`rehearsal_absences`). Reversing is just deleting that row. Reason: matches how the choir
   actually operates — RSVP fatigue for something that's basically mandatory.

3. **`checkins` and `rehearsal_absences` are private (own-row-or-super), not choir-visible.**
   Corrected mid-Checkpoint-2 after Nina flagged that public attendance data would let anyone
   reconstruct everyone's full history, contradicting the "members see only the top-3 leaderboard"
   design. Two narrow `security definer` RPCs are the *only* planned future paths for
   member-facing aggregate views (leaderboard top-3 at Checkpoint 10, live-attendee list for
   "Message a Friend" at Checkpoint 11) — not built yet, deliberately.

4. **Away dates are private (own-row-or-super), not a public away calendar.** This *reverses* the
   original architecture brief, which had explicitly specified a public "Nina · Away 12–26
   October" style calendar. Decided 2026-09-09: individual away dates should not be visible
   choir-wide. Applied live in migration 0002.

5. **Unified event model:** `rehearsals` is now the one table for rehearsal/workshop/performance/
   social events, via `event_type` + an independent `counts_towards_attendance` flag — chosen
   over keeping a parallel `social_events` table, because the Calendar Admin design treats all
   event types with identical Edit/Reschedule/Cancel actions. **Table and FK names were
   deliberately NOT renamed** from `rehearsals`/`rehearsal_id` — Nina explicitly approved this as
   a pragmatic, reversible-later call to avoid a large low-value rename ripple across seven
   FK-bearing tables. Treat "rehearsal" in code/schema as meaning "event" generically; don't
   rename it without a genuine technical reason and without asking first.

6. **Binary attendance vs. punctuality are separate concepts, not to be merged.** Attendance
   stays a simple attended/did-not-attend fact; green/orange/red punctuality tiers are a display
   layer computed from timing, never an attendance status.

7. **One-hour undo window applies to check-ins only, not to absence/away declarations.** Members
   can change their mind about an upcoming absence or away date at any time before it's moot;
   check-ins get a strict one-hour edit window once the app has that feature.

8. **Peer verification's "approximate arrival time" is contextual only** — it must never populate
   or influence `checkins.checked_in_at` or punctuality maths. It's a separate, new, nullable
   field on `attendance_confirmation_requests` when that feature is eventually built.

9. **Maintenance screen (`index.html`) stays up** until the app has enough real functionality to
   be worth exposing — originally scoped as "end of Checkpoint 5" in the 16-checkpoint plan; in
   the compressed MVP run this is equivalent to the end of "Step C" (Home + Calendar + admin event
   management all working together). Do not swap it back early "just to preview," and do not
   assume it's already been swapped — verify by reading `index.html` directly (see §11).

10. **Nina works directly in production** on this project — she confirmed early in the rebuild
    that nobody uses the live app yet, so there's no staging environment. Migrations are applied
    directly via the Supabase MCP tool (`apply_migration`/`execute_sql`), not pasted into chat for
    her to run herself. **This differs from an older convention recorded in a persistent memory
    file for this project** (which says schema changes should be pasted for Nina to run herself) —
    that memory predates the rebuild and is stale; the direct-application practice has been used
    without objection across Checkpoints 2 through 4 and through the migration applied today. If
    a new session sees that older memory, prefer this handover's account of current practice, and
    confirm with Nina if genuinely unsure.

11. **Process discipline Nina has established and re-confirmed multiple times:** work through the
    checkpoint sequence in order; don't build later-checkpoint infrastructure early "while you're
    there"; verify everything live against the real database (this codebase has repeatedly had
    bugs that only surfaced under real end-to-end testing, not code review — a hardcoded
    `schema: 'public'` in a realtime subscription silently broke live sync for the app's entire
    pre-rebuild lifetime, for example); report what changed/what was tested/screenshots/SQL steps/
    open decisions at the end of each unit of work; keep explanations concise once a decision is
    already agreed — implement, verify, summarise, move on, per Nina's explicit 2026-09-09
    instruction to conserve her Claude usage.

12. **Security must be enforced at the database/RLS layer, never just hidden UI** — stated and
    tested adversarially multiple times across this project. Any new feature must be checked
    against this before being called done.

13. **Check-in is only possible on the day of the event, and never for a cancelled one.** Added
    2026-09-09 during Step D — this is the one rule in the decision log that was *not* previously
    agreed with Nina, so it's the one most open to revision. Reason: Checkpoint 2's insert policy
    let any active member check in to any event on any date, which makes attendance data
    meaningless (you could check in to next month's concert today). Enforced in
    `0003_checkin_undo_window.sql` as `rehearsal_date = (now() at time zone
    'Australia/Melbourne')::date and status <> 'cancelled'`, and mirrored in the UI by
    `isCheckInDay()` in `js/checkin.js`. The timezone is hardcoded because this is one choir in
    one city. **If the choir wants a grace window ("check in the morning after"), that date test
    is the single line to relax** — change it in the migration and in `isCheckInDay()` together.

14. **The check-in timestamp belongs to the server, and supers get no override on `checkins`.**
    Two halves of one decision, both from Step D:
    * `checked_in_at` was client-suppliable (the column merely *defaulted* to `now()`), and
      punctuality is computed from it. A `before insert` trigger now overwrites it
      unconditionally. This is what turns Decision 8 from a convention into an enforced
      constraint: peer verification's "approximate arrival time" cannot reach this column even if
      the code that eventually writes it is wrong.
    * There is deliberately **no update policy and no super delete** on `checkins`. A super
      correcting somebody else's attendance is the job of `attendance_corrections`, which already
      exists and carries an audit trail (who corrected what, and why). A silent super delete now
      would route around exactly the table that exists to keep that record honest — so if
      super-side corrections are built later, build them through that table.

---

## 7. Current work / exact stopping point

**Updated 2026-09-09 (second pass), after Steps C, D and E were built and verified live.** The
compressed "MVP run" that re-scoped the original 16-checkpoint plan is now essentially complete
on the build side; what remains is Nina's own hands-on test.

- **Step A — unified event model + away-dates privacy fix.** DONE. Migration
  `0002_events_and_privacy.sql` applied live and verified (see §3).
- **Step B — app shell (bottom nav, visual system, loading/empty/error states).** DONE. Commit
  `2d6d0cb`.
- **Step C — simplified Home, Calendar/My Term event list, admin event CRUD, member absence
  marking.** DONE. Commit `7e44be1`. Verified live in a later session as an active member and as
  a super, including adversarially (a plain member cannot create/edit/cancel/delete an event, and
  cannot read anyone else's absence row). `index.html`'s maintenance screen came down as part of
  this commit, per Decision 9.
- **Step D — check-in (member self check-in, super attendance view, one-hour undo).** DONE.
  Commit `8358564`, migration `0003_checkin_undo_window.sql` applied live. See §6 Decision 13 for
  the one new rule this step introduced.
- **Step E — realistic seed/test data.** DONE, same commit. `supabase/seed_test_data.sql`
  (applied live, re-runnable, teardown block at the bottom).

**What was just completed:** Steps C, D and E, all verified live against the real database rather
than by code review. Commit history for the MVP run: `a24f712` (Step A) → `2d6d0cb` (Step B) →
`7e44be1` (Step C) → `8358564` (Steps D+E).

**What has NOT been tested:**
- **Real Google sign-in.** Still the big one. Every test to date has used
  `signInAnonymously()` stand-ins promoted by SQL (§9). Whether the Google Cloud OAuth client and
  the Supabase Auth Google provider are correctly configured is *still* unconfirmed, and it is now
  the last thing standing between the app and being genuinely usable.
- The `ErrorState` component against a real network failure (built, wired into `Gated()`, never
  exercised).
- Nina's own end-to-end pass as a real user. That's the immediate next thing.

**Known bugs/blockers:** none known. Three things a new session should know rather than
rediscover:

1. **The first real super has to be created by SQL.** `memberships`'s update policy is
   `is_super() AND profile_id <> auth.uid()`, so nobody can approve or promote themselves, and
   the seeded super (`Marguerite Okafor`) has no password and cannot log in to approve anyone.
   After Nina's first Google sign-in she will be `pending` with no way out of it until someone
   runs:
   ```sql
   update sonario.memberships set status = 'active', role = 'super'
    where profile_id = (select id from auth.users where email = '<her google address>');
   ```
2. **The approval queue shows "Unknown" for a second** before the profiles lookup resolves
   (`useProfilesById` in `js/approvals.js` fires after the memberships list arrives). Cosmetic,
   pre-existing since Checkpoint 3, deliberately not fixed as part of Steps C–E.
3. **A stale JWT for a deleted account** lands on `MembershipStatusScreen`'s default "we couldn't
   find a membership request" branch, not a crash. Signing out recovers. This is only reachable
   in testing, when a test identity's `auth.users` row is deleted underneath an open tab.

**Configuration changes Nina has made manually:** still none recorded. Google OAuth provider
setup (Supabase dashboard + Google Cloud Console) remains the open unverified item from
Checkpoint 3.

**Anything awaiting Nina's confirmation:** one thing, and it is optional — Decision 13's
check-in-only-on-the-day rule was a call made while building Step D rather than a previously
agreed decision. It's flagged in the migration's own comments as a one-line relaxation if the
choir wants a grace window.

**The very next task:** Nina's own hands-on test — real Google sign-in, promoted to super by the
SQL above, then clicking through Home, Calendar and More against the seed data. Nothing new
should be built until that has happened and she's said what she wants changed.

---

## 8. Remaining roadmap

**The agreed MVP is built.** Steps C, D and E and the `index.html` swap are all done (§7). What
is left before anything new starts:

1. **Push.** Local `main` is ahead of `origin/main` (§10) — Nina runs `git push` herself, and
   that push is what takes the maintenance screen down on Vercel.
2. **Real Google sign-in, verified.** The one genuinely unproven part of the system.
3. **Promote Nina's real account to active/super by SQL** (§7, note 1).
4. **Nina's hands-on pass**, and whatever she wants changed as a result.

**Explicitly deferred past that first hands-on test (do not build early):**
- Profile photo upload (Checkpoint 15) — the underlying `avatar_url` column + self-update RLS
  already exist, only the upload UI is deferred
- Peer attendance verification / "Message a Friend" (Checkpoint 11) — note that Decision 8's
  constraint is now enforced by the database rather than by convention, see §6 Decision 14
- Punctuality tiers and the leaderboard (Checkpoints 9/10) — the seed data deliberately contains
  a spread of early/on-time/late arrival times so there is something real to colour when this is
  built
- All push notification infrastructure (Checkpoint 14)
- Public-holiday detection (Checkpoint 5's original scope, now deferred)
- Repertoire, per-part recordings, practice mode (Checkpoints 6–8)
- Super-side attendance *corrections* — `attendance_corrections` exists with an audit trail and
  is the intended path; Step D deliberately gave supers no delete/override on `checkins` so that
  path stays the only one
- Rehearsal recaps (Checkpoint 13)
- Away-dates UI (declare/confirm away — schema+RLS exist, no UI)
- Social events/notices rebuild onto `profile_id` + More-tab UI (Checkpoint 15)
- Final launch check (Checkpoint 16) — cross-device/timezone/accessibility/security pass

Do not quietly pull any of the above back into scope "while working nearby" — this has been
Nina's consistent, explicitly repeated instruction throughout the project.

---

## 9. Testing / safety requirements

- **RLS is the real security boundary — verify it adversarially, not just happy-path.** Every
  privacy-sensitive checkpoint in this project has been tested by attempting the exact exploit
  it's meant to block (self-approval, checking in as someone else, editing your own role) and
  confirming the database itself rejects it, not just that the UI hides the option.
- **Test identity pattern (CHANGED by migration 0004 — read this before reusing an old recipe):**
  `supabase.auth.signInAnonymously()` from the browser console (via `javascript_tool` dynamically
  importing `js/supabaseClient.js`) is still how to get a disposable identity, but the signup
  trigger **no longer creates a profile or membership for anonymous users**, so promoting one with
  a bare `update` will silently match zero rows. Insert them explicitly:
  ```sql
  insert into sonario.profiles (id, display_name, google_email)
  values ('<anon uuid>', 'Zed Tester', '');
  insert into sonario.memberships (profile_id, status, role)
  values ('<anon uuid>', 'active', 'super');
  ```
  **Always clean up afterward** — `delete from auth.users where id = '<anon uuid>'` cascades the
  profile and membership away with it. The ~182 leftover anonymous users earlier sessions had
  accumulated were deleted on 2026-09-09; don't let that build up again.
- **Anonymous users on this project are not all yours.** Page Turners shares this Supabase project
  and signs its own visitors in anonymously, so `auth.users` will always contain anonymous rows
  that have nothing to do with Sonario and must not be deleted as "test residue". Before any
  cleanup, scope it to identities you actually created. This is also what migration 0004 exists to
  fix: the signup trigger used to give every one of those visitors a `pending` Sonario membership,
  filling the approval queue with phantom "New member" requests.
- **Multiple `createClient()` calls in the same test session need distinct `auth.storageKey`
  values**, or they silently share one localStorage session and clobber each other.
- **Migrations:** ship as numbered files in `supabase/migrations/`, each with a rollback (either a
  separate `_rollback.sql` file or a commented rollback block at the end of the forward migration).
  Applied directly to production via the Supabase MCP tool (see Decision 10, §6) — there is no
  staging environment for this project.
- **Realtime:** the Supabase client/subscriptions must target `schema: 'sonario'` explicitly —
  this project has a real history of a hardcoded `'public'` silently breaking live sync (see
  §6/memory). Check this specifically if a new realtime hook is ever added.
- **Timezone:** never use `Date.toISOString()` for calendar-date logic — it converts to UTC and
  silently shifts dates for Melbourne (UTC+10/11) users. Use `localDateStr()`/`todayStr()` from
  `js/lib.js`.
- **Destructive operations:** nothing in this codebase currently does hard deletes of user data by
  design (e.g. song assignments are archived, not deleted). Preserve that pattern for new features
  unless there's a specific reason not to.
- **Storage:** not built yet — when it is, bucket policies must mirror the RLS model (any active
  member can upload, uploader-or-super can delete, active members can read), with no public/
  anonymous access, per the approved architecture plan.

---

## 10. Git / repository state

- **Branch:** `main`
- **Working tree:** clean as of this handover (nothing uncommitted)
- **Pushed to `origin/main` on 2026-09-09** (`ed5e5af..8358564`), by Nina, after Steps D and E
  landed. That push is what took the maintenance screen down on the live Vercel deployment, so
  "deployed" and "committed" are in step as of that moment — but re-check rather than assuming,
  since the convention below means local can run ahead again at any time. Latest commits,
  newest first:
  ```
  8358564 Step D: check-in with a one-hour undo window, plus Step E seed data
  7e44be1 Step C: Home, Calendar/My Term, admin event management, absence marking
  c282294 Add handover doc for Claude account switch (documentation only, no product changes)
  2d6d0cb Checkpoint 4: app shell, bottom nav (Home/Calendar/More), loading/empty/error states
  a24f712 Checkpoint 4 prep: unified event model columns + away_dates privacy fix
  3f5a874 Checkpoint 3: Google sign-in + membership approval queue
  ```
- **Remote:** `origin` → `https://github.com/nozkowoz/sonario.git`
- **Pushing is Nina's own step** — established convention throughout this project is that Claude
  commits locally; Nina runs `git push` herself when ready. Don't push without her explicitly
  asking.
- **Files a new session should read first:** this file (`HANDOVER.md`), then
  `js/app.js`/`js/store.js`/`js/shell.js` for current app structure, then
  `supabase/migrations/0001_foundation.sql` and `0002_events_and_privacy.sql` for the real schema
  (not `supabase/schema.sql`, which is stale).

---

## 11. Local development

**Running the app locally:** No build step. A dev-server launch config already exists at
`/Users/nina.kowalski/Documents/Claude/.claude/launch.json` (note: this lives one level up, in
the parent `Claude` directory that also holds Page Turners and other projects, not inside
`sonario/` itself) — entry named `"sonario"`, serves the `sonario` folder on port 5501 via `npx
serve`. Use the Browser-pane preview tool with `{name: "sonario"}` rather than raw `python3 -m
http.server` (README.md's instruction is pre-rebuild and still works, but the launch.json entry
is already wired up).

**`index.html` now loads the real app**, so the dev server serves the actual thing — no
throwaway harness file is needed any more (earlier sessions used `test-cp3.html`/`test-cp4.html`
for this while the maintenance screen was up, and always deleted them afterwards; don't
reintroduce the pattern without need).

**Note on the dev server:** port 5501 may already be held by another chat's dev server, in which
case `preview_start` refuses and the existing server can simply be navigated to at
`http://localhost:5501` instead. Also worth knowing: the Browser pane can be *hidden*, in which
case coordinate clicks and screenshots fail outright — drive the page through `javascript_tool`
(dispatching real `.click()` on DOM nodes works fine with Preact) and read it with `read_page` /
`get_page_text`.

**Testing a real sign-in/role locally:** see §9's anonymous-identity pattern — there is currently
no way to test Google sign-in itself without Nina's own Google account and confirmed OAuth setup.

**Identifying the Supabase project — CHECK THIS EVERY SESSION BEFORE WRITING ANYTHING.** Sonario
is project ref **`jpffnazfjxvdzqnfueue`**. On 2026-09-10 the Supabase MCP server in Nina's
`~/.claude.json` was pinned to `--project-ref=ylrcotvnrvvfosuvtleh` — which is **North Island
Diary**, a completely different app — and additionally set to `--read-only`. A `select` against
`sonario.terms` failed with "relation does not exist", which is the *good* failure mode; the bad
one would have been "helpfully" creating the schema and polluting another app's database. Verify
first, with a query that can't do damage:
```sql
select current_database(),
       (select count(*) from information_schema.schemata where schema_name = 'sonario');
```
If `sonario` isn't there, you are on the wrong project: stop, and either hand Nina the SQL to run
in the Supabase SQL editor (`https://supabase.com/dashboard/project/jpffnazfjxvdzqnfueue/sql`) or
ask her to repoint `--project-ref` and restart the session. `--read-only` also removes
`apply_migration` and every other write tool from the session, so migrations can't be applied
directly either — check whether they're in the tool list before promising to apply one. No local
`.env`; the anon key is in `js/config.js`.

**No automated test suite exists for this project** — verification has always meant live
end-to-end testing against the real Supabase project (see §9), not unit/integration tests.

---

## 12. Claude-specific context (would otherwise be lost)

- This project was born from a much larger passphrase-based prototype (see the git history before
  `904ca9a`) that Nina and ChatGPT then turned into a full rebuild brief after a real security
  hole was found (self-escalation via editable `user_metadata`). The rebuild is a genuine
  ground-up redo of auth/data model, not an incremental feature addition — a new session should
  not treat pre-`904ca9a` patterns (shared passphrases, free-text member names) as current design.
- A detailed architecture plan (schema design, RLS rationale, notification architecture, storage
  approach, PWA limitations, the full original 16-checkpoint sequence, and locked-in specs for
  future checkpoints like the "Choir in Full Voice" personal attendance visual) was produced via
  Claude Code's plan mode and approved by Nina across several correction rounds. **This plan file
  may not transfer to a new Claude account** — plan-mode files are typically stored per local
  Claude Code installation/session, not necessarily readable by a different logged-in account on
  the same machine. If a new session can't find it, this handover's §6 Decision Log captures the
  load-bearing decisions from it; the fuller rationale (e.g. exact notification timing formulas,
  detailed RLS policy text for not-yet-built features) would need to be reconstructed from the
  migration files' own inline comments, which are unusually thorough in this codebase precisely
  for this reason — read the SQL comments, they carry real design rationale, not boilerplate.
- Nina has been explicit and consistent about pacing: complete-test-document one unit before the
  next, report clearly at the end of each, and — as of today specifically — keep responses
  concise once something is already agreed, to conserve her Claude usage. A new session should
  default to that terse-but-complete reporting style rather than re-deriving a verbose style.
- Nina personally reviews and hand-edits things like Confluence pages elsewhere in her work (per
  her general working style, not specific to this project) — the general pattern of "verify
  against the live source before touching it, don't trust a cached snapshot" that shows up
  repeatedly in this project's own bug history (stale schema.sql, hardcoded 'public' schema,
  outdated README/TODO/manifest) fits a broader pattern of this user preferring live verification
  over trusting documentation, worth carrying forward as a general instinct on this project.
- **`README.md` and `TODO.md` in this repo are stale** (README still describes the old passphrase
  model; TODO's checkpoint checklist stops at "Checkpoint 2 in progress" and doesn't reflect
  Checkpoints 2–4 actually being done, or the compressed MVP re-scoping from 2026-09-09). They
  were deliberately **not updated as part of this handover** (this task was scoped as
  documentation-only via this new file, not a general repo cleanup) — a new session should treat
  this `HANDOVER.md` as authoritative over both, and could offer to refresh them once real
  implementation work resumes, but should ask first rather than doing it unprompted.

---

## 13. START HERE — NEW CLAUDE SESSION

1. **Read this file in full first**, then `js/app.js`, `js/store.js`, `js/shell.js`, and
   `supabase/migrations/0001_foundation.sql` + `0002_events_and_privacy.sql` (not
   `supabase/schema.sql` — that's a stale pre-rebuild snapshot).
2. **Verify current state before changing anything** — don't trust this file's snapshot blindly
   either, it's a point-in-time document. At minimum: run `git log --oneline -10` and `git
   status`; check the live Supabase `sonario` schema's tables/row counts if you're about to touch
   data. `index.html` now loads the real app — confirm rather than assume, in either direction.
3. **Current milestone:** the compressed MVP run (§7/§8) is **built** — Steps A through E are all
   done and verified live, and the app is deployed. The next thing is not a build task: it's
   Nina's own hands-on test with a real Google sign-in, which is still the one unproven part of
   the system. Do not start new features before that; see §7 for the three things that trip up a
   first real sign-in (chiefly: the first super has to be promoted by SQL).
4. **Respect existing product/design decisions (§5, §6) rather than redesigning them.** In
   particular: the three-tab bottom nav (Home/Calendar/More), the `#7052CD` visual system, the
   unified-event-model-without-renaming-the-table decision, and the absence-only/private-attendance
   privacy model are all settled — don't reopen them without a genuine reason, and ask Nina first
   if you think one exists.
5. **Do not assume something is deployed or applied just because code/migrations exist locally.**
   Local git is 5 commits ahead of `origin/main` (§10); Vercel's live deployment may lag. Database
   migrations in this project are applied directly, so the live database usually *is* current —
   but verify with a live query rather than assuming, especially for anything touched before this
   handover was written.
6. **Ask Nina before any major scope or architecture change** — e.g. renaming the `rehearsals`
   table, changing the nav structure, pulling a deferred checkpoint back into MVP scope, or
   altering the privacy model on attendance/away-dates. Minor implementation calls within already-
   agreed scope don't need a check-in; anything that revisits a decision in §6 does.
7. **Working style:** implement, verify live against the real Supabase project (this codebase has
   a strong track record of bugs that only show up under real end-to-end testing), give a concise
   summary of what changed and what — if anything — genuinely needs Nina's input, then move to the
   next step. Avoid re-explaining things already settled in this document.
