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
index.html                 Currently a STATIC MAINTENANCE SCREEN (see §7) — no script tags, no auth
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
whatever is live on Vercel right now reflects only the Checkpoint 2 migration + the maintenance
screen, not Checkpoints 3–4's work. This is low-risk (the maintenance screen hasn't changed), but
don't assume "deployed" matches "committed locally" — see §10.

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

Both have matching rollback SQL (`0001_foundation_rollback.sql`, and a commented rollback block
at the bottom of `0002_events_and_privacy.sql`).

**Note on migration tracking:** Supabase's own migration history table only shows some of this
work under different naming (e.g. `checkpoint2_absence_only_correction`,
`sonario_0002_events_and_privacy`) — some earlier Checkpoint 2 changes were applied via raw SQL
execution rather than the `apply_migration` tool, so Supabase's migration ledger doesn't perfectly
mirror the files in `supabase/migrations/`. The `.sql` files in the repo are the accurate,
readable record; don't rely on Supabase's migration list alone to reconstruct history.

**Live data as of 2026-09-09:** `profiles`: 0 rows. `memberships`: 0 rows. `terms`: 0. `rehearsals`:
0. Zero real product data exists yet. `auth.users` has **182 anonymous users** and **zero real
(Google) users** — these anonymous rows are leftover test identities from adversarial RLS testing
throughout the rebuild (each promoted to a test role via direct SQL, meant to be cleaned up after
each test, evidently not all were). They carry no membership/profile rows and can't reach any
real data, so they're not a security issue, just database clutter — worth a cleanup pass at some
point, not urgent, not done as part of this handover per the "no changes" instruction.

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
| Unified event model schema (`event_type`, `counts_towards_attendance` on `rehearsals`) | Schema implemented and verified (columns confirmed live); **no UI built yet** — that's the next step |
| Away-dates privacy correction | Implemented and verified (RLS policy confirmed live via `pg_policies` query) |
| Home tab | Placeholder only (empty state) — real content is the next build step |
| Calendar tab | Placeholder only (empty state) — real content is the next build step |
| Admin event management (create/edit/cancel/reschedule) | Not started |
| Check-in / attendance UI | Not started |
| Seed/test data | Not started |
| Repertoire, recordings, practice mode, leaderboard, Message a Friend, recaps, push, social/notices/More, profile photo | All planned only — deliberately deferred past MVP |

---

## 5. Current UI / product design

**Navigation:** Bottom nav, three tabs only: **Home / Calendar / More**. This was an explicit
correction from an earlier plan draft that had a top tab row with more sections (Rehearsals/
Repertoire/More) — the current, confirmed nav is the three-tab bottom bar. "Repertoire" is not a
nav destination at MVP stage; when it's built (post-MVP) it likely lives under **More**.

**Screen structure (as built):**
- **Home** — simplified per-member landing screen. Content not yet built beyond a greeting +
  empty state; per the architecture plan this is meant to eventually show the next
  rehearsal/event and a quick check-in action, with admin shortcuts for supers. Exact layout not
  yet decided beyond that.
- **Calendar** — "My Term" event list. Not yet built beyond an empty state. Will list events from
  the unified `rehearsals` table (all event types).
- **More** — currently hosts the membership Approval Queue for supers (moved here from being the
  entire app in Checkpoint 3). For ordinary members it's currently an empty placeholder. Longer
  term this is where Repertoire, profile, and other secondary features are expected to live,
  though that hasn't been explicitly confirmed with Nina — don't assume it without asking.

**Visual system / colours:** Primary purple **`#7052CD`** (confirmed by Nina explicitly for
Checkpoint 4 — this superseded an earlier, slightly different purple `#6a4fd6` that was used in
the pre-rebuild app and is still what `manifest.webmanifest`'s `theme_color` says; that file
hasn't been updated to match). CSS custom properties in `css/styles.css`: `--purple: #7052CD`,
`--purple-dark: #5b3fac`, `--purple-light: #F1EEFA`, plus existing `--ink`/`--ink-soft`/`--border`/
`--bg` tokens carried over from the pre-rebuild visual system (headings in Oswald condensed/bold,
body in Inter — unchanged). New tokens added in Checkpoint 4: `--error`/`--error-bg` for the
error state, `--bottom-nav-h` for layout spacing.

**Terminology/labels in the UI:** "Continue with Google" (sign-in button). Membership status
copy is exact, agreed wording — see `js/auth.js` (`MembershipStatusScreen`) for the pending/
declined/deactivated text, do not casually reword it. Bottom nav labels are simply "Home",
"Calendar", "More".

**Interaction behaviour:**
- Signing in *is* requesting access — there's no separate "request to join" screen or button.
- A pending member sees a holding screen, not the app shell.
- Admin ("super") status shows as a small "Super access" label under the app title in the header.

**Admin vs member behaviour:** Currently the only implemented differentiation is: supers see the
Approval Queue under More; members see an empty placeholder there instead. Home/Calendar content
differentiation (e.g. admin shortcuts on Home) is planned but not yet built.

**Empty/loading/error states:** Reusable components exist (`js/shell.js`: `LoadingState`,
`EmptyState`, `ErrorState`) and are the established pattern going forward — new screens should
use these rather than inventing ad hoc "no data" messaging.

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

---

## 7. Current work / exact stopping point

**Most recent milestone:** Mid-way through a compressed "MVP run" that re-scopes the original
16-checkpoint plan down to the shortest safe path to something Nina can actually open and test
end-to-end. This MVP run was proposed and agreed 2026-09-09, replacing (for now) the strict
one-checkpoint-at-a-time pacing with a leaner internal sequence:

- **Step A — unified event model + away-dates privacy fix.** DONE. Migration
  `0002_events_and_privacy.sql` applied live and verified (see §3).
- **Step B — app shell (bottom nav, visual system, loading/empty/error states).** DONE. Commit
  `2d6d0cb`. Verified live via a temporary anonymous test identity promoted to active/super role,
  screenshotted through Home/Calendar/More tabs; cleaned up afterward (test identity deleted,
  temporary preview harness file deleted, no residue in the repo).
- **Step C — simplified Home, Calendar/My Term event list, admin event CRUD, member absence
  marking.** **NOT STARTED.** This was the very next task about to begin when this handover was
  requested — the only work done toward it was one exploratory `grep` on the old, dead
  `js/rehearsals.js` file (no changes made, purely inspection).
- **Step D — basic check-in (self check-in + admin view + one-hour undo window).** Not started.
- **Step E — realistic seed/test data.** Not started; likely folds into Step C or D rather than
  needing its own pass.

**What was just completed:** Step B (the app shell), including live verification. Commit history
for this MVP run: `a24f712` (Step A) → `2d6d0cb` (Step B).

**What has NOT been tested:**
- Real Google sign-in (only anonymous-identity stand-ins have been used for all testing so far —
  see §9). Whether the Google Cloud OAuth client / Supabase Google provider are actually
  configured correctly is **unconfirmed**.
- The error state component (`ErrorState` in `js/shell.js`) — built, wired into `Gated()` in
  `js/app.js` for a membership/profile load failure, but not exercised against a real failure.
- Anything from Step C onward (not built yet).

**Known bugs/blockers:** None currently known in what's built. No genuine blocker is currently
open — Step C was ready to start with no outstanding decision needed from Nina.

**Configuration changes Nina has made manually:** None recorded as manual/dashboard-side changes
in this session specifically. Whether Google OAuth provider setup in the Supabase dashboard and
the Google Cloud Console project have been completed is unconfirmed — flagged as an open item
since the very end of Checkpoint 3 and still not explicitly confirmed as done.

**Anything awaiting Nina's confirmation:** Nothing is currently blocked awaiting her input — the
MVP roadmap and all the decisions in §6 were her explicit agreement on 2026-09-09.

**The very next task:** Build Step C — simplified Home content, a real Calendar/My Term event
list reading from `sonario.rehearsals` (all event types), admin event create/edit/cancel/
reschedule UI, and member "can't make it" (absence) marking. This is what a fresh session should
start on once it has re-verified current state per §13.

---

## 8. Remaining roadmap

**Required for the agreed MVP (in order):**
1. Step C — Home + Calendar + admin event management + member absence marking
2. Step D — basic check-in (member self check-in, admin view, one-hour undo window + its RLS
   policy — not yet applied to the database)
3. Step E — seed/test data (a term, ~10 mixed-type events, a few test memberships, some
   absences/check-ins) so Nina has something real to click through
4. Swap `index.html` back to the real app (end of Step C, per Decision 9 in §6)

**Explicitly deferred past the first hands-on test (do not build early):**
- Profile photo upload (Checkpoint 15) — the underlying `avatar_url` column + self-update RLS
  already exist, only the upload UI is deferred
- Peer attendance verification / "Message a Friend" (Checkpoint 11)
- Punctuality tiers, push-based reminder windows, all push notification infrastructure
  (Checkpoints 9's full scope, 14)
- Public-holiday detection (Checkpoint 5's original scope, now deferred)
- Repertoire, per-part recordings, practice mode (Checkpoints 6–8)
- Leaderboard + "Choir in Full Voice" personal attendance visual (Checkpoint 10)
- Rehearsal recaps (Checkpoint 13)
- Away-dates UI (declare/confirm away — the schema+RLS exist, no UI planned yet even though it's
  not explicitly in the deferred list; treat as not-MVP unless Nina says otherwise)
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
- **Test identity pattern:** use `supabase.auth.signInAnonymously()` from the browser console
  (via `javascript_tool` dynamically importing `js/supabaseClient.js`) as a disposable test
  identity, then promote it to whatever membership state is needed via direct SQL
  (`update sonario.memberships set status = ..., role = ... where profile_id = '<id>'`). **Always
  clean up afterward** — delete the `memberships`, `profiles`, and `auth.users` rows for the test
  identity once done. This session found ~182 leftover anonymous test users in `auth.users` from
  incomplete cleanup in earlier sessions — harmless (no membership/profile rows, RLS blocks them
  from anything real) but worth remembering to actually delete test rows going forward, and worth
  a cleanup pass at some point.
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
- **Local main is 5 commits ahead of `origin/main`** — Nina has not run `git push` since
  Checkpoint 2. Latest local commits, newest first:
  ```
  2d6d0cb Checkpoint 4: app shell, bottom nav (Home/Calendar/More), loading/empty/error states
  a24f712 Checkpoint 4 prep: unified event model columns on rehearsals + away_dates own-row-or-super privacy fix
  3f5a874 Checkpoint 3: Google sign-in + membership approval queue
  be83661 Checkpoint 2: fix two bugs found via live adversarial testing
  b2be53a Checkpoint 2 correction: absence-only model, private checkins/absences
  ed5e5af Checkpoint 2: database foundation migration + rollback + maintenance screen   ← origin/main is HERE
  904ca9a Add rehearsal check-in ... (v6)   ← last commit before the rebuild started
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

**Because `index.html` is still the maintenance screen (Decision 9, §6), it won't load the real
app.** To test the real app locally before Checkpoint/Step C's maintenance-screen swap, create a
throwaway local HTML file (not committed — this repo has done this before as
`test-cp3.html`/`test-cp4.html`, always deleted after use) that loads `js/app.js` directly against
`#root`, same pattern as `index.html`'s eventual real version.

**Testing a real sign-in/role locally:** see §9's anonymous-identity pattern — there is currently
no way to test Google sign-in itself without Nina's own Google account and confirmed OAuth setup.

**Identifying the Supabase project:** project ref `jpffnazfjxvdzqnfueue`, reachable via the
connected Supabase MCP tool (`mcp__b4a8a01d-9f7a-4326-8637-56df71835a4f__*` in this session's tool
list — the exact tool-name prefix may differ in a new session, search for Supabase MCP tools by
capability, e.g. `execute_sql`/`apply_migration`/`list_tables`). No local `.env` — the anon key is
directly in `js/config.js`.

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
   data; confirm `index.html` is still the maintenance screen before assuming otherwise.
3. **Current milestone:** mid-way through the compressed MVP run (§7/§8). Steps A and B are done
   and verified; Step C (Home + Calendar + admin event management + absence marking) has not been
   started — that's the next intended task.
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
