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
  with a generic S or another font. The mark is the letter S in **Oswald Bold**, which is why
  `scripts/make-icons.py` can render it from type — that script is the sanctioned way to produce
  new sizes.
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
