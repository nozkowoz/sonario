import { html, useState, useMemo } from './lib.js';
import { formatEventDate, formatEventDateLong, parseLocalDate, todayStr, localDateStr } from './lib.js';
import { logLeave, cancelLeave, awayRangeFor } from './store.js';
import { RailRow, currentTermOf } from './events.js';
import { LoadingState, EmptyState } from './shell.js';
import { IconChevron, IconBack, IconCheckCircle, IconMinusCircle } from './icons.js';

// The member Calendar, per DESIGN-RULES.md. No Subscribe (removed by rule — add-to-calendar lives
// on the individual event instead), and no RSVP anywhere: members are expected by default and the
// only actions are "Can't make it?" on one event or "Log leave" for a period away.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// The WEEK STRIP, replacing the month grid (Nina's Figma, 2026-09-10). One row of seven days
// inside the purple hero rather than a six-row grid in a white card below it.
//
// This is the real answer to "the calendar takes up a bit too much room so you can see more of
// the list" — the earlier pass trimmed the grid's chrome and won back about 180px, but the grid
// itself was the cost. A strip is one row, and it sits in the hero rather than adding a card, so
// the list now starts near the top of the body instead of halfway down the screen.
//
// Dots are a single translucent WHITE, not the semantic type colours the grid used. On purple,
// dark purple / green / teal dots are all but invisible; white carries "something happens that
// day", and the row tints in the list below carry what kind of thing it is. The legend went with
// them — it existed to decode the grid's colours, and there is nothing left for it to decode.
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Monday of the week containing `dateStr`. JS weeks start Sunday, ours start Monday.
function mondayOf(dateStr) {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function weekDays(mondayDate) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mondayDate.getFullYear(), mondayDate.getMonth(), mondayDate.getDate() + i);
    return { date: localDateStr(d), day: d.getDate(), month: d.getMonth(), year: d.getFullYear() };
  });
}

// A week can straddle two months, and two years. Say so rather than picking one and being wrong
// for three days of every crossing week.
function weekLabel(days) {
  const a = days[0];
  const b = days[6];
  if (a.year !== b.year) return `${MON_SHORT[a.month]} ${a.year} – ${MON_SHORT[b.month]} ${b.year}`;
  if (a.month !== b.month) return `${MON_SHORT[a.month]} – ${MON_SHORT[b.month]} ${a.year}`;
  return `${MONTHS[a.month]} ${a.year}`;
}

function WeekStrip({ monday, eventsByDate, selected, onSelect, onStep }) {
  const days = useMemo(() => weekDays(monday), [monday]);
  const today = todayStr();

  return html`
    <div class="week-strip">
      <div class="week-head">
        <button class="week-nav" aria-label="Previous week" onClick=${() => onStep(-1)}>
          <${IconBack} size=${18} />
        </button>
        <p class="week-title">${weekLabel(days)}</p>
        <button class="week-nav" aria-label="Next week" onClick=${() => onStep(1)}>
          <${IconChevron} size=${18} />
        </button>
      </div>
      <div class="week-days" role="group" aria-label="Week">
        ${days.map((c, i) => {
          const evs = eventsByDate[c.date] || [];
          const label = `${c.day} ${MONTHS[c.month]}${evs.length
            ? `, ${evs.length} event${evs.length > 1 ? 's' : ''}` : ', no events'}`;
          return html`
            <button key=${c.date} class="week-day"
              aria-label=${label} aria-current=${c.date === today ? 'date' : 'false'}
              disabled=${!evs.length}
              onClick=${() => onSelect(c.date, evs)}>
              <span class="week-dow" aria-hidden="true">${['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</span>
              <span class=${`week-num ${c.date === selected ? 'week-num-sel' : ''} ${c.date === today ? 'week-num-today' : ''}`}>
                ${c.day}
              </span>
              <span class="week-dots" aria-hidden="true">
                ${evs.slice(0, 3).map((e) => html`<span key=${e.id} class="week-dot"></span>`)}
              </span>
            </button>
          `;
        })}
      </div>
    </div>
  `;
}

// --- Log leave --------------------------------------------------------------
function LeaveForm({ profileId, onDone }) {
  const [startsOn, setStartsOn] = useState(todayStr());
  const [endsOn, setEndsOn] = useState(todayStr());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    if (!startsOn || !endsOn) { setError('Pick the first and last day you’re away.'); return; }
    // The table has a `check (ends_on >= starts_on)` too; catching it here gives a sentence
    // instead of a constraint violation.
    if (endsOn < startsOn) { setError('The last day needs to be on or after the first day.'); return; }
    setBusy(true);
    setError(null);
    const { data, error: err } = await logLeave({ startsOn, endsOn, note }, profileId);
    setBusy(false);
    if (err) { setError(err.message); return; }
    // A write filtered out by RLS returns no error and no rows. Success is a row coming back,
    // never merely the absence of an error.
    if (!data || data.length === 0) {
      setError("That didn't save — reload and try again.");
      return;
    }
    onDone();
  };

  return html`
    <div class="card form-card">
      <h3 class="form-heading">Log leave</h3>
      <p class="form-hint">
        For a holiday or a stretch away. Every rehearsal in the range will show that you're away,
        so you don't have to mark them one by one.
      </p>
      <div class="form-row">
        <label>First day away<input type="date" value=${startsOn}
          onInput=${(e) => setStartsOn(e.target.value)} /></label>
        <label>Last day away<input type="date" value=${endsOn}
          onInput=${(e) => setEndsOn(e.target.value)} /></label>
      </div>
      <label>
        Note (optional)
        <input type="text" value=${note} onInput=${(e) => setNote(e.target.value)}
          placeholder="e.g. away for work" />
      </label>
      ${error ? html`<p class="absence-error">${error}</p>` : null}
      <div class="form-actions">
        <button class="btn btn-primary" disabled=${busy} onClick=${save}>
          ${busy ? 'Saving…' : 'Log leave'}
        </button>
        <button class="btn btn-outline" disabled=${busy} onClick=${onDone}>Cancel</button>
      </div>
    </div>
  `;
}

// Leave management, kept to exactly what the current policies permit.
//
// "Cancel leave" only appears on a PENDING range, which is precisely when the
// "members cancel own pending away dates" policy allows it — so this isn't a button that works
// sometimes, it's a button that's absent when it wouldn't work. It's kept rather than deferred
// because nothing in the app currently sets status='confirmed', so every range is pending and
// cancellable; without it, a member who mistypes a date range has no way at all to undo it and
// no organiser screen exists to do it for them. That trap is worse than the race where a super
// confirms a range between render and click — and that race is reported explicitly, not swallowed.
//
// `pending` is shown as pending rather than being collapsed into `confirmed`: the two are
// different states in the data and shouldn't be flattened just because the app currently treats
// both as effective for the "You're away" calculation.
function LeaveList({ leave }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const drop = async (row) => {
    setBusyId(row.id);
    setError(null);
    const { data, error: err } = await cancelLeave(row.id);
    setBusyId(null);
    if (err) { setError(err.message); return; }
    // The update policy only permits this `while status = 'pending'`, so a range a super has
    // already confirmed matches zero rows. That has to be said out loud, not swallowed.
    if (!data || data.length === 0) {
      setError("That leave couldn't be cancelled — an organiser may have already confirmed it.");
    }
  };

  if (!leave.length) return null;

  return html`
    <div class="leave-list">
      <p class="eyebrow">Your leave</p>
      <p class="leave-hint">
        Rehearsals in these ranges show that you're away. Leave counts straight away — the
        confirmation note is just for the organisers' records.
      </p>
      ${leave.map((row) => html`
        <div key=${row.id} class="card leave-row">
          <div>
            <p class="leave-range">
              ${formatEventDate(row.starts_on)} – ${formatEventDateLong(row.ends_on)}
            </p>
            ${row.note ? html`<p class="leave-note">${row.note}</p>` : null}
          </div>
          <div class="leave-actions">
            ${row.status === 'pending'
              ? html`
                <span class="leave-pending">Pending confirmation</span>
                <button class="btn-quiet" disabled=${busyId === row.id}
                  onClick=${() => drop(row)}>${busyId === row.id ? 'Saving…' : 'Cancel leave'}</button>
              `
              : html`<span class="event-type-badge badge-in">Confirmed</span>`}
          </div>
        </div>
      `)}
      ${error ? html`<p class="absence-error">${error}</p>` : null}
    </div>
  `;
}

// --- The tab ----------------------------------------------------------------
export function CalendarTab({
  profileId, events, loading, terms, absences, checkins, awayDates, onOpenEvent,
}) {
  const [leaveOpen, setLeaveOpen] = useState(false);
  // Which day the strip highlights. Defaults to today, which is what the design shows.
  const [selected, setSelected] = useState(todayStr());
  // Separate from `selected`: narrowing the list to one day only happens when a day carries more
  // than one event, so highlighting today doesn't hide the rest of the term.
  const [dayFilter, setDayFilter] = useState(null);
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayStr()));
  const [filter, setFilter] = useState('all');

  const currentTerm = useMemo(() => currentTermOf(terms), [terms]);

  // Written out rather than routed through a helper that calls useMemo: hooks inside a nested
  // function only keep a stable order by accident, and the next person to add a conditional
  // there would break it in a way that's miserable to debug.
  const myAbsenceByEvent = useMemo(() => {
    const m = {};
    for (const a of absences) if (a.profile_id === profileId) m[a.rehearsal_id] = a;
    return m;
  }, [absences, profileId]);

  const myCheckinByEvent = useMemo(() => {
    const m = {};
    for (const c of checkins) if (c.profile_id === profileId) m[c.rehearsal_id] = c;
    return m;
  }, [checkins, profileId]);

  const myLeave = useMemo(
    () => awayDates.filter((a) => a.profile_id === profileId && a.status !== 'cancelled'),
    [awayDates, profileId],
  );

  const eventsByDate = useMemo(() => {
    const map = {};
    for (const e of events) (map[e.rehearsal_date] ||= []).push(e);
    return map;
  }, [events]);

  // Tapping a date opens the event when there's only one, which is the common case for a choir
  // rehearsing weekly; with more than one it narrows the list to that day instead.
  const selectDate = (date, evs) => {
    setSelected(date);
    if (evs.length === 1) { onOpenEvent(evs[0]); return; }
    setDayFilter(evs.length > 1 ? date : null);
  };

  const step = (by) => setWeekStart((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + by * 7));

  const FILTERS = [
    ['all', 'All'],
    ['rehearsal', 'Rehearsals'],
    ['performance', 'Performances'],
    ['other', 'Other'],
  ];
  const matchesFilter = (e) => filter === 'all'
    || (filter === 'other' ? !['rehearsal', 'performance'].includes(e.event_type) : e.event_type === filter);

  // The list is UPCOMING, grouped by month — not scoped to the week showing in the strip. That's
  // the division of labour the design implies: the strip is a date jumper, the list is the whole
  // road ahead. Scoping the list to the visible week would put six events on screen at most and
  // make the strip mandatory navigation rather than a shortcut.
  const today = todayStr();
  const groups = useMemo(() => {
    const upcoming = events
      .filter((e) => e.rehearsal_date >= today && matchesFilter(e));
    const out = [];
    for (const e of upcoming) {
      const d = parseLocalDate(e.rehearsal_date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const last = out[out.length - 1];
      if (last && last.key === key) last.events.push(e);
      else out.push({ key, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, events: [e] });
    }
    return out;
  }, [events, today, filter]);

  const dayEvents = dayFilter ? (eventsByDate[dayFilter] || []).filter(matchesFilter) : [];

  // Where a member stands on an event, as a marker in the row's trailing slot. Only rendered when
  // there IS something to say — the default "you're expected" is the whole point of the
  // absence-only model and would be noise on every row. The words live on the detail screen; this
  // is deliberately just a mark, because the row is 358px wide and the title has to fit.
  const stateMark = (e) => {
    if (myCheckinByEvent[e.id]) {
      return html`<span class="rail-mark rail-mark-in" role="img" aria-label="You checked in">
        <${IconCheckCircle} size=${16} /></span>`;
    }
    if (awayRangeFor(e, awayDates, profileId)) {
      return html`<span class="rail-mark rail-mark-off" role="img" aria-label="You're away">
        <${IconMinusCircle} size=${16} /></span>`;
    }
    if (myAbsenceByEvent[e.id]) {
      return html`<span class="rail-mark rail-mark-off" role="img" aria-label="You can't make it">
        <${IconMinusCircle} size=${16} /></span>`;
    }
    return null;
  };

  const row = (e) => html`
    <${RailRow} key=${e.id} event=${e} onOpen=${onOpenEvent}
      trailing=${stateMark(e) || html`<span class="rail-chev"><${IconChevron} size=${14} /></span>`} />
  `;

  return html`
    <div class="tab-content">
      <div class="cal-top">
        <div class="cal-top-head">
          <div>
            <h2 class="cal-title">Calendar</h2>
            ${currentTerm ? html`<p class="cal-term">${currentTerm.name}</p>` : null}
          </div>
          ${leaveOpen ? null : html`
            <button class="btn btn-on-purple btn-sm" onClick=${() => setLeaveOpen(true)}>
              + Log leave
            </button>`}
        </div>
        <${WeekStrip} monday=${weekStart} eventsByDate=${eventsByDate}
          selected=${selected} onSelect=${selectDate} onStep=${step} />
      </div>

      ${leaveOpen
        ? html`<${LeaveForm} profileId=${profileId} onDone=${() => setLeaveOpen(false)} />`
        : null}

      <div class="chips">
        ${FILTERS.map(([key, label]) => html`
          <button key=${key} class="chip ${filter === key ? 'chip-on' : ''}"
            onClick=${() => { setFilter(key); setDayFilter(null); }}>${label}</button>
        `)}
      </div>

      ${loading ? html`<${LoadingState} label="Loading events…" />` : null}

      ${!loading && dayFilter ? html`
        <div class="section-header home-section">
          <h3 class="home-section-title">${formatEventDateLong(dayFilter)}</h3>
          <button class="btn-quiet" onClick=${() => setDayFilter(null)}>Show all</button>
        </div>
        <div class="rail-list">${dayEvents.map(row)}</div>
      ` : null}

      ${!loading && !dayFilter ? html`
        ${groups.length
          ? groups.map((g) => html`
              <div key=${g.key} class="month-group">
                <p class="month-group-title">${g.label}</p>
                <div class="rail-list">${g.events.map(row)}</div>
              </div>
            `)
          : html`<${EmptyState} title="Nothing coming up"
              body=${filter === 'all'
                ? 'New rehearsals and events will appear here as soon as they’re scheduled.'
                : 'Nothing upcoming of this kind. Try another filter.'} />`}
      ` : null}

      <${LeaveList} leave=${myLeave} />
    </div>
  `;
}
