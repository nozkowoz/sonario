import { html, useState, useEffect, useMemo } from './lib.js';
import { todayStr, formatEventDate } from './lib.js';
import { checkIn, undoCheckIn, clearAbsence, updateCheckinTime, awayRangeFor, setRsvp, clearRsvp } from './store.js';
import { IconCheckCircle, IconBack } from './icons.js';

// The undo window is a database policy (migration 0003), not a UI rule — this constant only
// decides when to stop *offering* the button, so the two must stay in step. If the policy's
// interval ever changes, change this with it.
const UNDO_WINDOW_MS = 60 * 60 * 1000;

// Check-in only exists on the day, matching the insert policy in migration 0012 (which widened
// this from 0003's 'cancelled'-only exclusion to a positive `status = 'scheduled'` match): a
// member can't check in to next month's concert, and neither a cancelled event nor a public
// holiday that was never scheduled has anything to arrive at.
export function isCheckInDay(event) {
  return event.rehearsal_date === todayStr() && event.status === 'scheduled';
}

// Re-renders on a timer so the Undo button disappears on its own when the hour runs out, rather
// than sitting there until something else happens to re-render and the click fails server-side.
function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Exported so the Home hero can put the arrival time in its own headline block without
// duplicating the formatting (or the 12-hour/am-pm handling) there.
export const timeOfDay = (iso) =>
  new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase();

// For the "Edit time" input — a plain HH:MM in local time, and back. Always anchored to the
// event's own rehearsal_date: editing the arrival TIME only ever makes sense against the day the
// check-in already belongs to, never a different date.
const toTimeInputValue = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const timeInputToIso = (rehearsalDateStr, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(`${rehearsalDateStr}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

// Combines rehearsal_date + end_time (both local, same convention as events.js's eventInstants)
// into a comparable instant. Inlined rather than imported from events.js for the same
// cycle-avoidance reason as the past-date test below — events.js imports from this file.
function eventEndInstant(event) {
  const [y, m, d] = event.rehearsal_date.split('-').map(Number);
  const [eh, em] = String(event.end_time || '23:59').split(':').map(Number);
  return new Date(y, m - 1, d, eh, em).getTime();
}

// ---------------------------------------------------------------------------
// Where you stand on this event — the single source of that answer, so Home and the detail
// screen can't drift apart or say it twice. Inlining the past-date test rather than importing
// isPast() from events.js, which imports from here: a cycle isn't worth one comparison.
//
// "You're coming" (Nina, 2026-09-17, was "You're expected") is a STATUS, not a button. Under the
// absence-only model (decision 2) there is nothing to confirm — every active member is assumed to
// be coming — so a button here would either do nothing or reintroduce the RSVP that decision
// deliberately removed. It gets a button's visual weight without a button's promise.
// ---------------------------------------------------------------------------
// `detailed` adds the design's second line. It exists only on the detail sheet: Home's pill is a
// compact one-liner and a subtitle there would push the hero taller for no new information.
export function AttendanceStatus({ event, myCheckin, myAbsence, myAway, myRsvp, detailed = false }) {
  // Ticks once a minute so "You're here" flips to past tense on its own once the rehearsal ends,
  // rather than sitting there (as Nina found live, past 9pm) until something else forces a
  // re-render. 2026-09-16.
  const now = useNow(60000);
  const past = event.rehearsal_date < todayStr()
    || (event.rehearsal_date === todayStr() && now >= eventEndInstant(event));

  // Order matters. Turning up beats everything, so a check-in wins even over logged leave — you
  // were evidently there. Leave then outranks a one-off absence, because it's the broader
  // statement and the member didn't mark this event individually.
  //
  // Social (migration 0014, Nina 2026-09-15/16): entirely separate ladder, not layered onto the
  // rehearsal one above. A social is opt-in, not compulsory — check-in/away/absence are all about
  // "did you attend a thing you were expected at", which doesn't apply here. RsvpPanel (below)
  // renders the actual Going/Not going/Maybe controls; this only reflects the answer, if any.
  const state = event.status === 'cancelled'
    ? { text: 'This event has been cancelled.', tone: 'muted' }
    : event.status === 'not_scheduled'
    ? { text: 'No rehearsal — public holiday.', tone: 'muted' }
    : event.event_type === 'social'
    ? (myRsvp?.status === 'going'
        ? { text: "You're going", tone: 'good' }
        : myRsvp?.status === 'maybe'
          ? { text: 'You might go', tone: 'off' }
          : myRsvp?.status === 'not_going'
            ? { text: "You're not going", tone: 'off' }
            : { text: 'No RSVP yet', tone: 'muted', sub: "Let us know below" })
    : myCheckin
      ? past
        ? { text: `You were here${myCheckin.checked_in_at ? ` — checked in at ${timeOfDay(myCheckin.checked_in_at)}` : ''}`, tone: 'muted' }
        : { text: `You're here${myCheckin.checked_in_at ? ` — checked in at ${timeOfDay(myCheckin.checked_in_at)}` : ''}`, tone: 'good' }
      : myAway
        // The note the member wrote when logging the leave, so the card says WHY as well as
        // what. Second line rather than appended to the first: "You're away" is the status and
        // "away for work" is their own words, and running them together reads as one sentence
        // the app wrote.
        ? { text: "You're away", tone: 'off', sub: myAway.note || null }
        : myAbsence
          ? { text: "You've told us you can't make it.", tone: 'off' }
          : past
            ? { text: 'No check-in was recorded for you.', tone: 'muted' }
            : { text: "You're coming", tone: 'good', sub: 'See you there!' };

  return html`
    <div class="att-status att-${state.tone}">
      ${state.tone === 'good'
        ? html`<span class="att-tick"><${IconCheckCircle} size=${18} /></span>`
        : null}
      <span class="att-lines">
        <span class="att-text">${state.text}</span>
        ${detailed && state.sub ? html`<span class="att-sub">${state.sub}</span>` : null}
      </span>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Member self check-in
// ---------------------------------------------------------------------------
export function CheckInPanel({ event, myCheckin, myAbsence, profileId, onCheckinSaved, onCheckinRemoved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editingTime, setEditingTime] = useState(false);
  const [timeValue, setTimeValue] = useState('');
  const now = useNow();

  if (!isCheckInDay(event)) return null;

  const at = myCheckin?.checked_in_at ? new Date(myCheckin.checked_in_at).getTime() : null;
  const msLeft = at ? UNDO_WINDOW_MS - (now - at) : 0;
  const canUndo = msLeft > 0;

  // `patch`/`removedId` update the parent's local checkins array the moment this insert/delete
  // has a result, rather than waiting for Realtime's round trip — see useCheckins() in store.js
  // for why that round trip isn't safe to depend on for the button's own feedback.
  const run = async (fn, { patch, removedId } = {}) => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await fn();
    setBusy(false);
    if (err) { setError(err.message); return; }
    // Same trap as the event mutations: a write filtered out by RLS comes back as no error and no
    // rows, so silence is not success. Insert returns the row; delete returns the deleted row.
    if (!data || (Array.isArray(data) && data.length === 0)) {
      setError("That didn't save — reload and try again.");
      return;
    }
    if (patch) onCheckinSaved?.(Array.isArray(data) ? data[0] : data);
    if (removedId) onCheckinRemoved?.(removedId);
    return true;
  };

  const doCheckIn = () => run(async () => {
    const res = await checkIn(event.id, profileId);
    // Turning up overrides having said you couldn't make it — leaving both rows would have the
    // member simultaneously present and excused. Best-effort: a failure here doesn't undo a
    // successful check-in, and the absence row is only ever advisory.
    if (!res.error && res.data && myAbsence) await clearAbsence(event.id, profileId);
    return res;
  }, { patch: true });

  const undoLabel = busy ? 'Saving…' : `Undo (${Math.max(1, Math.round(msLeft / 60000))} min left)`;
  const errorLine = error ? html`<p class="absence-error">${error}</p>` : null;

  const openTimeEdit = () => {
    setTimeValue(myCheckin?.checked_in_at ? toTimeInputValue(myCheckin.checked_in_at) : '');
    setError(null);
    setEditingTime(true);
  };
  const saveTime = async () => {
    if (!timeValue) { setError('Pick a time first.'); return; }
    const ok = await run(
      () => updateCheckinTime(myCheckin.id, timeInputToIso(event.rehearsal_date, timeValue)),
      { patch: true },
    );
    if (ok) setEditingTime(false);
  };

  if (!myCheckin) {
    return html`
      <div class="checkin-row">
        <button class="btn btn-primary btn-sm" disabled=${busy} onClick=${doCheckIn}>
          ${busy ? 'Checking in…' : "I'm here"}
        </button>
        ${errorLine}
      </div>
    `;
  }

  // Checked in: the status line above already says so. What's left is the way out (Undo, still
  // time-windowed — it removes the record) or fixing a forgotten live tap's time (Edit time, no
  // window — Nina, 2026-09-15: "I think we don't need it 'verified'").
  return html`
    <div class="checkin-row">
      ${editingTime ? html`
        <span class="checkin-time-edit">
          <input type="time" value=${timeValue} onInput=${(e) => setTimeValue(e.target.value)} />
          <button class="btn-quiet" disabled=${busy} onClick=${saveTime}>${busy ? 'Saving…' : 'Save'}</button>
          <button class="btn-quiet" disabled=${busy} onClick=${() => setEditingTime(false)}>Cancel</button>
        </span>
      ` : html`
        <button class="btn-quiet" disabled=${busy} onClick=${openTimeEdit}>Edit time</button>
        ${canUndo ? html`
          <button class="btn-quiet" disabled=${busy}
            onClick=${() => run(() => undoCheckIn(event.id, profileId), { removedId: myCheckin.id })}>${undoLabel}</button>
        ` : null}
      `}
      ${errorLine}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Social RSVP (migration 0014). Three buttons, not a toggle: unlike an absence there's a genuine
// third state (Maybe), and unlike check-in there's nothing to arrive AT on the day — an RSVP can
// be given, or changed, any time before or after the event. Entirely replaces CheckInPanel and
// AbsenceToggle for a social — see AttendanceStatus above for why the two ladders don't mix.
// ---------------------------------------------------------------------------
export function SocialRsvpPanel({ event, myRsvp, profileId, onRsvpSaved, onRsvpRemoved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (event.status === 'cancelled' || event.status === 'not_scheduled') return null;

  const choose = async (status) => {
    if (myRsvp?.status === status) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await setRsvp({ rehearsalId: event.id, profileId, status });
    setBusy(false);
    if (err) { setError(err.message); return; }
    if (!data) { setError("That didn't save — reload and try again."); return; }
    onRsvpSaved?.(data);
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await clearRsvp(event.id, profileId);
    setBusy(false);
    if (err) { setError(err.message); return; }
    // Same recurring trap as everywhere else: a delete blocked by RLS returns no error and no
    // rows — only a returned row proves it actually landed.
    if (!data || data.length === 0) { setError("That didn't save — reload and try again."); return; }
    onRsvpRemoved?.(myRsvp.id);
  };

  return html`
    <div class="rsvp-panel">
      <div class="rsvp-options">
        <button class=${`rsvp-btn rsvp-btn-going ${myRsvp?.status === 'going' ? 'rsvp-btn-active' : ''}`}
          disabled=${busy} onClick=${() => choose('going')}>Going</button>
        <button class=${`rsvp-btn rsvp-btn-maybe ${myRsvp?.status === 'maybe' ? 'rsvp-btn-active' : ''}`}
          disabled=${busy} onClick=${() => choose('maybe')}>Maybe</button>
        <button class=${`rsvp-btn rsvp-btn-not-going ${myRsvp?.status === 'not_going' ? 'rsvp-btn-active' : ''}`}
          disabled=${busy} onClick=${() => choose('not_going')}>Not going</button>
      </div>
      ${myRsvp ? html`<button class="btn-quiet" disabled=${busy} onClick=${clear}>Clear my RSVP</button>` : null}
      ${error ? html`<p class="absence-error">${error}</p>` : null}
    </div>
  `;
}

// Visible to every active member, not just supers (migration 0014's RLS is deliberately choir-wide
// read) — unlike rehearsal attendance, knowing who else is going to a social is the actual point.
export function SocialRsvpSummary({ rsvpsForEvent, directory }) {
  const nameOf = (id) => directory[id]?.display_name || 'Someone';
  const byName = (a, b) => a.localeCompare(b);

  const { going, maybe, notGoing } = useMemo(() => ({
    going: rsvpsForEvent.filter((r) => r.status === 'going').map((r) => nameOf(r.profile_id)).sort(byName),
    maybe: rsvpsForEvent.filter((r) => r.status === 'maybe').map((r) => nameOf(r.profile_id)).sort(byName),
    notGoing: rsvpsForEvent.filter((r) => r.status === 'not_going').map((r) => nameOf(r.profile_id)).sort(byName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rsvpsForEvent, directory]);

  if (!going.length && !maybe.length && !notGoing.length) {
    return html`<p class="form-hint">No one has RSVP'd yet.</p>`;
  }

  return html`
    <div class="attendance-summary">
      ${going.length ? html`
        <p class="attendance-line"><strong>${going.length} going:</strong> ${going.join(', ')}</p>
      ` : null}
      ${maybe.length ? html`
        <p class="attendance-line attendance-excused"><strong>${maybe.length} maybe:</strong> ${maybe.join(', ')}</p>
      ` : null}
      ${notGoing.length ? html`
        <p class="attendance-line attendance-missing"><strong>${notGoing.length} not going:</strong> ${notGoing.join(', ')}</p>
      ` : null}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Super-only attendance view for an event that's happening now or has already happened.
// Names come from member_directory() — `profiles` is own-row-or-super under RLS, so this is the
// one safe path for resolving anyone else's name (HANDOVER.md §3).
// ---------------------------------------------------------------------------
export function AttendanceSummary({ checkinsForEvent, absencesForEvent, directory }) {
  const nameOf = (id) => directory[id]?.display_name || 'Unknown member';
  const byName = (a, b) => a.localeCompare(b);

  const { here, excused, missing } = useMemo(() => {
    const checkedIn = new Set(checkinsForEvent.map((c) => c.profile_id));
    const absent = new Set(absencesForEvent.map((a) => a.profile_id));
    const everyone = Object.keys(directory);
    return {
      here: [...checkedIn].map(nameOf).sort(byName),
      excused: [...absent].filter((id) => !checkedIn.has(id)).map(nameOf).sort(byName),
      // Nobody in the directory is "missing" until the directory has actually loaded — an empty
      // one would otherwise read as a choir of zero rather than as not-loaded-yet.
      missing: everyone.filter((id) => !checkedIn.has(id) && !absent.has(id)).map(nameOf).sort(byName),
    };
  }, [checkinsForEvent, absencesForEvent, directory]);

  return html`
    <div class="attendance-summary">
      <p class="attendance-line">
        <strong>${here.length} checked in${here.length ? ':' : ''}</strong>
        ${here.length ? ` ${here.join(', ')}` : ''}
      </p>
      ${excused.length ? html`
        <p class="attendance-line attendance-excused">
          <strong>${excused.length} said they couldn't make it:</strong> ${excused.join(', ')}
        </p>
      ` : null}
      ${missing.length ? html`
        <p class="attendance-line attendance-missing">
          <strong>${missing.length} not checked in:</strong> ${missing.join(', ')}
        </p>
      ` : null}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Attendance history — every past event that counts towards attendance, most recent first, with
// this member's own status against each one. Opened two ways per Nina, 2026-09-16: tapping "My
// Term" on Home, and its own row in More — one view, not two copies to keep in sync. Reuses the
// same status precedence as AttendanceStatus (checked in > away > absence > nothing recorded),
// but only ever renders the past-tense outcome since every row here is already over.
// ---------------------------------------------------------------------------
export function AttendanceHistoryView({ events, checkins, absences, awayDates, profile, onBack }) {
  const today = todayStr();

  const rows = useMemo(() => events
    .filter((e) => e.counts_towards_attendance && e.status === 'scheduled' && e.rehearsal_date < today)
    .sort((a, b) => b.rehearsal_date.localeCompare(a.rehearsal_date))
    .map((e) => {
      const myCheckin = checkins.find((c) => c.rehearsal_id === e.id && c.profile_id === profile.id);
      const myAbsence = absences.find((a) => a.rehearsal_id === e.id && a.profile_id === profile.id);
      const myAway = awayRangeFor(e, awayDates, profile.id);
      const state = myCheckin
        ? { text: `Checked in${myCheckin.checked_in_at ? ` at ${timeOfDay(myCheckin.checked_in_at)}` : ''}`, tone: 'good' }
        : myAway
          ? { text: 'Away', tone: 'off' }
          : myAbsence
            ? { text: "Said you couldn't make it", tone: 'off' }
            : { text: 'No check-in recorded', tone: 'muted' };
      return { event: e, state };
    }), [events, checkins, absences, awayDates, profile.id, today]);

  return html`
    <div class="tab-content">
      <div class="detail-head">
        <button class="icon-btn" aria-label="Back" onClick=${onBack}>
          <${IconBack} size=${20} />
        </button>
        <h2 class="admin-head-title">Attendance History</h2>
      </div>
      ${!rows.length
        ? html`<p class="form-hint" style="padding:0 4px;">Past rehearsals you've attended will show up here.</p>`
        : html`
          <div class="att-history-list">
            ${rows.map(({ event: e, state }) => html`
              <div key=${e.id} class="att-history-row">
                <span class="att-history-date">${formatEventDate(e.rehearsal_date)}</span>
                <span class="att-status-pill att-${state.tone}">${state.text}</span>
              </div>
            `)}
          </div>
        `}
    </div>
  `;
}
