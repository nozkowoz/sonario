# Phase B runbook — build the new Sonario project

**Read this first: Phase B cannot be executed by Claude.** Every step is either a Supabase
dashboard action, a Google Cloud Console action, or SQL that has to run against a project that
doesn't exist yet. Concretely:

- There is **no** "create project" tool. The Supabase MCP has `execute_sql`, `list_tables`,
  `get_advisors` and similar — nothing that provisions a project.
- The MCP is **bound to a single project**, and that project is
  `ylrcotvnrvvfosuvtleh` — **North Island Diary** (confirmed via `get_project_url`). It cannot be
  repointed without restarting the session, and it could never point at a project that hasn't
  been created.
- Auth setup needs Nina's Google Cloud credentials and dashboard access.

So this file is the thing Claude *can* produce: an ordered runbook where every step is either
**[NINA]** (a click) or **[SQL]** (a paste), with what to expect from each, and one script at the
end that answers all five of Phase B's report questions at once.

**The old shared project is not touched at any point in Phase B.** Nothing here connects to it.

---

## One deviation from SPLIT-PLAN.md, and why

The plan said: *run `0000`, run `0001`–`0006`, run `0000` again, then apply the revoke block.*

That has been replaced by: *run `0000`, run `0001`–`0006`, run **`0007`**.* Same end state, and
it fixes two real problems:

1. **The revoke block in `0000` was entirely commented out.** Applying it "exactly as documented"
   would have run nothing — a silent no-op leaving `anon` and `authenticated` able to execute the
   security-definer trigger functions, while looking like it had locked them down.
2. *"Run this file a second time, in a different position, for a different reason"* is an
   instruction that gets skipped or done out of order. One file that runs once, last, doesn't.

`0007_grant_sweep_and_revokes.sql` does the sweep, then the revokes, then **prints a verdict per
function** so the result is visible rather than assumed. `0000` no longer carries a sweep.

---

## Step 1 · [NINA] Create the project

Supabase dashboard → New project.

- **Name:** something unmistakable, e.g. `sonario`
- **Region:** `Southeast Asia (Singapore)` or `Australia (Sydney)` — whichever the existing
  shared project uses. **Check the old project's region and match it**, so latency doesn't change
  underneath the app.
- Save the database password somewhere safe. It isn't needed for any step here, but it is
  unrecoverable.

Note the **project ref** (the `xxxxxxxx` in `https://xxxxxxxx.supabase.co`). Needed at cutover,
not now.

## Step 2 · [NINA] Expose the schema — *do this before anything else*

Settings → API → Data API → **Exposed schemas** → add `sonario` (keep `public`).

This is the single easiest thing to forget and the hardest to diagnose. The client is pinned to
`db.schema = 'sonario'`, so without this **every request 404s** and the app looks entirely broken
while the database is perfectly correct. There is no SQL that can set it.

## Step 3 · [SQL] Run the migration chain, in order, one at a time

SQL Editor → new query → paste → Run. **Stop at the first error** rather than pressing on.

| # | File | Expect |
|---|---|---|
| 1 | `migrations/0000_schema_and_grants.sql` | Success, no rows |
| 2 | `migrations/0001_foundation.sql` | Success, no rows |
| 3 | `migrations/0002_events_and_privacy.sql` | Success, no rows |
| 4 | `migrations/0003_checkin_undo_window.sql` | Success, no rows |
| 5 | `migrations/0004_signup_trigger_skips_anonymous.sql` | Success, no rows |
| 6 | `migrations/0005_members_can_actually_cancel_leave.sql` | Success, no rows |
| 7 | `migrations/0006_voice_parts.sql` | Success, no rows |
| 8 | `migrations/0007_grant_sweep_and_revokes.sql` | **8 rows**, every `verdict` = `ok` |

Step 8's output is the first real checkpoint. Four trigger functions must show `-` for both roles;
four callable functions must show `authenticated` only. Any row saying `WRONG` means the revokes
didn't apply and must be resolved before continuing.

## Step 4 · [NINA] Google sign-in

**4a. Supabase** → Authentication → Providers → **Google** → enable, paste the same client ID and
secret the old project uses (Google Cloud Console → Clients).

**4b. Google Cloud Console** → the same OAuth client → Authorised redirect URIs → **add**:

```
https://<NEW-PROJECT-REF>.supabase.co/auth/v1/callback
```

**Add, don't replace.** The old URI must keep working — the deployed app still points at the old
project until cutover, and removing it would break sign-in immediately.

The consent screen app name ("Sonario") is per Google-Cloud-project, so it carries over untouched.

## Step 5 · [NINA] Email sign-in and redirect URLs

- Authentication → Providers → **Email**: enabled. `signInWithOtp` is a live path in
  `js/auth.js`, not dead code.
- Authentication → URL Configuration → **Site URL** = the Vercel production URL.
- **Redirect URLs** must include both the Vercel URL and `http://localhost:8777`, because the app
  passes `redirectTo: window.location.origin`. Without localhost, local sign-in breaks.

## Step 6 · [NINA + SQL] Sign in, then promote

1. Open the deployed app **in a private window**… except it still points at the old project. So
   instead: run the app locally against the new project **without committing the change** —
   temporarily edit `js/config.js`, `python3 -m http.server 8777`, sign in with Google, then
   **revert the file**. Cutover is a separate, approved step; this is a throwaway local edit.
2. Then `supabase/recreate_test_identities.sql` **step 1** — promotes her to active/super. It
   looks her id up by email rather than assuming one. **Expect exactly one row back**; zero means
   she hasn't signed in yet.

## Step 7 · [NINA + SQL] The Leave Test identity

`recreate_test_identities.sql` steps 2–3. An anonymous sign-in from the browser console, then two
inserts with that uuid pasted in.

It's manual because migration 0004 makes the signup trigger skip anonymous identities — the fix
for Page Turners' visitors filling Sonario's approval queue. **Must be `role = 'member'`.**

## Step 8 · [SQL] Seed, in this order

1. `supabase/real_schedule_2026.sql` — terms + all 21 events
2. `supabase/seed_test_data.sql` — the 8 fake members
3. `supabase/dev_my_attendance_term3.sql` — Nina's Term 3 attendance

Schedule **first** (attendance needs the events to exist), attendance **last** (it looks Nina up
by email, so it self-heals to her new uuid with nothing edited).

## Step 9 · [SQL] Verify — this answers all five report questions

Run `supabase/phase_b_verify.sql`. One query, ~20 rows, sorted so **`BLOCKER` rows come first**.

- Row 1 must say `NEW SONARIO PROJECT — correct`. If not, stop.
- Structure rows: 18 tables · 8 functions · 40 policies · 5 triggers · 12 realtime · 12 indexes ·
  0 with RLS off · legacy tables absent.
- Grant rows: schema usage to both roles, 18 tables selectable, 4 trigger fns unreachable, 4
  callable fns authenticated-only.
- Data rows: 2 terms · 21 events · 1 cancelled · 10 Term 3 Tuesdays · 10 profiles · 8 active ·
  **2 super** · 7 check-ins · 2 absences · 11 part_labels with 4 common · Leave Test
  active/member.
- Auth rows: exactly 1 trigger on `auth.users`, Google identity present, no buckets yet.

**2 supers is correct**, not a defect — `seed_test_data.sql` deliberately makes one seeded fake a
super so the organiser screens have something to render.

Paste the output back. Anything not `ok` gets resolved before cutover is discussed.

---

## Explicitly NOT in Phase B

- ❌ Editing `js/config.js` for real, or committing it
- ❌ Cutting the deployed app over
- ❌ Touching the old shared project in any way — no trigger removal, no function removal, no
  schema drop, no legacy tables, no storage objects
- ❌ Creating a Storage bucket (that belongs with Repertoire/Recordings, after cutover)
- ❌ Recreating `notices`, `social_events`, `social_rsvps` — confirmed empty, agreed as legacy
