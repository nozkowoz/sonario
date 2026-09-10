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

## More

**Built 2026-09-10** to the Figma (PDF p5). Purple hero with the member's avatar and name, then
plain white cards, then Sign out in red, then a version line. Identical for every member — More
is role-blind, like Home.

Three departures from the mockup, all settled with Nina on 2026-09-10:

- **No voice part under the name.** The mockup shows "Soprano · Melbourne City Choir". A voice
  part is one per person **per song** (see below), so there is no profile-level part to print. It
  could be derived — a member's most-assigned part — but there are no songs yet, so that query
  can only return nothing today. **It goes in when Repertoire does**, and no profile column was
  added for it.
- **The choir is called Sonario.** "Melbourne City Choir" was a mockup error (Nina's words: "the
  mock up got it wrong"). Since the wordmark directly above already says SONARIO, the subtitle
  would have been repeating itself, so it's gone rather than restated.
- **"My Availability" navigates to Calendar** instead of carrying its own leave list. Nina asked
  for leave to stay on Calendar; two screens that both list and cancel leave are two places to
  keep in step.

**My Profile edits the display name only.** `google_email` comes from the identity provider and
`avatar_url` is whatever Google returned, so neither is editable. The mockup's "contact info" has
no column behind it and **one was not added** — adding schema to make a mockup render is the thing
Nina explicitly asked not to happen.

**The version line shows `APP_VERSION`, not "Version 1.0".** The mockup's friendlier string would
lose the one thing that footer is for: telling Nina which build a phone is actually running,
given the PWA's caching.

**"About Sonario" is factual, not legal.** The mockup says "Version info and legal details";
writing a privacy policy and terms this app doesn't have would be pretending. It states the
version, the term, what the app does, and who can see your attendance.

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

**Built 2026-09-10 to the Figma.** The month grid is gone, replaced by a **week strip inside the
purple hero**:

- **One row of seven days**, Monday-first, with `‹ ›` stepping by **week**. The header names the
  month; a week straddling two months says so ("Sep – Oct 2026") rather than picking one and
  being wrong for three days.
- **Today gets a ring, the selected day gets a white fill.** They coincide when the tab opens,
  which is why the fill has to win — two treatments on one cell reads as two different days.
- **Dots are a single translucent white**, not the semantic type colours. On purple, dark purple /
  green / teal are all but invisible. The row tints in the list carry what kind of event it is.
  **The legend went with the grid** — it existed to decode the dots' colours and has nothing left
  to decode.
- **A day with no events is disabled but not greyed.** Greying five days of every week makes the
  strip harder to read as a week, and "no rehearsal" isn't a disabled state, it's just Wednesday.
- **Tapping a day:** one event opens it; more than one narrows the list to that day with a *Show
  all* escape; none does nothing.
- **The list is UPCOMING, grouped by month heading — not scoped to the visible week.** That's the
  division of labour: the strip is a date jumper, the list is the whole road ahead. Scoping the
  list to the week would put at most a handful of events on screen and make the strip mandatory
  navigation rather than a shortcut.
- **A member's own state replaces the chevron** on a row where there is any: a green tick for
  checked in, a muted **minus-in-circle** for away or can't-make-it. Not a circle-X — on a list
  where cancelled events already use a coral tint and a struck-through title, an X beside a
  healthy concert reads as the event being off rather than the member being absent. The words
  live on the detail screen; at 358px wide the row title needs the space.

### The event sheet

**Built 2026-09-10.** An event opens as a **bottom sheet over whatever screen you were on**, not
as a screen that replaces it — you're glancing at one rehearsal, not navigating away from your
term. There is exactly ONE sheet, owned by `js/app.js`, so Home and Calendar share it and it has
the data (terms, absences, check-ins, leave, directory) already loaded there. It's keyed by event
**id**, not by the row object, so a realtime change while the sheet is open shows up instead of
being frozen at the moment it was tapped.

- Order is: date line, title + type pill, time and location, **status**, then Add to calendar,
  Notes, and **"Can't make it?" last, on its own**. That placement is deliberate: it's the only
  action on the sheet and it must never be what a thumb finds on the way to reading the time.
- **"Can't make it?" is hidden when you've checked in** (you evidently came) **and while you're
  on leave**. Leave already covers that rehearsal, and offering it would invite a second,
  redundant row saying the same thing. Cancel the leave if it's wrong.
- The status card's second line is state-aware: "See you there!" when expected, and **the
  member's own leave note** when away — in the neutral grey, not the positive green, because
  "away for work" is not a positive state.

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
