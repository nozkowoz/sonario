import { html, useState, useMemo } from './lib.js';
import { formatEventDate, formatEventDateLong, formatTimeRange, relativeDayLabel, todayStr } from './lib.js';
import { EVENT_TYPES, createEvent, updateEvent, setEventStatus, markAbsent, clearAbsence } from './store.js';
import { LoadingState, EmptyState } from './shell.js';

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
// Event card
// ---------------------------------------------------------------------------
export function EventCard({
  event, term, myAbsence, absencesForEvent = [], canManage, profileId, directory = {},
  onEdit, showRelative = false,
}) {
  const [busy, setBusy] = useState(false);
  const [adminError, setAdminError] = useState(null);
  const cancelled = event.status === 'cancelled';
  const rel = showRelative ? relativeDayLabel(event.rehearsal_date) : '';

  const flip = async (status) => {
    setBusy(true);
    setAdminError(null);
    const { data, error } = await setEventStatus(event.id, status);
    setBusy(false);
    // An RLS-blocked UPDATE isn't an error in Postgres — the row simply falls outside the
    // policy's USING clause and nothing is updated. So "no error and no row back" has to be
    // treated as a failure, or the button would appear to work while changing nothing.
    if (error) setAdminError(error.message);
    else if (!data) setAdminError("That didn't save — check you still have organiser access.");
  };

  return html`
    <div class="card event-card ${cancelled ? 'event-cancelled' : ''}">
      <div class="event-card-header">
        <div>
          <div class="event-title">
            ${eventTitle(event)}
            <span class="event-type-badge event-type-${event.event_type}">${EVENT_TYPE_LABEL[event.event_type]}</span>
            ${cancelled ? html`<span class="event-type-badge event-cancelled-badge">Cancelled</span>` : null}
          </div>
          <div class="event-meta">
            ${formatEventDate(event.rehearsal_date)}
            ${rel ? html` · <span class="event-relative">${rel}</span>` : null}
            ${event.start_time ? html` · ${formatTimeRange(event.start_time, event.end_time)}` : null}
          </div>
          ${event.location ? html`<div class="event-meta">${event.location}</div>` : null}
          ${term ? html`<div class="event-meta event-term">${term.name}</div>` : null}
        </div>
        ${canManage ? html`
          <div class="card-admin-actions">
            <button class="btn-icon" onClick=${() => onEdit(event)}>Edit</button>
            ${cancelled
              ? html`<button class="btn-icon" disabled=${busy} onClick=${() => flip('scheduled')}>Reinstate</button>`
              : html`<button class="btn-icon" disabled=${busy} onClick=${() => flip('cancelled')}>Cancel</button>`}
          </div>
        ` : null}
      </div>

      ${adminError ? html`<p class="absence-error">${adminError}</p>` : null}
      ${event.description ? html`<p class="event-description">${event.description}</p>` : null}
      ${!event.counts_towards_attendance
        ? html`<p class="event-note">Doesn't count towards attendance.</p>`
        : null}

      ${cancelled ? null : html`
        <${AbsenceToggle} event=${event} myAbsence=${myAbsence} profileId=${profileId} />
      `}
      ${canManage
        ? html`<${AbsenceSummary} event=${event} absencesForEvent=${absencesForEvent} directory=${directory} />`
        : null}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Admin event form — create / edit / reschedule. Cancelling is a separate action on the card
// (a status flip), so there's no status field in here.
// ---------------------------------------------------------------------------
const blankEvent = () => ({
  event_type: 'rehearsal',
  title: '',
  description: '',
  rehearsal_date: todayStr(),
  start_time: '19:30',
  end_time: '21:30',
  location: '',
  term_id: '',
  counts_towards_attendance: true,
});

export function EventForm({ event, terms, onDone }) {
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
        <label>Date<input type="date" value=${form.rehearsal_date} onInput=${set('rehearsal_date')} /></label>
        <label>Starts<input type="time" value=${form.start_time} onInput=${set('start_time')} /></label>
        <label>Ends<input type="time" value=${form.end_time} onInput=${set('end_time')} /></label>
      </div>
      <label>
        Location
        <input type="text" value=${form.location} onInput=${set('location')} placeholder="e.g. Church hall" />
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
// Calendar / My Term
// ---------------------------------------------------------------------------
export function CalendarTab({
  profileId, canManage, events, loading, terms, absences, directory,
}) {
  const [editing, setEditing] = useState(null); // null | 'new' | event row

  const termsById = useMemo(() => Object.fromEntries(terms.map((t) => [t.id, t])), [terms]);
  const currentTerm = useMemo(() => currentTermOf(terms), [terms]);

  const myAbsenceByEvent = useMemo(() => {
    const map = {};
    for (const a of absences) if (a.profile_id === profileId) map[a.rehearsal_id] = a;
    return map;
  }, [absences, profileId]);

  // Super only in practice: RLS gives an ordinary member back nothing but their own rows, so
  // for them this map only ever contains themselves — and it's never rendered for them anyway.
  const absencesByEvent = useMemo(() => {
    const map = {};
    for (const a of absences) (map[a.rehearsal_id] ||= []).push(a);
    return map;
  }, [absences]);

  const today = todayStr();
  const upcoming = events.filter((e) => e.rehearsal_date >= today);
  const past = events.filter((e) => e.rehearsal_date < today).slice().reverse();

  const cardProps = (e) => ({
    event: e,
    term: e.term_id ? termsById[e.term_id] : null,
    myAbsence: myAbsenceByEvent[e.id],
    absencesForEvent: absencesByEvent[e.id] || [],
    canManage,
    profileId,
    directory,
    onEdit: setEditing,
  });

  return html`
    <div class="tab-content">
      <div class="section-header">
        <div>
          <h2>${currentTerm ? 'My term' : 'Calendar'}</h2>
          ${currentTerm ? html`
            <p class="term-banner">
              ${currentTerm.name} · ${formatEventDate(currentTerm.starts_on)} – ${formatEventDateLong(currentTerm.ends_on)}
            </p>
          ` : null}
        </div>
        ${canManage && !editing
          ? html`<button class="btn btn-primary btn-sm" onClick=${() => setEditing('new')}>Add event</button>`
          : null}
      </div>

      ${editing ? html`
        <${EventForm}
          event=${editing === 'new' ? null : editing}
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
            : 'Rehearsals, workshops and performances will appear here once they’re scheduled.'}
        />
      ` : null}

      ${!loading && upcoming.length > 0 ? html`
        <h3 class="group-heading">Coming up</h3>
        ${upcoming.map((e) => html`<${EventCard} key=${e.id} ...${cardProps(e)} showRelative=${true} />`)}
      ` : null}

      ${!loading && events.length > 0 && upcoming.length === 0 ? html`
        <${EmptyState} title="Nothing coming up" body="No future events are scheduled yet." />
      ` : null}

      ${!loading && past.length > 0 ? html`
        <h3 class="group-heading">Earlier</h3>
        ${past.map((e) => html`<${EventCard} key=${e.id} ...${cardProps(e)} />`)}
      ` : null}
    </div>
  `;
}
