import { html, useState, useEffect, useMemo, useRef } from './lib.js';
import { formatEventDate, formatEventDateLong, formatTimeRange, relativeDayLabel, todayStr,
  formatWeekdayLong, formatDayMonthLong, formatDateRail } from './lib.js';
import { EVENT_TYPES, createEvent, updateEvent, setEventStatus, markAbsent, clearAbsence } from './store.js';
import { LoadingState, EmptyState } from './shell.js';
import { CheckInPanel, AttendanceSummary, isCheckInDay, timeOfDay } from './checkin.js';
import { IconKebab, IconPin, IconBack, IconCheck, IconNote, IconEdit, IconReschedule, IconCancel } from './icons.js';

// The unified event model in product language. `event_type` is purely what kind of thing it is;
// whether it counts towards attendance is a separate, independent flag on the same row (a
// performance might not count, a social might) — the two are never derived from each other.
export const EVENT_TYPE_LABEL = {
  rehearsal: 'Rehearsal',
  workshop: 'Workshop',
  performance: 'Performance',
  social: 'Social',
};

export const eventTitle = (ev) => ev.title || EVENT_TYPE_LABEL[ev.event_type] || 'Event';

const hhmm = (t) => String(t || '').slice(0, 5);

export function isPast(ev) {
  return ev.rehearsal_date < todayStr();
}

export function currentTermOf(terms) {
  const today = todayStr();
  return terms.find((t) => t.starts_on <= today && t.ends_on >= today) || null;
}

// Next thing worth showing on Home: soonest event today or later that hasn't been cancelled.
// `events` arrives already sorted by date then start time from useEvents().
export function nextEvent(events) {
  const today = todayStr();
  return events.find((e) => e.rehearsal_date >= today && e.status !== 'cancelled') || null;
}

// ---------------------------------------------------------------------------
// Absence marking — the entire member-side attendance interaction at this step.
// There is no Going/Maybe/Not-going: everyone is assumed to be coming, and the only action a
// member ever takes is telling the choir they can't make it. Undoing that is deleting the row,
// with no time limit (the one-hour window is a check-in rule, not an absence rule).
// ---------------------------------------------------------------------------
export function AbsenceToggle({ event, myAbsence, profileId }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (event.status === 'cancelled' || isPast(event)) return null;

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    const { error: err } = await fn();
    // Realtime patches the list, so there's nothing to set locally on success — but a failure
    // has to surface rather than looking like it silently worked.
    if (err) setError(err.message);
    setBusy(false);
  };

  return html`
    <div class="absence-row">
      ${myAbsence
        ? html`
          <p class="absence-noted">You've let us know you can't make this one.</p>
          <button class="btn-icon" disabled=${busy}
            onClick=${() => run(() => clearAbsence(event.id, profileId))}>
            ${busy ? 'Saving…' : 'Actually, I can make it'}
          </button>
        `
        : html`
          <button class="btn btn-outline btn-sm" disabled=${busy}
            onClick=${() => run(() => markAbsent(event.id, profileId))}>
            ${busy ? 'Saving…' : "I can't make it"}
          </button>
        `}
      ${error ? html`<p class="absence-error">${error}</p>` : null}
    </div>
  `;
}

// Super-only. Names come from the member_directory() RPC, never a direct `profiles` select:
// profiles is own-row-or-super under RLS, so a direct query would work for a super here but
// break the moment this component is reused anywhere member-facing. One safe path only.
function AbsenceSummary({ event, absencesForEvent, directory }) {
  if (!absencesForEvent.length) {
    // "Nobody has said they can't make it" is useful information about something still to come;
    // on a past or cancelled event it's just noise, so it's only the populated list that shows.
    if (isPast(event) || event.status === 'cancelled') return null;
    return html`<p class="absence-summary">Nobody has said they can't make it.</p>`;
  }
  const names = absencesForEvent
    .map((a) => directory[a.profile_id]?.display_name || 'Unknown member')
    .sort((a, b) => a.localeCompare(b));
  return html`
    <p class="absence-summary">
      <strong>${names.length} can't make it:</strong> ${names.join(', ')}
    </p>
  `;
}

// ---------------------------------------------------------------------------
// Admin actions menu (the mockup's ⋮). Collapsing Edit/Reschedule/Cancel behind one control is
// what lets a list row stay a row — three inline buttons per event is what made the old card tall.
// ---------------------------------------------------------------------------
function KebabMenu({ items, label = 'Event actions' }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // Deferred by a tick: the click that opened the menu is still propagating, and would
    // otherwise close it again immediately.
    const id = setTimeout(() => {
      document.addEventListener('click', close);
      document.addEventListener('keydown', onKey);
    }, 0);
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return html`
    <div class="kebab-wrap" onClick=${(e) => e.stopPropagation()}>
      <button class="icon-btn" aria-label=${label} aria-expanded=${open ? 'true' : 'false'}
        onClick=${() => setOpen((o) => !o)}>
        <${IconKebab} size=${20} />
      </button>
      ${open ? html`
        <div class="kebab-menu" role="menu">
          ${items.map((it) => html`
            <button key=${it.label} class="kebab-item ${it.danger ? 'kebab-item-danger' : ''}"
              role="menuitem" disabled=${it.disabled}
              onClick=${() => { setOpen(false); it.onClick(); }}>
              <${it.Icon} size=${17} />${it.label}
            </button>
          `)}
        </div>
      ` : null}
    </div>
  `;
}

// Shared by the row and the detail screen: cancel/reinstate is a status flip, and an RLS-blocked
// UPDATE returns no error and no rows, so "nothing came back" has to be reported as a failure.
function useStatusFlip(event) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const flip = async (status) => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await setEventStatus(event.id, status);
    setBusy(false);
    if (err) setError(err.message);
    else if (!data) setError("That didn't save — check you still have organiser access.");
  };

  return { busy, error, flip };
}

function adminMenuItems(event, { onEdit, onReschedule, flip, busy }) {
  const cancelled = event.status === 'cancelled';
  return [
    { label: 'Edit', Icon: IconEdit, onClick: () => onEdit(event) },
    { label: 'Reschedule', Icon: IconReschedule, onClick: () => onReschedule(event) },
    cancelled
      ? { label: 'Reinstate', Icon: IconCheck, onClick: () => flip('scheduled'), disabled: busy }
      : { label: 'Cancel', Icon: IconCancel, onClick: () => flip('cancelled'), disabled: busy, danger: true },
  ];
}

// ---------------------------------------------------------------------------
// Event list row — date rail on the left, the essentials in the middle, admin menu on the right.
// Tapping it opens the detail screen; everything that used to be expanded inline lives there now.
// ---------------------------------------------------------------------------
export function EventRow({
  event, myAbsence, myCheckin, canManage, onOpen, onEdit, onReschedule, showRelative = false,
}) {
  const { busy, error, flip } = useStatusFlip(event);
  const cancelled = event.status === 'cancelled';
  const rail = formatDateRail(event.rehearsal_date);
  const rel = showRelative ? relativeDayLabel(event.rehearsal_date) : '';

  return html`
    <div class="event-row ${cancelled ? 'event-row-cancelled' : ''}" role="button" tabindex="0"
      onClick=${() => onOpen(event)}
      onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(event); } }}>
      <div class="date-rail" aria-hidden="true">
        <span class="date-rail-day">${rail.day}</span>
        <span class="date-rail-date">${rail.date}</span>
      </div>
      <div class="event-row-body">
        <div class="event-row-title">${eventTitle(event)}</div>
        <div class="event-row-meta">
          ${event.start_time ? formatTimeRange(event.start_time, event.end_time) : ''}
          ${rel ? html` · <span class="event-relative">${rel}</span>` : null}
        </div>
        ${event.location ? html`<div class="event-row-meta">${event.location}</div>` : null}
        <div class="event-row-tags">
          <span class="event-type-badge event-type-${event.event_type}">${EVENT_TYPE_LABEL[event.event_type]}</span>
          ${cancelled ? html`<span class="event-type-badge event-cancelled-badge">Cancelled</span>` : null}
          ${myCheckin ? html`<span class="event-type-badge badge-in">Checked in</span>` : null}
          ${!myCheckin && myAbsence ? html`<span class="event-type-badge event-type-neutral">Can't make it</span>` : null}
        </div>
        ${error ? html`<p class="absence-error">${error}</p>` : null}
      </div>
      ${canManage
        ? html`<${KebabMenu} items=${adminMenuItems(event, { onEdit, onReschedule, flip, busy })} />`
        : null}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Event detail — the full picture for one event, and the only place the member's own status and
// the organiser's attendance view are shown at length.
// ---------------------------------------------------------------------------
export function EventDetail({
  event, term, myAbsence, myCheckin, absencesForEvent = [], checkinsForEvent = [],
  canManage, profileId, directory = {}, onBack, onEdit, onReschedule,
}) {
  const { busy, error, flip } = useStatusFlip(event);
  const cancelled = event.status === 'cancelled';
  const past = isPast(event);

  const status = cancelled
    ? { text: 'This event has been cancelled.', muted: true }
    : myCheckin
      ? { text: `You're here${myCheckin.checked_in_at ? ` — checked in at ${timeOfDay(myCheckin.checked_in_at)}` : ''}`, tick: true }
      : myAbsence
        ? { text: "You've told us you can't make this one.", muted: true }
        : past
          ? { text: 'No check-in was recorded for you.', muted: true }
          : { text: "You're expected", tick: true };

  return html`
    <div class="tab-content">
      <div class="detail-head">
        <button class="icon-btn" aria-label="Back to calendar" onClick=${onBack}>
          <${IconBack} size=${20} />
        </button>
        <h2 class="detail-title">${formatWeekdayLong(event.rehearsal_date)} ${eventTitle(event)}</h2>
        ${canManage
          ? html`<${KebabMenu} items=${adminMenuItems(event, { onEdit, onReschedule, flip, busy })} />`
          : null}
      </div>

      ${error ? html`<p class="absence-error">${error}</p>` : null}

      <div class="card detail-when">
        <p class="detail-weekday">${formatWeekdayLong(event.rehearsal_date)}</p>
        <p class="detail-date">${formatDayMonthLong(event.rehearsal_date)}</p>
        ${event.start_time
          ? html`<p class="detail-time">${formatTimeRange(event.start_time, event.end_time)}</p>`
          : null}
        ${event.location ? html`
          <p class="detail-loc"><${IconPin} size=${18} />${event.location}</p>
        ` : null}
        <div class="event-row-tags">
          <span class="event-type-badge event-type-${event.event_type}">${EVENT_TYPE_LABEL[event.event_type]}</span>
          ${cancelled ? html`<span class="event-type-badge event-cancelled-badge">Cancelled</span>` : null}
          ${!event.counts_towards_attendance
            ? html`<span class="event-type-badge event-type-neutral">Doesn't count towards attendance</span>`
            : null}
          ${term ? html`<span class="event-type-badge event-type-neutral">${term.name}</span>` : null}
        </div>
      </div>

      <p class="eyebrow">Your status</p>
      <div class="card detail-status">
        <p class="status-line ${status.muted ? 'status-muted' : ''}">
          ${status.tick ? html`<span class="status-tick"><${IconCheck} size=${16} /></span>` : null}
          ${status.text}
        </p>
        ${cancelled ? null : html`
          <${CheckInPanel} event=${event} myCheckin=${myCheckin} myAbsence=${myAbsence} profileId=${profileId} />
          ${myCheckin
            ? null
            : html`<${AbsenceToggle} event=${event} myAbsence=${myAbsence} profileId=${profileId} />`}
        `}
      </div>

      ${event.description ? html`
        <p class="eyebrow">Notes</p>
        <div class="card detail-notes">
          <${IconNote} size=${18} />
          <p>${event.description}</p>
        </div>
      ` : null}

      ${canManage && !cancelled ? html`
        <p class="eyebrow">${past || isCheckInDay(event) ? 'Attendance' : 'Who can\'t make it'}</p>
        <div class="card">
          ${past || isCheckInDay(event)
            ? html`<${AttendanceSummary} checkinsForEvent=${checkinsForEvent}
                absencesForEvent=${absencesForEvent} directory=${directory} />`
            : html`<${AbsenceSummary} event=${event} absencesForEvent=${absencesForEvent} directory=${directory} />`}
        </div>
      ` : null}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Admin event form — create / edit / reschedule. Cancelling is a separate action on the card
// (a status flip), so there's no status field in here.
// ---------------------------------------------------------------------------
// Defaults are the choir's actual pattern — Tuesdays 7-9pm at EASTMINT — because nearly every
// event added by hand is either a rehearsal or something at the same hall. A performance
// elsewhere means clearing two fields; the alternative was retyping them every single time.
const blankEvent = () => ({
  event_type: 'rehearsal',
  title: '',
  description: '',
  rehearsal_date: todayStr(),
  start_time: '19:00',
  end_time: '21:00',
  location: 'EASTMINT, Northcote',
  term_id: '',
  counts_towards_attendance: true,
});

export function EventForm({ event, terms, onDone, focusField = null }) {
  const [form, setForm] = useState(() => (event
    ? {
        event_type: event.event_type,
        title: event.title || '',
        description: event.description || '',
        rehearsal_date: event.rehearsal_date,
        start_time: hhmm(event.start_time),
        end_time: hhmm(event.end_time),
        location: event.location || '',
        term_id: event.term_id || '',
        counts_towards_attendance: event.counts_towards_attendance,
      }
    : blankEvent()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dateRef = useRef(null);

  // "Reschedule" and "Edit" open the same form — the difference the mockup draws between them is
  // where your attention lands, so Reschedule focuses and selects the date rather than being a
  // second, near-identical screen.
  useEffect(() => {
    if (focusField === 'date' && dateRef.current) {
      dateRef.current.focus();
      dateRef.current.select?.();
    }
  }, [focusField]);

  const set = (k) => (e) => setForm((f) => ({
    ...f,
    [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
  }));

  const save = async () => {
    if (!form.rehearsal_date || !form.start_time || !form.end_time) {
      setError('Date, start time and end time are all required.');
      return;
    }
    if (form.end_time <= form.start_time) {
      setError('End time needs to be after the start time.');
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: err } = event ? await updateEvent(event.id, form) : await createEvent(form);
    setBusy(false);
    if (err) { setError(err.message); return; }
    // Same reasoning as the cancel/reinstate guard on EventCard: a write filtered out by RLS
    // comes back as zero rows rather than an error, so don't report success without a row.
    if (!data) { setError("That didn't save — check you still have organiser access."); return; }
    onDone();
  };

  return html`
    <div class="card form-card">
      <h3 class="form-heading">${event ? 'Edit event' : 'New event'}</h3>
      <div class="form-row">
        <label>
          Type
          <select value=${form.event_type} onChange=${set('event_type')}>
            ${EVENT_TYPES.map((t) => html`<option key=${t} value=${t}>${EVENT_TYPE_LABEL[t]}</option>`)}
          </select>
        </label>
        <label>
          Term (optional)
          <select value=${form.term_id} onChange=${set('term_id')}>
            <option value="">No term</option>
            ${terms.map((t) => html`<option key=${t.id} value=${t.id}>${t.name}</option>`)}
          </select>
        </label>
      </div>
      <label>
        Title (optional)
        <input type="text" value=${form.title} onInput=${set('title')}
          placeholder=${EVENT_TYPE_LABEL[form.event_type]} />
      </label>
      <div class="form-row">
        <label>Date<input type="date" ref=${dateRef} value=${form.rehearsal_date} onInput=${set('rehearsal_date')} /></label>
        <label>Starts<input type="time" value=${form.start_time} onInput=${set('start_time')} /></label>
        <label>Ends<input type="time" value=${form.end_time} onInput=${set('end_time')} /></label>
      </div>
      <label>
        Location
        <input type="text" value=${form.location} onInput=${set('location')} placeholder="e.g. EASTMINT, Northcote" />
      </label>
      <label>
        Notes (optional)
        <textarea rows="3" value=${form.description} onInput=${set('description')}
          placeholder="What to bring, what you're working on…"></textarea>
      </label>
      <label class="checkbox-label">
        <input type="checkbox" checked=${form.counts_towards_attendance}
          onChange=${set('counts_towards_attendance')} />
        <span>Counts towards attendance</span>
      </label>
      ${error ? html`<p class="absence-error">${error}</p>` : null}
      <div class="form-actions">
        <button class="btn btn-primary" disabled=${busy} onClick=${save}>
          ${busy ? 'Saving…' : event ? 'Save changes' : 'Add event'}
        </button>
        <button class="btn btn-outline" disabled=${busy} onClick=${onDone}>Cancel</button>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Calendar / My Term — a list of rows, with one event opened at a time as a detail screen.
// ---------------------------------------------------------------------------
export function CalendarTab({
  profileId, canManage, events, loading, terms, absences, checkins, directory,
}) {
  const [editing, setEditing] = useState(null);   // null | { event: null|row, focus: null|'date' }
  const [openId, setOpenId] = useState(null);     // id of the event shown as a detail screen

  const termsById = useMemo(() => Object.fromEntries(terms.map((t) => [t.id, t])), [terms]);
  const currentTerm = useMemo(() => currentTermOf(terms), [terms]);

  const myAbsenceByEvent = useMemo(() => {
    const map = {};
    for (const a of absences) if (a.profile_id === profileId) map[a.rehearsal_id] = a;
    return map;
  }, [absences, profileId]);

  // Super only in practice: RLS gives an ordinary member back nothing but their own rows, so
  // for them these maps only ever contain themselves — and they're never rendered for them anyway.
  const absencesByEvent = useMemo(() => {
    const map = {};
    for (const a of absences) (map[a.rehearsal_id] ||= []).push(a);
    return map;
  }, [absences]);

  const myCheckinByEvent = useMemo(() => {
    const map = {};
    for (const c of checkins) if (c.profile_id === profileId) map[c.rehearsal_id] = c;
    return map;
  }, [checkins, profileId]);

  const checkinsByEvent = useMemo(() => {
    const map = {};
    for (const c of checkins) (map[c.rehearsal_id] ||= []).push(c);
    return map;
  }, [checkins]);

  const openEvent = openId ? events.find((e) => e.id === openId) : null;
  // Opening the form always returns to the list, so there's never a form floating over a detail
  // screen with two different "back" meanings.
  const startEdit = (event, focus = null) => { setOpenId(null); setEditing({ event, focus }); };

  if (openId && openEvent) {
    return html`
      <${EventDetail}
        event=${openEvent}
        term=${openEvent.term_id ? termsById[openEvent.term_id] : null}
        myAbsence=${myAbsenceByEvent[openEvent.id]}
        myCheckin=${myCheckinByEvent[openEvent.id]}
        absencesForEvent=${absencesByEvent[openEvent.id] || []}
        checkinsForEvent=${checkinsByEvent[openEvent.id] || []}
        canManage=${canManage}
        profileId=${profileId}
        directory=${directory}
        onBack=${() => setOpenId(null)}
        onEdit=${(e) => startEdit(e)}
        onReschedule=${(e) => startEdit(e, 'date')}
      />
    `;
  }

  const today = todayStr();
  const upcoming = events.filter((e) => e.rehearsal_date >= today);
  const past = events.filter((e) => e.rehearsal_date < today).slice().reverse();
  const termEventCount = currentTerm
    ? events.filter((e) => e.term_id === currentTerm.id).length
    : 0;

  const rowProps = (e) => ({
    event: e,
    myAbsence: myAbsenceByEvent[e.id],
    myCheckin: myCheckinByEvent[e.id],
    canManage,
    onOpen: (ev) => setOpenId(ev.id),
    onEdit: (ev) => startEdit(ev),
    onReschedule: (ev) => startEdit(ev, 'date'),
  });

  return html`
    <div class="tab-content">
      <div class="section-header">
        <h2>${currentTerm ? 'My term' : 'Calendar'}</h2>
        ${canManage && !editing
          ? html`<button class="btn btn-dark btn-sm" onClick=${() => setEditing({ event: null, focus: null })}>
              + Add event
            </button>`
          : null}
      </div>

      ${currentTerm && !editing ? html`
        <div class="card term-card">
          <p class="eyebrow eyebrow-tight">${currentTerm.name}</p>
          <p class="term-card-range">
            ${formatEventDate(currentTerm.starts_on)} – ${formatEventDateLong(currentTerm.ends_on)}
          </p>
          <p class="term-card-count">
            ${termEventCount} ${termEventCount === 1 ? 'event' : 'events'} this term
          </p>
        </div>
      ` : null}

      ${editing ? html`
        <${EventForm}
          event=${editing.event}
          focusField=${editing.focus}
          terms=${terms}
          onDone=${() => setEditing(null)}
        />
      ` : null}

      ${loading ? html`<${LoadingState} label="Loading events…" />` : null}

      ${!loading && events.length === 0 ? html`
        <${EmptyState}
          title="No events yet"
          body=${canManage
            ? 'Add your first rehearsal, workshop, performance or social and it will show up here.'
            : 'Rehearsals, workshops and performances will appear here once they\u2019re scheduled.'}
        />
      ` : null}

      ${!loading && upcoming.length > 0 ? html`
        <p class="eyebrow">Coming up</p>
        <div class="event-list">
          ${upcoming.map((e) => html`<${EventRow} key=${e.id} ...${rowProps(e)} showRelative=${true} />`)}
        </div>
      ` : null}

      ${!loading && events.length > 0 && upcoming.length === 0 ? html`
        <${EmptyState} title="Nothing coming up" body="No future events are scheduled yet." />
      ` : null}

      ${!loading && past.length > 0 ? html`
        <p class="eyebrow">Earlier</p>
        <div class="event-list">
          ${past.map((e) => html`<${EventRow} key=${e.id} ...${rowProps(e)} />`)}
        </div>
      ` : null}
    </div>
  `;
}
