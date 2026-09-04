import { html, useState, todayStr } from './lib.js';
import { supabase } from './supabaseClient.js';

function formatDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const d = new Date();
  d.setHours(+h, +m);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

async function setRsvp(eventId, memberName, status) {
  await supabase.from('social_rsvps').upsert(
    { event_id: eventId, member_name: memberName, status },
    { onConflict: 'event_id,member_name' }
  );
}

function RsvpRow({ event, rsvps, displayName }) {
  const mine = rsvps.find((r) => r.event_id === event.id && r.member_name === displayName);
  const counts = { yes: 0, no: 0, maybe: 0 };
  rsvps.filter((r) => r.event_id === event.id).forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });

  return html`
    <div class="rsvp-row">
      <div class="rsvp-buttons">
        ${['yes', 'maybe', 'no'].map((status) => html`
          <button
            key=${status}
            class=${'rsvp-btn rsvp-' + status + (mine?.status === status ? ' active' : '')}
            onClick=${() => setRsvp(event.id, displayName, status)}
          >${status === 'yes' ? 'Going' : status === 'maybe' ? 'Maybe' : "Can't make it"}</button>
        `)}
      </div>
      <div class="rsvp-counts">${counts.yes} going · ${counts.maybe} maybe · ${counts.no} can't make it</div>
    </div>
  `;
}

function SocialEventForm({ existing, onDone }) {
  const [title, setTitle] = useState(existing?.title || '');
  const [date, setDate] = useState(existing?.event_date || '');
  const [start, setStart] = useState(existing?.start_time || '');
  const [end, setEnd] = useState(existing?.end_time || '');
  const [location, setLocation] = useState(existing?.location || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    setSaving(true);
    const payload = {
      title: title.trim(), event_date: date, start_time: start || null, end_time: end || null,
      location, description,
    };
    if (existing) {
      await supabase.from('social_events').update(payload).eq('id', existing.id);
    } else {
      await supabase.from('social_events').insert(payload);
    }
    setSaving(false);
    onDone();
  };

  return html`
    <form onSubmit=${submit} class="card form-card">
      <label>Title<input type="text" required value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder="e.g. End of Term 3 Trivia Night" /></label>
      <div class="form-row">
        <label>Date<input type="date" required value=${date} onInput=${(e) => setDate(e.target.value)} /></label>
        <label>Start<input type="time" value=${start} onInput=${(e) => setStart(e.target.value)} /></label>
        <label>End<input type="time" value=${end} onInput=${(e) => setEnd(e.target.value)} /></label>
      </div>
      <label>Location<input type="text" value=${location} onInput=${(e) => setLocation(e.target.value)} placeholder="e.g. The Northcote Social Club" /></label>
      <label>Details<textarea value=${description} onInput=${(e) => setDescription(e.target.value)} placeholder="Whatever people need to know — dress code, cost, bring-a-plate, etc." /></label>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" disabled=${saving}>${saving ? 'Saving…' : existing ? 'Save changes' : 'Add event'}</button>
        <button type="button" class="btn btn-outline" onClick=${onDone}>Cancel</button>
      </div>
    </form>
  `;
}

function SocialEventCard({ event, rsvps, displayName, canManage }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return html`<${SocialEventForm} existing=${event} onDone=${() => setEditing(false)} />`;
  }

  const remove = async () => {
    if (!confirm(`Delete "${event.title}"?`)) return;
    await supabase.from('social_events').delete().eq('id', event.id);
  };

  return html`
    <div class="card rehearsal-card">
      <div class="rehearsal-card-header">
        <div>
          <div class="song-title">${event.title}</div>
          <div class="rehearsal-date">${formatDate(event.event_date)}</div>
          <div class="rehearsal-meta">
            ${event.start_time ? formatTime(event.start_time) : ''}${event.end_time ? ' – ' + formatTime(event.end_time) : ''}
            ${event.location ? html` · ${event.location}` : ''}
          </div>
        </div>
        ${canManage ? html`
          <div class="card-admin-actions">
            <button class="btn-icon" onClick=${() => setEditing(true)}>Edit</button>
            <button class="btn-icon" onClick=${remove}>Delete</button>
          </div>
        ` : null}
      </div>
      ${event.description ? html`<p class="rehearsal-focus">${event.description}</p>` : null}
      <${RsvpRow} event=${event} rsvps=${rsvps} displayName=${displayName} />
    </div>
  `;
}

export function Social({ socialEvents, socialRsvps, displayName, canManage }) {
  const [adding, setAdding] = useState(false);
  const today = todayStr();
  const upcoming = socialEvents.filter((e) => e.event_date >= today);
  const past = socialEvents.filter((e) => e.event_date < today).slice().reverse();

  return html`
    <div class="tab-content">
      <div class="section-header">
        <h2>Upcoming social events</h2>
        ${canManage && !adding ? html`<button class="btn btn-primary" onClick=${() => setAdding(true)}>+ Add event</button>` : null}
      </div>
      ${adding ? html`<${SocialEventForm} onDone=${() => setAdding(false)} />` : null}
      ${upcoming.length === 0 ? html`<p class="empty-state">No social events scheduled yet.</p>` : null}
      ${upcoming.map((e) => html`<${SocialEventCard} key=${e.id} event=${e} rsvps=${socialRsvps} displayName=${displayName} canManage=${canManage} />`)}

      ${past.length > 0 ? html`
        <h2 class="section-header-secondary">Past events</h2>
        ${past.map((e) => html`<${SocialEventCard} key=${e.id} event=${e} rsvps=${socialRsvps} displayName=${displayName} canManage=${canManage} />`)}
      ` : null}
    </div>
  `;
}
