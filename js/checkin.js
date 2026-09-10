import { html, useState, useEffect, useMemo } from './lib.js';
import { todayStr } from './lib.js';
import { checkIn, undoCheckIn, clearAbsence } from './store.js';
import { IconCheckCircle } from './icons.js';

// The undo window is a database policy (migration 0003), not a UI rule — this constant only
// decides when to stop *offering* the button, so the two must stay in step. If the policy's
// interval ever changes, change this with it.
const UNDO_WINDOW_MS = 60 * 60 * 1000;

// Check-in only exists on the day, matching the insert policy in migration 0003: a member can't
// check in to next month's concert, and a cancelled event has nothing to arrive at.
export function isCheckInDay(event) {
  return event.rehearsal_date === todayStr() && event.status !== 'cancelled';
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

// ---------------------------------------------------------------------------
// Where you stand on this event — the single source of that answer, so Home and the detail
// screen can't drift apart or say it twice. Inlining the past-date test rather than importing
// isPast() from events.js, which imports from here: a cycle isn't worth one comparison.
//
// "You're expected" is a STATUS, not a button. Under the absence-only model (decision 2) there is
// nothing to confirm — every active member is assumed to be coming — so a button here would
// either do nothing or reintroduce the RSVP that decision deliberately removed. It gets a
// button's visual weight without a button's promise.
// ---------------------------------------------------------------------------
export function AttendanceStatus({ event, myCheckin, myAbsence, myAway }) {
  const past = event.rehearsal_date < todayStr();

  // Order matters. Turning up beats everything, so a check-in wins even over logged leave — you
  // were evidently there. Leave then outranks a one-off absence, because it's the broader
  // statement and the member didn't mark this event individually.
  const state = event.status === 'cancelled'
    ? { text: 'This event has been cancelled.', tone: 'muted' }
    : myCheckin
      ? { text: `You're here${myCheckin.checked_in_at ? ` — checked in at ${timeOfDay(myCheckin.checked_in_at)}` : ''}`, tone: 'good' }
      : myAway
        ? { text: "You're away", tone: 'off' }
        : myAbsence
          ? { text: "You've told us you can't make it.", tone: 'off' }
          : past
            ? { text: 'No check-in was recorded for you.', tone: 'muted' }
            : { text: "You're expected", tone: 'good' };

  return html`
    <p class="att-status att-${state.tone}">
      ${state.tone === 'good'
        ? html`<span class="att-tick"><${IconCheckCircle} size=${18} /></span>`
        : null}
      ${state.text}
    </p>
  `;
}

// ---------------------------------------------------------------------------
// Member self check-in
// ---------------------------------------------------------------------------
export function CheckInPanel({ event, myCheckin, myAbsence, profileId }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const now = useNow();

  if (!isCheckInDay(event)) return null;

  const at = myCheckin?.checked_in_at ? new Date(myCheckin.checked_in_at).getTime() : null;
  const msLeft = at ? UNDO_WINDOW_MS - (now - at) : 0;
  const canUndo = msLeft > 0;

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await fn();
    setBusy(false);
    if (err) { setError(err.message); return; }
    // Same trap as the event mutations: a write filtered out by RLS comes back as no error and no
    // rows, so silence is not success. Insert returns the row; delete returns the deleted row.
    if (!data || (Array.isArray(data) && data.length === 0)) {
      setError("That didn't save — reload and try again.");
    }
  };

  const doCheckIn = () => run(async () => {
    const res = await checkIn(event.id, profileId);
    // Turning up overrides having said you couldn't make it — leaving both rows would have the
    // member simultaneously present and excused. Best-effort: a failure here doesn't undo a
    // successful check-in, and the absence row is only ever advisory.
    if (!res.error && res.data && myAbsence) await clearAbsence(event.id, profileId);
    return res;
  });

  const undoLabel = busy ? 'Saving…' : `Undo (${Math.max(1, Math.round(msLeft / 60000))} min left)`;
  const errorLine = error ? html`<p class="absence-error">${error}</p>` : null;

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

  // Checked in: the status line above already says so, so all that's left is the way out.
  return html`
    <div class="checkin-row">
      ${canUndo ? html`
        <button class="btn-quiet" disabled=${busy}
          onClick=${() => run(() => undoCheckIn(event.id, profileId))}>${undoLabel}</button>
      ` : null}
      ${errorLine}
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
