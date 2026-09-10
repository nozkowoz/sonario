import { html, useState, useEffect, useMemo, useRef } from './lib.js';
import { formatEventDate, formatEventDateLong, formatTimeRange, relativeDayLabel, todayStr,
  formatWeekdayLong, formatDayMonthLong, formatDateRail } from './lib.js';
import { EVENT_TYPES, createEvent, updateEvent, setEventStatus, markAbsent, clearAbsence } from './store.js';
import { LoadingState, EmptyState } from './shell.js';
import { CHOIR_NAME } from './config.js';
import { CheckInPanel, AttendanceStatus, AttendanceSummary, isCheckInDay } from './checkin.js';
import { IconKebab, IconCheck, IconNote, IconEdit, IconReschedule, IconCancel, IconChevron,
  IconClock, IconExternal, IconPinFilled, IconCalendar } from './icons.js';

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
// The date-rail row. ONE component, used by Home's "Coming up" and by the Calendar list, so a
// change to how an event reads in a list can't land on one screen and miss the other.
//
// The tint is SEMANTIC — it comes from the event's type per DESIGN-RULES.md, and a cancelled
// event overrides its type because "this isn't happening" outranks "this was going to be a
// concert". Nina's Figma painted every non-rehearsal row the same sky blue, which encodes
// rehearsal/not-rehearsal rather than what kind of thing it is; she chose semantic when asked,
// so the palette's own colours are used here and rehearsals keep the Figma's white.
// ---------------------------------------------------------------------------
export const rowTintClass = (ev) => (ev.status === 'cancelled'
  ? 'rail-row-cancelled'
  : ev.event_type === 'rehearsal' ? '' : `rail-row-${ev.event_type}`);

export function RailRow({ event, onOpen = null, trailing = null }) {
  const rail = formatDateRail(event.rehearsal_date);
  const [dayNum, mon] = rail.date.split(' ');
  const Tag = onOpen ? 'button' : 'div';
  return html`
    <${Tag}
      class=${`rail-row ${rowTintClass(event)} ${onOpen ? '' : 'rail-row-static'}`}
      type=${onOpen ? 'button' : null}
      onClick=${onOpen ? () => onOpen(event) : null}>
      <span class="rail-date" aria-hidden="true">
        <span class="rail-dow">${rail.day}</span>
        <span class="rail-num">${dayNum}</span>
        <span class="rail-mon">${mon}</span>
      </span>
      <span class="rail-body">
        <span class="rail-title">${eventTitle(event)}</span>
        ${event.start_time
          ? html`<span class="rail-time">${formatTimeRange(event.start_time, event.end_time)}</span>`
          : null}
        ${event.location ? html`<span class="rail-loc">${event.location}</span>` : null}
      </span>
      ${trailing !== null
        ? trailing
        : onOpen ? html`<span class="rail-chev"><${IconChevron} size=${14} /></span>` : null}
    <//>
  `;
}

// ---------------------------------------------------------------------------
// Absence marking — the entire member-side attendance interaction at this step.
// There is no Going/Maybe/Not-going: everyone is assumed to be coming, and the only action a
// member ever takes is telling the choir they can't make it. Undoing that is deleting the row,
// with no time limit (the one-hour window is a check-in rule, not an absence rule).
// ---------------------------------------------------------------------------
// Deliberately quiet. Being unable to come is the exception, so it reads as a small aside rather
// than the screen's main action — which is what a full-width button made it, especially on a
// future event where check-in isn't offered yet and this was the only control present.
// It's a one-tap flip either way, with no time limit, so a mistap costs nothing.
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
          <button class="btn-quiet" disabled=${busy}
            onClick=${() => run(() => clearAbsence(event.id, profileId))}>
            ${busy ? 'Saving…' : 'Actually, I can make it'}
          </button>
        `
        : html`
          <button class="btn-quiet" disabled=${busy}
            onClick=${() => run(() => markAbsent(event.id, profileId))}>
            ${busy ? 'Saving…' : "Can't make it?"}
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

// --- Add to calendar --------------------------------------------------------
// Per-event, not a whole-calendar subscription: the rules removed the global Subscribe button.
//
// These build an INSTANT from the event's local date and time, so `toISOString()` is correct here
// — the usual warning against it applies to calendar *dates*, where converting to UTC shifts the
// day. A moment in time genuinely wants UTC.
function eventInstants(event) {
  const [y, m, d] = event.rehearsal_date.split('-').map(Number);
  const [sh, sm] = String(event.start_time || '00:00').split(':').map(Number);
  const [eh, em] = String(event.end_time || '00:00').split(':').map(Number);
  const start = new Date(y, m - 1, d, sh, sm);
  let end = new Date(y, m - 1, d, eh, em);
  if (end <= start) end = new Date(start.getTime() + 60 * 60 * 1000);  // guard a bad row
  return { start, end };
}

const utcStamp = (dt) => `${dt.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;

function icsHref(event, term) {
  const { start, end } = eventInstants(event);
  const desc = [event.description, term ? term.name : null].filter(Boolean).join(' — ');
  // CRLF line endings and escaped commas/semicolons: iCalendar is fussy, and Apple Calendar
  // silently rejects a file that gets this wrong rather than telling you why.
  const esc = (t) => String(t || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sonario//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.id}@sonario`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${esc(`${eventTitle(event)} — ${CHOIR_NAME}`)}`,
    `LOCATION:${esc(event.location)}`,
    `DESCRIPTION:${esc(desc)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
}

function googleCalHref(event) {
  const { start, end } = eventInstants(event);
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${eventTitle(event)} — ${CHOIR_NAME}`,
    dates: `${utcStamp(start)}/${utcStamp(end)}`,
    location: event.location || '',
    details: event.description || '',
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
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
  event, myAbsence, myCheckin, myAway, canManage, onOpen, onEdit, onReschedule, onManage,
  showRelative = false,
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
          ${!myCheckin && myAway ? html`<span class="event-type-badge event-type-neutral">You're away</span>` : null}
          ${!myCheckin && !myAway && myAbsence ? html`<span class="event-type-badge event-type-neutral">Can't make it</span>` : null}
        </div>
        ${error ? html`<p class="absence-error">${error}</p>` : null}
      </div>
      ${canManage
        ? html`<${KebabMenu} items=${adminMenuItems(event, { onEdit, onReschedule, flip, busy })} />`
        : onManage
          // Calendar is read-only, but a super shouldn't have to go and find an event again in a
          // second list to change it. One pencil, straight into the admin editor for this event.
          ? html`
            <button class="icon-btn" aria-label=${`Edit ${eventTitle(event)}`}
              onClick=${(e) => { e.stopPropagation(); onManage(event); }}>
              <${IconEdit} size=${19} />
            </button>
          `
          : null}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Event detail — the full picture for one event, and the only place the member's own status and
// the organiser's attendance view are shown at length.
// ---------------------------------------------------------------------------
export function EventDetail({
  event, term, myAbsence, myCheckin, myAway, absencesForEvent = [], checkinsForEvent = [],
  canManage, profileId, directory = {}, onManage,
}) {
  const cancelled = event.status === 'cancelled';
  const past = isPast(event);
  const showAdmin = canManage && !cancelled && (past || isCheckInDay(event) || absencesForEvent.length > 0);

  return html`
    <div class="sheet-detail">
      <p class="sheet-date">${formatEventDateLong(event.rehearsal_date)}</p>

      <div class="sheet-title-row">
        <h2 class="sheet-title">${eventTitle(event)}</h2>
        <div class="sheet-title-actions">
          <span class=${`sheet-type sheet-type-${cancelled ? 'cancelled' : event.event_type}`}>
            <span class="sheet-type-dot" aria-hidden="true"></span>
            ${cancelled ? 'Cancelled' : EVENT_TYPE_LABEL[event.event_type]}
          </span>
          ${canManage && onManage ? html`
            <button class="icon-btn" aria-label="Edit this event" onClick=${() => onManage(event)}>
              <${IconEdit} size=${18} />
            </button>
          ` : null}
        </div>
      </div>

      <div class="sheet-meta">
        ${event.start_time ? html`
          <p class="sheet-meta-line">
            <${IconClock} size=${18} />${formatTimeRange(event.start_time, event.end_time)}
          </p>
        ` : null}
        ${event.location ? html`
          <p class="sheet-meta-line">
            <${IconPinFilled} size=${18} />
            <span class="sheet-meta-text">${event.location}</span>
            <a class="sheet-meta-link" aria-label=${`Find ${event.location} on a map`}
              href=${`https://maps.google.com/?q=${encodeURIComponent(event.location)}`}
              target="_blank" rel="noopener noreferrer"><${IconExternal} size=${14} /></a>
          </p>
        ` : null}
      </div>

      <${AttendanceStatus} event=${event} myCheckin=${myCheckin} myAbsence=${myAbsence}
        myAway=${myAway} detailed=${true} />

      ${cancelled ? null : html`
        <${CheckInPanel} event=${event} myCheckin=${myCheckin} myAbsence=${myAbsence}
          profileId=${profileId} />
      `}

      ${!cancelled ? html`
        <div class="sheet-rule"></div>
        <div class="sheet-section">
          <p class="sheet-section-head"><${IconCalendar} size=${20} />Add to calendar</p>
          <div class="sheet-cal">
            <a class="sheet-cal-btn" href=${icsHref(event, term)}
              download=${`${eventTitle(event).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`}>
              Apple / iCal
            </a>
            <a class="sheet-cal-btn" href=${googleCalHref(event)}
              target="_blank" rel="noopener noreferrer">Google Calendar</a>
          </div>
        </div>
      ` : null}

      ${event.description ? html`
        <div class="sheet-rule"></div>
        <div class="sheet-section sheet-notes">
          <${IconNote} size=${20} />
          <div>
            <p class="sheet-section-head sheet-section-head-plain">Notes</p>
            <p class="sheet-notes-body">${event.description}</p>
          </div>
        </div>
      ` : null}

      ${/* The one action, last and on its own, so "I can't come" is never the thing your thumb
            lands on first.
            Absent once you've checked in — you evidently came. Also absent while you're on
            LEAVE: the two are deliberately different things (one event vs. a period away, see
            DESIGN-RULES.md), and leave already covers this rehearsal, so offering it here would
            invite a second, redundant row saying the same thing. Cancel the leave if it's
            wrong. */
        cancelled || myCheckin || myAway ? null : html`
        <div class="sheet-rule"></div>
        <div class="sheet-action">
          <${AbsenceToggle} event=${event} myAbsence=${myAbsence} profileId=${profileId} />
        </div>
      `}

      ${showAdmin ? html`
        <div class="sheet-rule"></div>
        <div class="sheet-section">
          <p class="sheet-section-head sheet-section-head-plain">
            ${past || isCheckInDay(event) ? 'Attendance' : 'Who can\'t make it'}
          </p>
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
