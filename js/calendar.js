import { html, useState, useMemo } from './lib.js';
import { formatEventDate, formatEventDateLong, parseLocalDate, todayStr, localDateStr } from './lib.js';
import { logLeave, cancelLeave, awayRangeFor } from './store.js';
import { EventRow, EventDetail, currentTermOf } from './events.js';
import { LoadingState, EmptyState } from './shell.js';
import { IconChevron, IconBack } from './icons.js';

// The member Calendar, per DESIGN-RULES.md. No Subscribe (removed by rule — add-to-calendar lives
// on the individual event instead), and no RSVP anywhere: members are expected by default and the
// only actions are "Can't make it?" on one event or "Log leave" for a period away.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// The dot colour IS the meaning — see the semantic palette in DESIGN-RULES.md. Cancelled outranks
// type, because "no rehearsal tonight" is the thing you need to see first.
export function eventDotClass(ev) {
  if (ev.status === 'cancelled') return 'dot-cancelled';
  return `dot-${ev.event_type}`;
}

// A month's worth of cells, Monday-first, padded with the neighbouring months' days to complete
// the first and last weeks — and only as many WEEKS as the month actually spans. A fixed six-row
// grid meant most months carried a whole row of nothing but greyed-out next-month days, which
// cost about 55px of a screen where the event list was already being squeezed off the bottom.
function monthCells(year, month) {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;   // JS weeks start Sunday; ours Monday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  const cells = [];
  for (let i = 0; i < weeks * 7; i += 1) {
    const d = new Date(year, month, 1 - lead + i);
    cells.push({ date: localDateStr(d), inMonth: d.getMonth() === month, day: d.getDate() });
  }
  return cells;
}

function MonthGrid({ year, month, eventsByDate, selected, onSelect, onStep }) {
  const cells = useMemo(() => monthCells(year, month), [year, month]);
  const today = todayStr();

  return html`
    <div class="card month-card">
      <div class="month-head">
        <button class="icon-btn" aria-label="Previous month" onClick=${() => onStep(-1)}>
          <${IconBack} size=${20} />
        </button>
        <h3 class="month-title">${MONTHS[month]} ${year}</h3>
        <button class="icon-btn" aria-label="Next month" onClick=${() => onStep(1)}>
          <${IconChevron} size=${20} />
        </button>
      </div>
      <div class="month-dow" aria-hidden="true">
        ${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => html`<span key=${i}>${d}</span>`)}
      </div>
      <div class="month-grid" role="grid">
        ${cells.map((c) => {
          const evs = eventsByDate[c.date] || [];
          const label = `${c.day} ${MONTHS[month]}${evs.length
            ? `, ${evs.length} event${evs.length > 1 ? 's' : ''}` : ', no events'}`;
          return html`
            <button key=${c.date} role="gridcell"
              class="month-cell ${c.inMonth ? '' : 'month-cell-out'} ${c.date === selected ? 'month-cell-sel' : ''} ${c.date === today ? 'month-cell-today' : ''}"
              aria-label=${label} aria-current=${c.date === today ? 'date' : 'false'}
              disabled=${!evs.length && !c.inMonth}
              onClick=${() => onSelect(c.date, evs)}>
              <span class="month-cell-num">${c.day}</span>
              <span class="month-dots">
                ${evs.slice(0, 3).map((e) => html`<span key=${e.id} class="month-dot ${eventDotClass(e)}"></span>`)}
              </span>
            </button>
          `;
        })}
      </div>
      <${Legend} />
    </div>
  `;
}

// The legend earns its place because the dots are the only thing carrying meaning in the grid.
// Tentative is deliberately absent: `rehearsals.status` is scheduled/cancelled only, so nothing
// can be marked TBC yet and a legend entry for it would be describing a state that can't occur.
function Legend() {
  const items = [
    ['dot-rehearsal', 'Rehearsal'],
    ['dot-workshop', 'Workshop'],
    ['dot-performance', 'Performance'],
    ['dot-social', 'Social'],
    ['dot-cancelled', 'Cancelled'],
  ];
  return html`
    <div class="legend">
      ${items.map(([cls, label]) => html`
        <span key=${cls} class="legend-item"><span class="month-dot ${cls}"></span>${label}</span>
      `)}
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
  profileId, canManage, events, loading, terms, absences, checkins, awayDates, directory,
  onManageEvent,
}) {
  const [openId, setOpenId] = useState(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [selected, setSelected] = useState(todayStr());
  const [cursor, setCursor] = useState(() => {
    const d = parseLocalDate(todayStr());
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [filter, setFilter] = useState('all');

  const termsById = useMemo(() => Object.fromEntries(terms.map((t) => [t.id, t])), [terms]);
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

  // Super-only in practice: RLS returns a member only their own rows, so for them these hold
  // just themselves and are never rendered anyway.
  const absencesByEvent = useMemo(() => {
    const m = {};
    for (const a of absences) (m[a.rehearsal_id] ||= []).push(a);
    return m;
  }, [absences]);

  const checkinsByEvent = useMemo(() => {
    const m = {};
    for (const c of checkins) (m[c.rehearsal_id] ||= []).push(c);
    return m;
  }, [checkins]);

  const myLeave = useMemo(
    () => awayDates.filter((a) => a.profile_id === profileId && a.status !== 'cancelled'),
    [awayDates, profileId],
  );

  const eventsByDate = useMemo(() => {
    const map = {};
    for (const e of events) (map[e.rehearsal_date] ||= []).push(e);
    return map;
  }, [events]);

  const openEvent = openId ? events.find((e) => e.id === openId) : null;

  if (openId && openEvent) {
    return html`
      <${EventDetail}
        event=${openEvent}
        term=${openEvent.term_id ? termsById[openEvent.term_id] : null}
        myAbsence=${myAbsenceByEvent[openEvent.id]}
        myCheckin=${myCheckinByEvent[openEvent.id]}
        myAway=${awayRangeFor(openEvent, awayDates, profileId)}
        absencesForEvent=${absencesByEvent[openEvent.id] || []}
        checkinsForEvent=${checkinsByEvent[openEvent.id] || []}
        canManage=${canManage}
        profileId=${profileId}
        directory=${directory}
        onBack=${() => setOpenId(null)}
        onManage=${onManageEvent}
      />
    `;
  }

  // Tapping a date opens the event when there's only one, which is the common case for a choir
  // rehearsing weekly; with more than one it selects the day and the list below narrows to it.
  const selectDate = (date, evs) => {
    if (evs.length === 1) { setOpenId(evs[0].id); return; }
    setSelected(date);
  };

  const step = (by) => setCursor(({ year, month }) => {
    const d = new Date(year, month + by, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const FILTERS = [
    ['all', 'All'],
    ['rehearsal', 'Rehearsals'],
    ['performance', 'Performances'],
    ['other', 'Other'],
  ];
  const matchesFilter = (e) => filter === 'all'
    || (filter === 'other' ? !['rehearsal', 'performance'].includes(e.event_type) : e.event_type === filter);

  const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`;
  const monthEvents = events.filter((e) => e.rehearsal_date.startsWith(monthPrefix) && matchesFilter(e));
  const selectedEvents = (eventsByDate[selected] || []).filter(matchesFilter);
  const listed = selectedEvents.length > 1 ? selectedEvents : monthEvents;

  const rowProps = (e) => ({
    event: e,
    myAbsence: myAbsenceByEvent[e.id],
    myCheckin: myCheckinByEvent[e.id],
    myAway: awayRangeFor(e, awayDates, profileId),
    canManage: false,
    onOpen: (ev) => setOpenId(ev.id),
    onManage: onManageEvent,
  });

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
      </div>

      ${leaveOpen
        ? html`<${LeaveForm} profileId=${profileId} onDone=${() => setLeaveOpen(false)} />`
        : null}

      <${MonthGrid} year=${cursor.year} month=${cursor.month} eventsByDate=${eventsByDate}
        selected=${selected} onSelect=${selectDate} onStep=${step} />

      <div class="chips">
        ${FILTERS.map(([key, label]) => html`
          <button key=${key} class="chip ${filter === key ? 'chip-on' : ''}"
            onClick=${() => setFilter(key)}>${label}</button>
        `)}
      </div>

      ${loading ? html`<${LoadingState} label="Loading events…" />` : null}

      ${!loading ? html`
        <p class="eyebrow">
          ${selectedEvents.length > 1
            ? formatEventDateLong(selected)
            : `${MONTHS[cursor.month]} ${cursor.year}`}
        </p>
        ${listed.length
          ? html`<div class="event-list">
              ${listed.map((e) => html`<${EventRow} key=${e.id} ...${rowProps(e)} showRelative=${true} />`)}
            </div>`
          : html`<${EmptyState} title="Nothing this month"
              body="Use the arrows above to look at another month." />`}
      ` : null}

      <${LeaveList} leave=${myLeave} />
    </div>
  `;
}
