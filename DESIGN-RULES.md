# Sonario — locked design & colour rules

Set by Nina 2026-09-10. **These are the design system, not suggestions.** Do not reinterpret
colours arbitrarily or redraw the logo. If something here conflicts with a mockup, ask — the
rules were written after the mockups and generally win.

## Core brand

- **Primary Sonario purple: `#7052CD`.** The old `#6A4FD6` is **not** the brand colour any more.
  (It lingered in three places longer than anyone realised: the manifest theme colour, the app
  icons, and a stale handover note. All corrected.)
- **App icon:** dark condensed "S" derived from the real SONARIO wordmark, on pale lavender.
  Ink `#1E0355`, background `#EEE6FF`.
- **The wordmark keeps its tall, narrow, condensed face.** Do not substitute or redraw the logo
  with a generic S or another font.
- **The face is Big Shoulders Display 900, everywhere.** Settled by Nina 2026-09-10: "Use Big
  Shoulders 900 consistently. The Figma design is the approved visual source of truth." The
  wordmark is 26px/39px with 1.04px tracking; the app icons were re-rendered from the same face
  at weight 900, keeping composition, tile sizes, glyph proportions and colours unchanged. The
  ink height of the S is identical to the Oswald version — only the letterform is wider and
  blockier. **Oswald is gone from this project.** `scripts/make-icons.py` is still the sanctioned
  way to produce new sizes; it now takes the Big Shoulders variable TTF.
- **Careful:** the branding sheet uses TWO darks and they are not interchangeable — the
  **wordmark** is near-black `#090223`, the **S mark / app icon** is indigo `#1E0355`.

## Event colour semantics

Colours are **semantic, not decorative.** Never colour a card for visual variety.

| Meaning | Colour | Token |
|---|---|---|
| Standard rehearsal | dark purple | `--purple` / `--purple-light` pill |
| Workshop / extra rehearsal | light purple / lilac | `--lilac-*` |
| Performance / concert | green (positive, confirmed) | `--green-*` |
| Social event | teal / blue (fun, distinct from performance) | `--teal-*` |
| Heads-up: tentative/TBC, or time-sensitive | yellow / butter | `--butter-*` |
| Cancelled, no rehearsal, important disruption | red / coral | `--coral-*` |

**Green is the positive status colour** generally — "You're expected", checked in, confirmed.

**Yellow/butter vs coral/red — the line between them**, widened 2026-09-10 when Nina asked for a
"last week of term" notice in orange/yellow:
- **Butter means heads-up, not alarm.** Provisional or time-sensitive: a tentative/TBC event, or
  the last-week-of-term notice on Home.
- **Coral means something has gone wrong or changed.** Cancelled, or a genuine disruption.

Don't use coral casually; an organiser's ordinary note about a rehearsal is neither.

⚠️ **Tentative has no data behind it yet.** `rehearsals.status` is only
`scheduled` / `cancelled`, so the butter tokens exist but nothing can currently be marked TBC.
Adding it means a migration widening that check constraint.

## Typography

Set from the Figma, 2026-09-10. **Oswald is gone from the app** (it survives only inside
`scripts/make-icons.py`, see the warning above).

- **Inter for everything** — 400 through 900. The heavy weights do the work that Oswald's
  condensed caps used to: section headings are Inter **900 at 12px** with 1.44px tracking
  (`MY TERM`, `COMING UP`), stats are **800 at 24px**, the hero's date numeral is **900 at 44px**.
- **Big Shoulders Display 900** for the SONARIO wordmark only. Nothing else uses it.
- **Screen titles are sentence case**, not uppercase — "Calendar", not "CALENDAR". The Figma sets
  them as Inter 900/800 names rather than as condensed all-caps section labels.
- The exact greys are tokens, so a value can be checked against the design file by eye:
  `--fig-ink #111827` (headings), `--fig-meta #6B7280` (secondary), `--fig-mute #9CA3AF`
  (tertiary, inactive nav), `--fig-hair #F3F4F6` (hairlines).
- The body ground is **flat `#EEE6FF`** (`--fig-lav`). The old radial lavender wash is gone — it
  fought the purple hero's hard bottom edge.

## Event row tints — semantic, not rehearsal/not-rehearsal

The Figma paints every non-rehearsal row the same sky blue (`#E0F2FE`). That encodes
*rehearsal vs. anything else*, which is a different claim from the semantic palette above. Nina
chose **semantic** when asked (2026-09-10), so the row tints are:

| Type | Token | Value |
|---|---|---|
| Rehearsal | `--tint-rehearsal` | `#FFFFFF` |
| Workshop | `--tint-workshop` | `#E1D4FE` |
| Performance | `--tint-performance` | `#DCFCE7` |
| Social | `--tint-social` | `#E0F2FE` (the Figma's own blue) |
| Cancelled | `--tint-cancelled` | `#FEE2E2` |

Rehearsals stay **white**: the common case shouldn't be colour-coded, so colour on a row means
"this one isn't the usual Tuesday". Cancelled **overrides the type** — "this isn't happening"
outranks "this was going to be a concert". Lilac sits deeper than the others because it has to
separate from the `--fig-lav` ground behind it; the rest are matched to `#E0F2FE`'s lightness so
a mixed list reads evenly.

One component renders these on both Home and Calendar — `RailRow` in `js/events.js`. Keep it that
way, so a change to how an event reads in a list can't land on one screen and miss the other.

## Voice parts

Set by Nina 2026-09-10. Ten assignable parts, of which **four are standard** and six are
subdivisions that stay selectable but shouldn't crowd the picker.

| Standard | Subdivisions |
|---|---|
| Sop, Alto, Tenor, **Barry** | Sop 1, Sop 2, Alto 1, Alto 2, Tenor 1, Tenor 2 |

- **"Barry" means baritone.** It is what the choir says, so it is what the app says. Don't
  "correct" it.
- A picker shows the four standard parts up front and the six subdivisions behind a *more*
  affordance — the `common` boolean on `part_labels` (migration 0006) is what that reads.
- **`Full choir` is not a person's part.** It exists so a *recording* can be of the whole choir;
  the `enforce_assignable_part()` trigger rejects it on `song_assignments`.
- One live part per person per song, enforced by a partial unique index rather than by the UI.

## General visual direction

- Consumer-app feel — the clarity and hierarchy of Up or Spotify, **not an admin dashboard**.
- Strong Sonario purple areas establish hierarchy, especially at the top of major screens.
- Main content background is **very pale lavender/off-white**, not stark white everywhere.
  White/light cards sit over it.
- Rounded cards, restrained shadows, generous spacing.
- **Strong typography and hierarchy rather than excessive borders.**
- Use colour sparingly, so coloured states actually mean something.
- **No taglines.** Not "A singing ensemble", not "A stronger choir, together", not anything of
  that kind. Nina asked for this explicitly.
- **No judgemental or gamified labels** — never "On track!", "Great work!" or similar.

## Bottom navigation — locked

1. **Home** — house
2. **Calendar** — calendar
3. **Repertoire** — music note
4. **Admin** — crown
5. **More** — three dots

Inactive icons outlined/muted; the active tab uses the filled version. **Keep one icon family
throughout the app** — don't switch styles between screens.

Admin remains **super-only**, so an ordinary member sees four of these five. That's the one
deliberate exception to "locked", because a nav item that opens an organiser console has no
business appearing for a member.

## Calendar rules

- **No global Subscribe button.**
- Normal rehearsals **do not use RSVP** — members are expected by default. An individual event may
  offer **Can't make it?**
- The Calendar header carries a clearly labelled **`+ Log leave`** action.
- **Log leave takes a date range**, so a member away on holiday doesn't mark every affected
  rehearsal one by one. Where leave overlaps an event, that event shows **You're away**.
- Keep the two distinct: **Can't make it?** = one-off event absence. **Log leave** = a period away.
- On an individual event, offer **Add to calendar** for Apple/iCal and Google — not a
  whole-calendar subscription.

Leave maps onto the existing `away_dates` table (own-row-or-super RLS already in place), so it
needs no migration.

## Home — My Term

**The denominator is rehearsals that have OCCURRED so far**, not total scheduled in the term.
In week 2 having attended both, it reads `2 / 2`, never `2 / 10`.

The three stats are exactly:

1. `8 / 10` — **rehearsals so far**
2. `80%` — **attendance**
3. `6:57pm` — **avg. arrival**

If there isn't enough arrival data, show `—` rather than inventing a value. (Implementation: the
app requires at least 3 timestamped check-ins before showing an average, on the grounds that a
mean of one arrival isn't an average. Change that threshold here if you disagree.)


## Future functionality (agreed, not built)

Recorded so these don't get quietly lost, and so nobody fabricates the data to make a mockup
render. None of them blocks current work.

- **Latest Recap on Home.** Wanted in the intended Home design. Needs the full chain: recap
  authoring → stored recap → latest published recap surfaced on Home. `rehearsal_recaps` and
  `rehearsal_recap_items` exist as tables with no content and no UI.
- **Tentative / TBC events.** An organiser creating or editing an event should be able to mark it
  Tentative, which invokes the butter/yellow state. Needs a migration widening
  `rehearsals.status` beyond `scheduled` / `cancelled`. Do not add that migration merely to make
  a mockup render.
- **A proper Notice concept, with severity/type.** Only an actual change or disruption earns the
  coral treatment. An ordinary organiser note must not masquerade as an urgent alert — which is
  why Home currently renders the event's own note in neutral lilac.
- **Leave lifecycle.** Currently: a member logs leave, it's effective immediately, and they can
  cancel it while it's `pending`. Eventually: organisers can see it, members can cancel or edit
  *future* leave, an admin can override, and there are no silent failure states. Note that
  `away_dates` has **no DELETE policy** and the member UPDATE policy is limited to
  `status = 'pending'`, so any expansion here means new policies.
- **Calendar becomes a week strip.** The Figma replaces the month grid with a single scrolling
  week (M–S with an event dot under each day) above an event list grouped under month headings
  (`JULY 2026`, `AUGUST 2026`). This is a better answer to "the calendar takes up too much room"
  than the trimming done on 2026-09-10, and it supersedes it. Needs no new data — the month grid
  and the week strip read the same `rehearsals` rows. Plus filter chips: All / Rehearsals /
  Performances / Other.
- **More becomes a real profile screen.** Name + voice part + choir, then My Profile, My
  Availability, Notification Settings, Help & Feedback, About Sonario, Sign out. Voice part is
  the only new field; the rest are either existing (sign out) or shells.
- **Repertoire and Practice Mode.** Corrected 2026-09-10: **most of the schema already exists**
  and is empty — migration 0001 §7 creates `part_labels` (seeded Sop / Alto / Alto 1 / Alto 2 /
  Tenor / Tenor 1 / Tenor 2 / Barry / Full choir), `songs`, `song_assignments` (per song, per
  person, collaboratively editable by any active member with a non-spoofable `updated_by`),
  `recordings` (per song **per part**, Storage-backed, 50MB cap, audio mime whitelist) and
  `rehearsal_songs` (setlists), all with RLS. Split it three ways before quoting any effort:
    - **No database work:** the songs list, per-song part assignments, per-event setlists, and
      reading recording metadata. `js/repertoire.js` exists from the original scaffold and is not
      wired into the nav.
    - **New schema:** the Figma's **named collections** — "Semester 2 · 2026" with a CURRENT
      badge, "Semester 1 · 2026", "Sonario Classics · All-time favourites". `rehearsal_songs`
      ties songs to an *event*, so "Mid-Year Concert 2026" maps onto it, but a standing
      collection that isn't an event has nowhere to live. Also the **profile-level voice part**
      the More screen shows ("Soprano · …"); note `song_assignments` is deliberately per-song, so
      a member's part can differ between songs — which is exactly what Practice Mode's queue
      shows ("Alto only", then "Soprano only"). Don't collapse the two without deciding which
      is authoritative.
    - **New infrastructure, not schema:** a Supabase **Storage bucket plus bucket policies**
      mirroring the RLS model, for the audio itself. The app has never used Storage.
  **Answered by Nina, 2026-09-10 — these are settled:**
    - **Semester for repertoire folders, term for attendance.** Both units coexist on purpose and
      must not be unified: a song library is browsed by semester ("Semester 2 · 2026"), while
      attendance, My Term and the last-week notice all stay on `terms`. Don't "tidy" one into the
      other.
    - **Any active member may upload a recording.** That's what the existing 0001 policy already
      allows, so no policy change. Admin's Recordings section is therefore oversight (see what's
      there, remove something), not an upload gate — note 0001 lets the **uploader or a super**
      delete.
    - **Voice part is one per person PER SONG**, not a profile field. This is already the shape of
      `song_assignments`, and migration 0006 adds the partial unique index that actually enforces
      it. **Consequence for the More screen:** its Figma line "Soprano · Melbourne City Choir"
      cannot be read off a profile, because there is no profile-level part. Either derive
      something (most-assigned part this semester) or drop the part from that line — an open
      design question, not a data one.
- **Admin gains a Recordings section**, listed above Events in the Figma. Blocked on the Storage
  bucket rather than on schema — `recordings` already exists.

### Rule for all of the above
For member-facing Calendar and Home logic, `pending` and `confirmed` away dates are **both
effective immediately** — an overlapping rehearsal shows "You're away". But the underlying status
is preserved and the two are never collapsed: a detailed leave view may show "Pending
confirmation" without changing the event-level treatment.


## Home — last week of term

A butter notice pins to Home when the term's **last actual event** is seven days away or fewer.

Anchored on the last event, not on `terms.ends_on`: the end date is administrative (Term 3 2026
ends Friday 18 September) while the last rehearsal is the thing worth warning about (Tuesday the
15th). Counting back a week from `ends_on` would show the notice after everyone's last chance to
act on it in a term whose final rehearsal sits well before its end date.

Derived entirely from `terms` + `rehearsals`, so there's nothing to author and no notices table
behind it — it appears and disappears on its own. It hides once that last event has passed, even
if the term technically runs on.
