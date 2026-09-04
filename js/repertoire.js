import { html, useState } from './lib.js';
import { supabase } from './supabaseClient.js';

const STATUS_LABEL = { learning: 'Learning', performance_ready: 'Performance-ready', retired: 'Retired' };
const STATUS_ORDER = ['performance_ready', 'learning', 'retired'];

function SongForm({ existing, onDone }) {
  const [title, setTitle] = useState(existing?.title || '');
  const [composer, setComposer] = useState(existing?.composer || '');
  const [voicing, setVoicing] = useState(existing?.voicing || '');
  const [status, setStatus] = useState(existing?.status || 'learning');
  const [sheetMusicUrl, setSheetMusicUrl] = useState(existing?.sheet_music_url || '');
  const [recordingUrl, setRecordingUrl] = useState(existing?.recording_url || '');
  const [notes, setNotes] = useState(existing?.notes || '');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    const payload = {
      title: title.trim(), composer, voicing, status,
      sheet_music_url: sheetMusicUrl, recording_url: recordingUrl, notes,
    };
    if (existing) {
      await supabase.from('songs').update(payload).eq('id', existing.id);
    } else {
      await supabase.from('songs').insert(payload);
    }
    setSaving(false);
    onDone();
  };

  return html`
    <form onSubmit=${submit} class="card form-card">
      <div class="form-row">
        <label style=${{ flex: 2 }}>Title<input type="text" required value=${title} onInput=${(e) => setTitle(e.target.value)} /></label>
        <label>Composer / arranger<input type="text" value=${composer} onInput=${(e) => setComposer(e.target.value)} /></label>
      </div>
      <div class="form-row">
        <label>Voicing<input type="text" value=${voicing} onInput=${(e) => setVoicing(e.target.value)} placeholder="e.g. SATB" /></label>
        <label>Status
          <select value=${status} onChange=${(e) => setStatus(e.target.value)}>
            ${STATUS_ORDER.map((s) => html`<option key=${s} value=${s}>${STATUS_LABEL[s]}</option>`)}
          </select>
        </label>
      </div>
      <div class="form-row">
        <label>Sheet music link<input type="url" value=${sheetMusicUrl} onInput=${(e) => setSheetMusicUrl(e.target.value)} placeholder="https://…" /></label>
        <label>Recording link<input type="url" value=${recordingUrl} onInput=${(e) => setRecordingUrl(e.target.value)} placeholder="https://…" /></label>
      </div>
      <label>Notes<textarea value=${notes} onInput=${(e) => setNotes(e.target.value)} placeholder="Part-learning notes, tricky bars, etc." /></label>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" disabled=${saving}>${saving ? 'Saving…' : existing ? 'Save changes' : 'Add song'}</button>
        <button type="button" class="btn btn-outline" onClick=${onDone}>Cancel</button>
      </div>
    </form>
  `;
}

function SongCard({ song, canManage }) {
  const [editing, setEditing] = useState(false);
  if (editing) return html`<${SongForm} existing=${song} onDone=${() => setEditing(false)} />`;

  const remove = async () => {
    if (!confirm(`Remove "${song.title}" from the repertoire?`)) return;
    await supabase.from('songs').delete().eq('id', song.id);
  };

  return html`
    <div class="card song-card">
      <div class="song-card-header">
        <div>
          <div class="song-title">${song.title}</div>
          ${song.composer ? html`<div class="song-composer">${song.composer}</div>` : null}
        </div>
        ${canManage ? html`
          <div class="card-admin-actions">
            <button class="btn-icon" onClick=${() => setEditing(true)}>Edit</button>
            <button class="btn-icon" onClick=${remove}>Delete</button>
          </div>
        ` : null}
      </div>
      <div class="song-meta">
        ${song.voicing ? html`<span>${song.voicing}</span>` : null}
        ${song.sheet_music_url ? html`<a href=${song.sheet_music_url} target="_blank" rel="noopener">Sheet music</a>` : null}
        ${song.recording_url ? html`<a href=${song.recording_url} target="_blank" rel="noopener">Recording</a>` : null}
      </div>
      ${song.notes ? html`<p class="song-notes">${song.notes}</p>` : null}
    </div>
  `;
}

export function Repertoire({ songs, canManage }) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('all');

  const filtered = filter === 'all' ? songs : songs.filter((s) => s.status === filter);
  const grouped = STATUS_ORDER.map((s) => ({ status: s, songs: filtered.filter((song) => song.status === s) })).filter((g) => g.songs.length);

  return html`
    <div class="tab-content">
      <div class="section-header">
        <h2>Song repertoire</h2>
        ${canManage && !adding ? html`<button class="btn btn-primary" onClick=${() => setAdding(true)}>+ Add song</button>` : null}
      </div>
      <div class="filter-row">
        <button class=${'filter-btn' + (filter === 'all' ? ' active' : '')} onClick=${() => setFilter('all')}>All (${songs.length})</button>
        ${STATUS_ORDER.map((s) => html`
          <button key=${s} class=${'filter-btn' + (filter === s ? ' active' : '')} onClick=${() => setFilter(s)}>
            ${STATUS_LABEL[s]} (${songs.filter((song) => song.status === s).length})
          </button>
        `)}
      </div>
      ${adding ? html`<${SongForm} onDone=${() => setAdding(false)} />` : null}
      ${filtered.length === 0 ? html`<p class="empty-state">No songs here yet.</p>` : null}
      ${grouped.map((g) => html`
        <div key=${g.status}>
          ${filter === 'all' ? html`<h3 class="group-heading">${STATUS_LABEL[g.status]}</h3>` : null}
          ${g.songs.map((s) => html`<${SongCard} key=${s.id} song=${s} canManage=${canManage} />`)}
        </div>
      `)}
    </div>
  `;
}
