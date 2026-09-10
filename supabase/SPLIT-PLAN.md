# Splitting Sonario onto its own Supabase project

Written 2026-09-10, before Repertoire / Practice Mode / Recordings, at Nina's request: she wants
Sonario isolated from Page Turners **before** new tables, Storage buckets, recording uploads and
more RLS land on a shared project.

**Nothing has been changed. This is the plan.**

Inventory below is derived from `supabase/migrations/*.sql`, **not** from the live database — the
Supabase MCP in this session is pointed at a different project (verified: no `sonario` schema), so
it could not be reconciled against reality. **Step A1 reconciles it.** Treat any mismatch there as
the truth and this document as wrong.

---

## 0. Findings that change the plan

*Updated 2026-09-10 after Phase A1/A2. Verified findings are marked ✅.*

### 0.1 The migration chain could not build Sonario from scratch 🔴 ✅ FIXED
Two things lived **only** in `supabase/schema.sql`, which HANDOVER §10 correctly calls stale:

- **`create schema sonario`.** Every table in 0001 is `create table if not exists sonario.…`, so
  on a fresh project the very first one fails with "schema sonario does not exist".
- **The API grants, which matter more.** Unlike `public`, a freshly created schema gives the
  PostgREST roles nothing. Without `grant usage on schema sonario to anon, authenticated` and the
  table grants, **every request fails 42501 "permission denied for schema sonario" regardless of
  RLS** — RLS is only consulted once the base grant already allows the operation. The app would
  look comprehensively broken while every table, policy and function was in fact correct. This
  was the bigger of the two and was not in the first draft of this plan.

Neither is visible in the shared project today, because both were applied by the old `schema.sql`
before the rebuild. They only surface when Sonario is rebuilt elsewhere — i.e. now.

**Fixed** by `migrations/0000_schema_and_grants.sql`. It also carries a grant *sweep* to be run
again after 0006, plus the exact `revoke`s that sweep would otherwise undo on the
security-definer helpers.

### 0.1b Migration 0003 is NOT re-runnable 🟡 ✅ FOUND, NOT YET FIXED
`0003_checkin_undo_window.sql` drops the OLD policy name (`members write own checkin`) but then
creates two new policies — `members check in to today's event` and
`members undo own checkin within an hour` — **without a preceding `drop policy if exists` for
either**. A second run fails with "policy … already exists".

Harmless on a single clean build. But it breaks the "each migration is idempotent, stop at the
first error" instruction in Phase B3, and re-running part of the chain is a plausible recovery
move. **Fix is two `drop policy if exists` lines; not applied yet, pending Nina's go-ahead** —
it edits an already-applied migration, which deserves a yes even though the resulting state is
identical.

Every other statement in the chain is guarded: `if not exists` on all 18 tables, 12 indexes and
the schema; `or replace` on all 8 functions; `add column if not exists` in 0002 and 0006;
`on conflict` on both inserts; `drop … if exists` before all other policies and triggers; and
0004's cleanup delete is naturally idempotent.

### 0.2 The `auth.users` trigger is the cross-app coupling, and it can break Page Turners 🔴 ✅
```sql
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function sonario.handle_new_auth_user();
```
This lives on `auth.users`, which is **project-wide and shared with Page Turners**. It's the thing
that caused the phantom-membership bug (fixed in 0004 by skipping anonymous identities).

**The danger is in the decommission step, not the move.** If the `sonario` schema is dropped from
the old project while this trigger still exists, the trigger's function is gone and
**every INSERT into `auth.users` raises** — which means **Page Turners sign-in stops working
entirely**, for an app that has real users. Page Turners calls `signInAnonymously()`, which is an
`auth.users` INSERT on *every new visitor*.

So Phase E has a mandatory order: **drop the trigger first, then the function, then the schema.**
Never `drop schema sonario cascade` as the first move.

### 0.3 No data needs exporting 🟢 ✅
Everything with rows in it is reproducible from SQL already in the repo:

| What | Source | Reproducible? |
|---|---|---|
| Terms + the whole 2026 schedule | `supabase/real_schedule_2026.sql` | Yes — generated from term bounds, deterministic |
| 8 fake members | `supabase/seed_test_data.sql` | Yes — fixed `f0000000-…` UUIDs |
| Nina's Term 3 attendance | `supabase/dev_my_attendance_term3.sql` | Yes — keys off `auth.users.email`, so it self-heals to the new UUID |
| Voice parts | `migrations/0006_voice_parts.sql` | Yes |
| Songs / recordings / recaps / notices | — | Empty |

**This is a clean rebuild, not a data migration.** No `pg_dump`, no CSV round-trip, no UUID
remapping. That removes most of the risk normally attached to this kind of move.

---

## 1. Inventory to recreate

**18 tables** (all in schema `sonario`)

`profiles`, `memberships`, `terms`, `rehearsals`, `rehearsal_absences`, `checkins`,
`attendance_confirmation_requests`, `attendance_corrections`, `away_dates`, `part_labels`,
`songs`, `song_assignments`, `recordings`, `rehearsal_songs`, `rehearsal_recaps`,
`rehearsal_recap_items`, `push_subscriptions`, `notification_log`

**8 functions** (the first draft said 9 — `handle_new_auth_user` was counted twice)

| Function | Role |
|---|---|
| `handle_new_auth_user()` | trigger on `auth.users` — **the cross-app one** |
| `current_membership()`, `is_super()`, `is_active_member()` | the RLS predicates everything depends on |
| `member_directory()` | the ONLY safe way to resolve another member's name (`profiles` is own-row-or-super) |
| `set_updated_at()`, `enforce_assignable_part()`, `enforce_checkin_timestamp()` | triggers |

**6 triggers — 5 on `sonario` tables plus 1 on `auth.users`.** `checkins_server_timestamp`,
`song_assignments_enforce_assignable`, and three `set_updated_at` on `rehearsals`, `songs`,
`rehearsal_recaps`; then `on_auth_user_created` on `auth.users`, which is the cross-app one.

**42 RLS policies.** (The first draft said 43: it counted `members cancel own pending away dates`
twice, since 0005 redefines the policy 0001 created.) Not restated here — they're in the
migrations, and the point of replaying the migrations rather than hand-copying is that these come
across exactly.

**Grants:** `execute … to authenticated` on `current_membership`, `is_super`,
`is_active_member`, `member_directory`; `revoke … from public` on those plus
`handle_new_auth_user`, `set_updated_at`, `enforce_assignable_part`.

**Realtime:** 12 tables added to the `supabase_realtime` publication by 0001 §10 —
`rehearsals`, `rehearsal_absences`, `checkins`, `attendance_confirmation_requests`, `away_dates`,
`songs`, `song_assignments`, `recordings`, `rehearsal_songs`, `rehearsal_recaps`,
`rehearsal_recap_items`, `memberships`. The block is guarded and re-runnable.

**Storage:** none for Sonario. No buckets, no objects, no storage policies. ⚠️ The audit's
`pageturners: storage buckets` row reports buckets for the **whole shared project** — if Page
Turners has any, they stay exactly where they are and this plan never touches them. The `recordings` table is *built*
for Storage (`storage_path`, `mime_type`, a 50MB `file_size_bytes` cap) but nothing has ever been
uploaded. The bucket gets created fresh in the new project as part of the Recordings build.

**Extensions:** only `gen_random_uuid()`, which Supabase provides by default. Nothing to install.

---

## 2. Auth dependencies (the part that isn't SQL)

A new project means a new `auth.users`, so all of this is reconfigured by hand in the dashboard:

| Thing | Where | Note |
|---|---|---|
| **Google provider** | Auth → Providers → Google | Needs the client ID + secret again |
| **Authorised redirect URI** | Google Cloud Console → Clients | `https://<NEW-REF>.supabase.co/auth/v1/callback` — **the new ref**. Add it; don't delete the old one until Page Turners is confirmed unaffected |
| **Site URL + redirect allow-list** | Auth → URL Configuration | The app passes `redirectTo: window.location.origin`, so the Vercel production URL **and** `http://localhost:8777` both need allowing, or local sign-in breaks |
| **Email magic link** | Auth → Providers → Email | `signInWithOtp` is a live sign-in path (`js/auth.js:73`), not dead code |
| **Exposed schemas** 🔴 | Settings → API → Data API | **`sonario` MUST be added.** The client is pinned to `db.schema = 'sonario'`; if the schema isn't exposed, every single query fails and the app looks broken with no obvious cause |

The Google **consent screen** app name ("Sonario") is per Google-Cloud-project, not per Supabase
project, so it carries over unchanged.

---

## 3. Config / env values

Only one file changes:

- `js/config.js` → `SUPABASE_URL`, `SUPABASE_ANON_KEY`

There are **no Vercel environment variables** — these values are committed in plain JS on purpose
(the anon key is public by design; RLS is the boundary). So the cutover is one commit and one push.

The old anon key stays valid for the old project, which Page Turners keeps using. Nothing about
Page Turners' config changes. The old key being in Sonario's git history is not a problem and
needs no rotation.

---

## 4. What this touches in Page Turners

| Shared thing | After the split |
|---|---|
| `auth.users` | **No longer shared.** Page Turners' anonymous identities stay exactly where they are, untouched |
| `on_auth_user_created` trigger | Must be dropped from the old project — see §0.2. **This is the one step that can break Page Turners.** ✅ Audit confirms it is the ONLY trigger on `auth.users`, so the §5 Phase E order holds as written |
| Quotas (DB size, egress, MAU, Storage) | No longer shared. Sonario's recordings won't eat Page Turners' 1GB |
| Auth rate limits | No longer shared |
| Google OAuth config | Page Turners doesn't use Google (anonymous only), so nothing to unpick |
| Restore point / PITR | Separate. Restoring one no longer rolls back the other |
| Realtime channels | Already isolated by schema+table filters; irrelevant after the split |
| `public` schema (books/ratings/meetings) | **Never touched at any point in this plan** |

Page Turners' code contains **zero references** to `sonario` (checked). The coupling is entirely
the shared `auth.users` and that one trigger.

---

## 5. The plan

### Phase A — prepare (zero risk, nothing changes)

- **A1. Reconcile this inventory against the live database.** ✅ **RUN 2026-09-10 — results in
  §9.** Headline: Page Turners is clean, and the live schema carries **three tables no migration
  recreates**. One follow-up query outstanding (`split_audit_followup.sql`).
- **A1 (original description).** —
  `supabase/split_audit.sql`, read-only, against the CURRENT project. Claude cannot: the MCP in
  this session is pointed at a third project (North Island Diary — confirmed by a `trip-photos`
  bucket and 41 anonymous users). The script prints counts, both-directions discrepancy lists,
  the grant state, Page Turners safety checks and row counts, and is written so a clean database
  returns only `summary:` and `pageturners:` rows.
- **A2. Add `migrations/0000_schema_and_grants.sql`.** ✅ Done. Fixes §0.1.
- **A2b. Verify the chain replays.** ✅ Done, statically: all 185 statements across 0000–0006
  parse under the real Postgres grammar (`libpg_query`), and a dependency walk confirms every
  table, function, trigger, policy and index is created after everything it depends on. **The
  chain builds Sonario cleanly from an empty database.** Not a substitute for actually running
  it in Phase B, but the ordering and syntax classes of failure are ruled out.
- **A3. Decide the questions in §8.** ✅ Answered 2026-09-10 — see §8.

### Phase B — build the new project (nothing live changes)

- **B1.** Nina creates a new Supabase project. Region: **Sydney (ap-southeast-2)** — the choir is
  in Melbourne and the current project should be checked to match.
- **B2.** Add `sonario` to Settings → API → **Exposed schemas**. Do this early; it's the one that
  silently breaks everything.
- **B3.** Run, in order: `0000` → `0001` → `0002` → `0003` → `0004` → `0005` → `0006`, then
  **`0000` once more** as the grant sweep, then the `revoke`/`grant` block quoted at the bottom of
  `0000` to restore the security-definer restrictions the sweep loosens. Stop at the first error
  rather than pressing on. Note §0.1b: **0003 cannot be re-run** as it stands, so if you have to
  restart partway, either fix it first or skip it if it already succeeded.
- **B4.** Configure auth per §2. Add the new callback URI in Google Cloud Console.
- **B5.** Nina signs in with Google against the new project → a real `auth.users` row appears →
  promote it to `active` / `super` with the bootstrap query in `0001` §11 (it deliberately looks
  the id up rather than assuming one).
- **B6.** Run `real_schedule_2026.sql`, then `seed_test_data.sql`, then
  `dev_my_attendance_term3.sql`.

### Phase C — cut the app over

- **C1.** Update `js/config.js` with the new URL + anon key; bump `APP_VERSION` and
  `CACHE_VERSION`. One commit.
- **C2.** Nina pushes. Vercel deploys.
- **C3.** Re-point the `supabase-sonario` MCP entry at the new ref. (Side benefit: this finally
  fixes the wrong-project problem that has forced every migration to be pasted by hand.)

### Phase D — validate (§6). **Do not proceed to E until every check passes.**

### Phase E — decommission from the old project 🔴 *destructive, and order is mandatory*

```sql
-- 1. The trigger FIRST. Leaving it while dropping the schema breaks Page Turners sign-in.
drop trigger if exists on_auth_user_created on auth.users;

-- 2. Then the function it called.
drop function if exists sonario.handle_new_auth_user();

-- 3. Confirm Page Turners still signs in — open it, sign in anonymously — BEFORE step 4.

-- 4. Only then, and only after Phase D passed:
drop schema sonario cascade;

-- 5. Remove the fake members from the shared auth.users (they were inserted there directly).
delete from auth.users where id::text like 'f0000000-0000-0000-0000-%';
```

**Wait at least a week between D and E.** The old project is the rollback (§7), and it costs
nothing to leave in place.

---

## 6. Validation, after Phase C and before Phase E

Grouped by what could actually be wrong. **"No error" is not a pass** — this project's recurring
bug class is an RLS-filtered write returning no error and zero rows.

### Structure
- [ ] `select count(*) from information_schema.tables where table_schema = 'sonario'` → **18**
- [ ] `select count(*) from pg_policies where schemaname = 'sonario'` → **43**
- [ ] `select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'sonario'` → **12**
- [ ] 9 functions present; `select count(*) from pg_trigger where not tgisinternal` accounts for all 6 triggers
- [ ] `select * from sonario.part_labels order by sort_order` → 11 rows, `common` true for sop/alto/tenor/barry
- [ ] `song_assignments_one_part_per_person_per_song` exists in `pg_indexes`

### Data
- [ ] Term 3 2026 = 10 Tuesdays 14 Jul – 15 Sep; Term 4 = 11 Tuesdays 6 Oct – 15 Dec
- [ ] Melbourne Cup Day (3 Nov) is `cancelled`
- [ ] Nina's Term 3: 7 check-ins, 2 absences; Home reads **7 / 9, 78%**

### The app, as a member
- [ ] Sign in with Google **and** with an email magic link
- [ ] Home: next rehearsal, My Term stats, Coming up
- [ ] Calendar: week strip, month-grouped list, filter chips
- [ ] Open an event → sheet opens, closes on × and on backdrop
- [ ] **Log leave, then confirm the row exists** (`select … from sonario.away_dates`), then cancel it and confirm it reads `cancelled`. This is the path that was structurally impossible until 0005 — re-verify it, don't assume
- [ ] **Change your display name in More → My Profile and confirm it persisted.** Never verified even once; `update own profile` has no `WITH CHECK`
- [ ] Check in on a rehearsal day, then undo within the hour
- [ ] Realtime: open two browsers, cancel an event in one, watch the other update without a reload

### RLS, adversarially — as a plain member
- [ ] Cannot create / edit / cancel / delete an event
- [ ] Cannot read anyone else's absence, check-in or leave row
- [ ] Cannot see the Admin tab, and a direct write to a super-only table fails
- [ ] Cannot self-confirm own leave (`status = 'confirmed'` must be rejected)
- [ ] A direct `select from sonario.profiles` returns **only your own row**
- [ ] `select * from sonario.member_directory()` returns the choir; **a non-member gets zero rows**

### Cross-app
- [ ] Page Turners still loads and signs in (before AND after Phase E step 1)
- [ ] A new Page Turners visitor does **not** create a Sonario membership request

---

## 7. Rollback

**The old project is the rollback, and it stays fully intact until Phase E.** That is the whole
reason E is separated and delayed.

| Failure point | Rollback |
|---|---|
| Phase B (migrations error) | Nothing live has changed. Fix and re-run, or delete the new project and start again |
| Phase C/D (app broken on the new project) | **Revert `js/config.js` to the old URL + key, bump the versions, push.** Back on the old project within one deploy. Any data written to the new project in between is lost, which is acceptable — it's a schedule and test attendance, all reproducible |
| Phase E step 1–2 (trigger/function dropped, Page Turners breaks) | Re-run the trigger + function definitions from `0001` §2 against the old project |
| Phase E step 4 (schema dropped, then something is found missing) | **No rollback.** The schema is gone. This is why D must fully pass and why E waits a week |

PITR on the old project is a backstop only if the plan is on a paid tier — **worth checking before
Phase E**, because on the free tier there is no point-in-time recovery, only whatever daily backup
exists.

---

## 9. A1 audit results (2026-09-10)

Identity row confirmed `SHARED PROJECT — correct, carry on`.

### Page Turners: clean 🟢
- **Exactly ONE trigger on `auth.users`** — `on_auth_user_created` → `handle_new_auth_user` in
  schema `sonario`. No second trigger, so **the Phase E order in §5 holds as written**. This was
  the finding that could have halted the split, and it didn't.
- **Zero `public` functions reference `sonario`.** Nothing in Page Turners calls into the schema
  that eventually gets dropped.
- 15 anonymous auth users (Page Turners visitors) and 9 non-anonymous (Nina + the 8 seeded fakes).

### Counts reconcile exactly, and every difference is explained

| | Expected | Live | Difference |
|---|---|---|---|
| Tables | 18 | **21** | +3 legacy: `notices`, `social_events`, `social_rsvps` |
| Functions | 8 | 8 | — |
| Policies | 42 → **40** | **51** | +11 on the three legacy tables (see the correction below) |
| Triggers on sonario tables | 5 | **7** | +2 `set_updated_at` on the two social tables |
| Realtime tables | 12 | **15** | +3 legacy tables |
| Indexes | 12 | **43** | +31, all primary-key/unique constraint indexes plus the legacy tables' own — benign; the expected list only ever held explicitly-created indexes |
| RLS disabled anywhere | 0 | **0** | — |
| Grants | present | **present** | `anon, authenticated` usage, 21/21 tables, default privileges set |

**The grant rows are the evidence that §0.1 was real.** The live project has exactly the grants
the migration chain never contained — applied years ago by the stale `schema.sql`. `0000` now
reproduces them.

### Correction to this document: 40 expected policies, not 42 🔧
The two `MISSING LIVE: policy` rows were **the audit script being wrong, not the database**:

- `away_dates / members read away dates` — created by 0001, **dropped by 0002** (the privacy fix
  that replaced it with `own away dates or super reads`).
- `checkins / members write own checkin` — created by 0001, **dropped by 0003** (replaced by
  `members check in to today's event`).

Both are *correctly* absent live. The script had collected every `create policy` in the chain
without subtracting later drops. Fixed: the expected list is now built by replaying creates and
drops in file order, so it holds what the chain **leaves behind** — 40. That makes live 51 = 40 +
11, which reconciles perfectly.

### The real finding: three tables no migration recreates 🟡 — RESOLVED, see §8 q3
`notices`, `social_events`, `social_rsvps`, with 11 policies, 2 triggers, 3 realtime
registrations and 3 indexes between them. These are **pre-rebuild leftovers** from the old
`supabase/schema.sql`; `js/noticeboard.js` and `js/social.js` still exist in the repo but are not
wired into `app.js`, and neither notices nor social appear anywhere in the Figma design. HANDOVER
lists "broader social/notices" as deferred.

**A fresh rebuild will not have them.** That is arguably the right outcome — but it must be a
decision, not an accident. See §8 question 3.

### Two unexpected things, neither Sonario's to fix
- **Storage buckets `trip-photos` and `update-photos` exist in this project.** Neither name
  suggests Sonario or Page Turners, and North Island Diary supposedly has its own project. Most
  likely leftovers from before it moved.
- **`public` holds 24 tables.** Page Turners' code references three (`books`, `ratings`,
  `meetings`).

If both are old North Island Diary residue, the shared project is carrying a third app's
leftovers, and the storage-quota argument for splitting is stronger than assumed. **Out of scope
either way** — this plan touches neither, and cleaning them is a separate conversation.

### Data present
2 terms · 21 events (1 cancelled) · 10 profiles · 8 active memberships, **2 super** · 7 check-ins
· 2 absences · 2 away_dates · 11 part_labels · 0 songs/recordings/recaps.

### The "2 supers" alarm was mine, and it was wrong 🔧
Raised as a possible integrity problem, then resolved by reading the file that causes it.
`supabase/seed_test_data.sql:52` **deliberately** makes seeded fake #1
(`f0000000-…-000000000001`) an active **super**, so the queue and the member-management screens
have a second organiser to render. The arithmetic reconciles exactly:

| | |
|---|---|
| 8 seeded fakes | 1 active super + 5 active members + 1 pending + 1 deactivated |
| Nina | active super |
| Leave Test | active member |
| **10 profiles · 8 active · 2 super** | matches the audit precisely |

Two independent corroborations that the Leave Test identity is **not** a super:

1. The arithmetic above leaves no room for a third super.
2. **Migration 0005's own recorded outcomes could not have happened for a super.** Its header
   documents that the test identity *could not* self-confirm its leave and matched *zero* rows
   cancelling someone else's. The `super confirms away dates` policy is `using (is_super())` — a
   super would have been **allowed** to self-confirm. The block is only explicable as a
   non-super.

So the prior plain-member RLS results stand. The follow-up query still confirms it directly by
printing role per profile, and that remains the actual proof rather than this reasoning.

**Consequence for Phase B:** `seed_test_data.sql` will recreate a second super in the new
project. That is intended and should be left as is — but it means "2 supers" is the correct
expected value there too, and a validation check that expects 1 would be wrong.

---

## 8. Decisions

1. ✅ **The Leave Test identity — recreate an equivalent.** Nina, 2026-09-10: "Recreate an
   equivalent Leave Test ordinary-member identity in the new Sonario project. It does not need to
   retain the same UUID; I just want a dedicated non-super identity for testing RLS, leave and
   normal-member behaviour." **Must be `role = 'member'`, not super** — and the follow-up query
   checks whether the current one actually is.
2. ✅ **Carry the 8 fake members and the fabricated Term 3 attendance over.** Nina: "I want
   realistic seeded data available for testing Home, My Term, Calendar, Attendance and Admin."
3. ✅ **The three legacy tables are LEGACY and will not be recreated.** Nina, 2026-09-10: "treat
   `notices`, `social_events`, and `social_rsvps` as legacy and do not recreate them in the new
   Sonario project **unless the follow-up shows they contain data that is genuinely still
   needed**." So: the new project gets a schema matching the migrations exactly, and the only
   thing that could change this is real content in those tables — which the follow-up settles.
   They stay untouched in the old project either way.
4. ✅ **`trip-photos`, `update-photos` and the extra `public` tables are OUT OF SCOPE.** Nina:
   "Identify them only; do not delete, migrate, or modify them." Identified in §9. **No step of
   this plan touches them at any phase**, including Phase E — whose `drop` statements are scoped
   to the `sonario` schema and its `auth.users` trigger, and never to `public` or `storage`.
5. ✅ **If a plain-member RLS result turns out to have been obtained with a super identity, it is
   unverified.** Nina: "prior plain-member RLS testing should be treated as unverified and re-run
   later with a true ordinary member." The specific claims that would be affected, so they can be
   found if it ever comes up: the leave log→cancel verification recorded in the header of
   `0005_members_can_actually_cancel_leave.sql`, and the Step C adversarial results in HANDOVER
   §7. Current evidence (§9) says both stand.
