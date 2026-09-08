import { html, useState, todayStr, localDateStr, checkinTier } from './lib.js';
import { supabase } from './supabaseClient.js';

const TIER_LABEL = { green: 'On time', orange: 'A bit late', red: 'Late' };

function formatDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const d = new Date();
  d.setHours(+h, +m);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

async function setRsvp(rehearsalId, memberName, status) {
  await supabase.from('rehearsal_rsvps').upsert(
    { rehearsal_id: rehearsalId, member_name: memberName, status },
    { onConflict: 'rehearsal_id,member_name' }
  );
}

function RsvpRow({ rehearsal, rsvps, displayName }) {
  const mine = rsvps.find((r) => r.rehearsal_id === rehearsal.id && r.member_name === displayName);
  const counts = { yes: 0, no: 0, maybe: 0 };
  rsvps.filter((r) => r.rehearsal_id === rehearsal.id).forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });

  return html`
    <div class="rsvp-row">
      <div class="rsvp-buttons">
        ${['yes', 'maybe', 'no'].map((status) => html`
          <button
            key=${status}
            class=${'rsvp-btn rsvp-' + status + (mine?.status === status ? ' active' : '')}
            onClick=${() => setRsvp(rehearsal.id, displayName, status)}
          >${status === 'yes' ? 'Going' : status === 'maybe' ? 'Maybe' : "Can't make it"}</button>
        `)}
      </div>
      <div class="rsvp-counts">${counts.yes} going · ${counts.maybe} maybe · ${counts.no} can't make it</div>
    </div>
  `;
}

async function checkIn(rehearsalId, memberName) {
  const { error } = await supabase.from('rehearsal_checkins').insert({ rehearsal_id: rehearsalId, member_name: memberName });
  // A unique-violation here just means "already checked in" — not an error worth surfacing,
  // and importantly not something to retry as an update (that would overwrite the real arrival
  // time with whatever time the second tap happened).
  if (error && error.code !== '23505') throw error;
}

// Only shown on today's rehearsal — check-in isn't meaningful for a future or past one.
function CheckinRow({ rehearsal, checkins, displayName }) {
  if (rehearsal.rehearsal_date !== todayStr()) return null;
  const mine = checkins.find((c) => c.rehearsal_id === rehearsal.id && c.member_name === displayName);
  const others = checkins.filter((c) => c.rehearsal_id === rehearsal.id);

  return html`
    <div class="checkin-row">
      ${mine
        ? html`<span class=${'checkin-badge checkin-' + (checkinTier(rehearsal, mine.checked_in_at) || 'none')}>
            ✓ Checked in ${checkinTier(rehearsal, mine.checked_in_at) ? `— ${TIER_LABEL[checkinTier(rehearsal, mine.checked_in_at)]}` : ''}
          </span>`
        : html`<button class="btn btn-primary" onClick=${() => checkIn(rehearsal.id, displayName)}>I'm here</button>`}
      ${others.length > 0 ? html`
        <div class="checkin-list">
          ${others.map((c) => html`
            <span key=${c.member_name} class=${'checkin-dot checkin-' + (checkinTier(rehearsal, c.checked_in_at) || 'none')}>${c.member_name}</span>
          `)}
        </div>
      ` : null}
    </div>
  `;
}

function RehearsalForm({ existing, onDone }) {
  const [date, setDate] = useState(existing?.rehearsal_date || '');
  const [start, setStart] = useState(existing?.start_time || '');
  const [end, setEnd] = useState(existing?.end_time || '');
  const [location, setLocation] = useState(existing?.location || '');
  const [focus, setFocus] = useState(existing?.focus || '');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!date) return;
    setSaving(true);
    const payload = { rehearsal_date: date, start_time: start || null, end_time: end || null, location, focus };
    if (existing) {
      await supabase.from('rehearsals').update(payload).eq('id', existing.id);
    } else {
      await supabase.from('rehearsals').insert(payload);
    }
    setSaving(false);
    onDone();
  };

  return html`
    <form onSubmit=${submit} class="card form-card">
      <div class="form-row">
        <label>Date<input type="date" required value=${date} onInput=${(e) => setDate(e.target.value)} /></label>
        <label>Start<input type="time" value=${start} onInput=${(e) => setStart(e.target.value)} /></label>
        <label>End<input type="time" value=${end} onInput=${(e) => setEnd(e.target.value)} /></label>
      </div>
      <label>Location<input type="text" value=${location} onInput=${(e) => setLocation(e.target.value)} placeholder="e.g. St Mark's Hall" /></label>
      <label>What's being worked on<textarea value=${focus} onInput=${(e) => setFocus(e.target.value)} placeholder="e.g. Run Ave Maria, start sight-reading the new carol" /></label>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" disabled=${saving}>${saving ? 'Saving…' : existing ? 'Save changes' : 'Add rehearsal'}</button>
        <button type="button" class="btn btn-outline" onClick=${onDone}>Cancel</button>
      </div>
    </form>
  `;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// For a recurring slot (e.g. "every Tuesday 7pm at Eastmint") — run once per school term with
// that term's actual start/end dates. Doesn't know about Victorian school terms or public
// holidays itself (those shift every year); it just fills in every matching weekday in the date
// range you give it, skipping any date a rehearsal already exists for. Delete individual rows
// afterwards for any week you don't actually rehearse (e.g. a mid-term break, a public holiday).
function WeeklyGeneratorForm({ existingRehearsals, onDone }) {
  const today = todayStr();
  const [rangeStart, setRangeStart] = useState(today);
  const [rangeEnd, setRangeEnd] = useState('');
  const [weekday, setWeekday] = useState('2'); // Tuesday
  const [start, setStart] = useState('19:00');
  const [end, setEnd] = useState('21:00');
  const [location, setLocation] = useState('Eastmint, Northcote');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!rangeStart || !rangeEnd) return;
    setSaving(true);
    setResult(null);

    const existingDates = new Set(existingRehearsals.map((r) => r.rehearsal_date));
    const targetDay = Number(weekday);
    const dates = [];
    let d = new Date(`${rangeStart}T00:00:00`);
    const last = new Date(`${rangeEnd}T00:00:00`);
    while (d <= last) {
      if (d.getDay() === targetDay) {
        const iso = localDateStr(d);
        if (!existingDates.has(iso)) dates.push(iso);
      }
      d.setDate(d.getDate() + 1);
    }

    if (dates.length) {
      await supabase.from('rehearsals').insert(
        dates.map((rehearsal_date) => ({
          rehearsal_date, start_time: start || null, end_time: end || null, location, focus: '',
        }))
      );
    }
    setSaving(false);
    setResult({ added: dates.length, skipped: existingRehearsals.length ? existingDates.size : 0 });
  };

  return html`
    <form onSubmit=${submit} class="card form-card">
      <p style=${{ margin: 0, fontSize: '13px', color: 'var(--ink-soft)' }}>
        Fills in every matching weekday between the two dates — handy for a full school term at once.
        Skips any date that already has a rehearsal. Delete individual rows afterwards for breaks or public holidays.
      </p>
      <div class="form-row">
        <label>From<input type="date" required value=${rangeStart} onInput=${(e) => setRangeStart(e.target.value)} /></label>
        <label>To<input type="date" required value=${rangeEnd} onInput=${(e) => setRangeEnd(e.target.value)} /></label>
        <label>Day
          <select value=${weekday} onChange=${(e) => setWeekday(e.target.value)}>
            ${WEEKDAYS.map((w, i) => html`<option key=${i} value=${i}>${w}</option>`)}
          </select>
        </label>
      </div>
      <div class="form-row">
        <label>Start<input type="time" value=${start} onInput=${(e) => setStart(e.target.value)} /></label>
        <label>End<input type="time" value=${end} onInput=${(e) => setEnd(e.target.value)} /></label>
        <label>Location<input type="text" value=${location} onInput=${(e) => setLocation(e.target.value)} /></label>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" disabled=${saving}>${saving ? 'Adding…' : 'Generate rehearsals'}</button>
        <button type="button" class="btn btn-outline" onClick=${onDone}>Close</button>
      </div>
      ${result ? html`<p style=${{ margin: 0, fontSize: '13px', color: 'var(--purple-dark)' }}>Added ${result.added} rehearsal${result.added === 1 ? '' : 's'}.</p>` : null}
    </form>
  `;
}

function RehearsalCard({ rehearsal, rsvps, checkins, displayName, canManage }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return html`<${RehearsalForm} existing=${rehearsal} onDone=${() => setEditing(false)} />`;
  }

  const remove = async () => {
    if (!confirm('Delete this rehearsal?')) return;
    await supabase.from('rehearsals').delete().eq('id', rehearsal.id);
  };

  return html`
    <div class="card rehearsal-card">
      <div class="rehearsal-card-header">
        <div>
          <div class="rehearsal-date">${formatDate(rehearsal.rehearsal_date)}</div>
          <div class="rehearsal-meta">
            ${rehearsal.start_time ? formatTime(rehearsal.start_time) : ''}${rehearsal.end_time ? ' – ' + formatTime(rehearsal.end_time) : ''}
            ${rehearsal.location ? html` · ${rehearsal.location}` : ''}
          </div>
        </div>
        ${canManage ? html`
          <div class="card-admin-actions">
            <button class="btn-icon" onClick=${() => setEditing(true)}>Edit</button>
            <button class="btn-icon" onClick=${remove}>Delete</button>
          </div>
        ` : null}
      </div>
      ${rehearsal.focus ? html`<p class="rehearsal-focus">${rehearsal.focus}</p>` : null}
      <${RsvpRow} rehearsal=${rehearsal} rsvps=${rsvps} displayName=${displayName} />
      <${CheckinRow} rehearsal=${rehearsal} checkins=${checkins} displayName=${displayName} />
    </div>
  `;
}

export function Rehearsals({ rehearsals, rsvps, checkins, displayName, canManage }) {
  const [adding, setAdding] = useState(false);
  const [generating, setGenerating] = useState(false);
  const today = todayStr();
  const upcoming = rehearsals.filter((r) => r.rehearsal_date >= today);
  const past = rehearsals.filter((r) => r.rehearsal_date < today).slice().reverse();

  return html`
    <div class="tab-content">
      <div class="section-header">
        <h2>Upcoming rehearsals</h2>
        ${canManage && !adding && !generating ? html`
          <div style=${{ display: 'flex', gap: '8px' }}>
            <button class="btn btn-outline" onClick=${() => setGenerating(true)}>+ Generate weekly</button>
            <button class="btn btn-primary" onClick=${() => setAdding(true)}>+ Add rehearsal</button>
          </div>
        ` : null}
      </div>
      ${adding ? html`<${RehearsalForm} onDone=${() => setAdding(false)} />` : null}
      ${generating ? html`<${WeeklyGeneratorForm} existingRehearsals=${rehearsals} onDone=${() => setGenerating(false)} />` : null}
      ${upcoming.length === 0 ? html`<p class="empty-state">No rehearsals scheduled yet.</p>` : null}
      ${upcoming.map((r) => html`<${RehearsalCard} key=${r.id} rehearsal=${r} rsvps=${rsvps} checkins=${checkins} displayName=${displayName} canManage=${canManage} />`)}

      ${past.length > 0 ? html`
        <h2 class="section-header-secondary">Past rehearsals</h2>
        ${past.map((r) => html`<${RehearsalCard} key=${r.id} rehearsal=${r} rsvps=${rsvps} checkins=${checkins} displayName=${displayName} canManage=${canManage} />`)}
      ` : null}
    </div>
  `;
}
