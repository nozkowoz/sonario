import { html, useState, useMemo, formatEventDateLong } from './lib.js';
import {
  displayNameOf, setSongPart, clearSongPart, uploadRecording, getRecordingUrl,
  saveLyrics, hideLyrics,
} from './store.js';
import { LoadingState, EmptyState, Sheet } from './shell.js';
import {
  IconBack, IconChevron, IconNote2, IconStar, IconMic, IconCheck, IconPlay, IconUpload, IconSearch,
  IconLock, IconLockOpen, IconBulb,
} from './icons.js';
import { PracticeEntryCard, PracticeFlow } from './practice.js';

// Repertoire. Stage 3 (2026-09-13) built the read-only screens against the final Figma design
// (Browse/All Songs toggle, Concert Playlists, Your Library) and the real
// song_collections/song_collection_items schema from migration 0008. Stage 4 (2026-09-13) adds
// editing your own part on a song, via the existing song_assignments RLS (already fully open to
// any active member — no new policy needed).
//
// STILL DELIBERATELY NOT HERE, per the agreed staged build order:
//  - Practice Mode (no engine exists — the Figma's entry card is omitted rather than shown as a
//    dead link; "a nav item leading nowhere is worse than one that isn't there" already governed
//    the decision to keep this whole tab in the nav pre-build, same reasoning applies to one card).
//  - Anything Storage-backed (recordings, upload, playback).
//
// One icon simplification from the Figma: semester collections reuse IconNote2 (already in the
// bottom nav) rather than a separate waveform icon added just for this one card.

// Exported: practice.js's "Your parts" list shows the resolved part's label the same way.
export function partLabelText(key, partLabels) {
  return partLabels.find((p) => p.key === key)?.label || key;
}

// Exported: reused by practice.js's per-song part chooser, which writes through this exact same
// function rather than inventing a second "practice session part" concept.
export function myAssignment(assignments, songId, profileId) {
  return assignments.find(
    (a) => a.song_id === songId && a.profile_id === profileId && !a.archived_at,
  );
}

// Exported: the same collection grouping AllSongs uses, reused by practice.js's song-selection
// screen so both screens group/order songs identically rather than keeping two copies in sync.
export function groupSongsByCollection(collections, collectionItems, songsById) {
  return collections
    .map((c) => ({
      collection: c,
      songs: collectionItems
        .filter((i) => i.collection_id === c.id)
        .sort((a, b) => a.position - b.position)
        .map((i) => songsById[i.song_id])
        .filter(Boolean),
    }))
    .filter((g) => g.songs.length > 0);
}

// A song row's trailing pill: the member's own saved part, or an unmistakably-empty "Set part" —
// never a fabricated default.
function PartPill({ song, assignments, partLabels, profileId }) {
  const mine = myAssignment(assignments, song.id, profileId);
  return mine
    ? html`<span class="event-type-badge">${partLabelText(mine.part_label, partLabels)}</span>`
    : html`<span class="event-type-badge part-pill-empty">Set part</span>`;
}

// Per-part recording coverage: purely derived from `recordings`, no new schema (agreed
// 2026-09-15) — just the four common parts (Sop/Alto/Tenor/Bari), purple once at least one
// recording exists for that part OR one of its numbered subdivisions (an "Alto 1" recording
// counts toward "Alto"), grey otherwise. Renders nothing once part_labels itself hasn't loaded.
function PartTagRow({ song, recordings, partLabels }) {
  const common = partLabels.filter((p) => p.common).sort((a, b) => a.sort_order - b.sort_order);
  if (common.length === 0) return null;
  const recordedKeys = new Set(recordings.filter((r) => r.song_id === song.id).map((r) => r.part_label));
  const hasRecording = (p) => recordedKeys.has(p.key)
    || [...recordedKeys].some((k) => k.startsWith(`${p.key}_`));
  return html`
    <div class="rep-part-tags">
      ${common.map((p) => html`
        <span key=${p.key} class=${`rep-part-tag ${hasRecording(p) ? 'rep-part-tag-on' : ''}`}>${p.label}</span>
      `)}
    </div>
  `;
}

// The whole row opens Song Detail — the canonical screen for a song regardless of where it was
// tapped from (All Songs, a Semester, Classics, a Concert Playlist). Part editing lives inside
// that screen now (Stage 6), not on tap-from-a-list directly.
function SongRow({ song, assignments, partLabels, profileId, recordings, onOpen }) {
  return html`
    <button class="rep-song-row" onClick=${() => onOpen(song)}>
      <span class="rep-song-main">
        <span class="rep-song-title">${song.title}</span>
        <${PartTagRow} song=${song} recordings=${recordings} partLabels=${partLabels} />
      </span>
      <${PartPill} song=${song} assignments=${assignments} partLabels=${partLabels} profileId=${profileId} />
    </button>
  `;
}

// --- The part picker sheet --------------------------------------------------
// Tap-to-select-and-close, no separate Save button — matches the Figma's own picker flow exactly.
// Exported: practice.js's "Choose" step reuses this exact sheet, so a part picked during practice
// setup writes through the same setSongPart/clearSongPart path as everywhere else.
export function PartPickerSheet({ song, currentPartKey, partLabels, saving, error, onPick, onClear, onClose }) {
  const [showMore, setShowMore] = useState(false);
  const assignable = partLabels.filter((p) => p.assignable);
  const common = assignable.filter((p) => p.common);
  const rest = assignable.filter((p) => !p.common);
  const visible = showMore ? assignable : common;

  return html`
    <${Sheet} label=${`Choose your part for ${song.title}`} onClose=${onClose}>
      <h3 class="form-heading">${song.title}</h3>
      <p class="form-hint">Your voice part for this song</p>
      <div class="part-picker-list">
        ${visible.map((p) => html`
          <button key=${p.key} class="part-picker-option" disabled=${saving}
            onClick=${() => onPick(p.key)}>
            <span>${p.label}</span>
            ${p.key === currentPartKey ? html`<${IconCheck} size=${18} />` : null}
          </button>
        `)}
      </div>
      <div class="part-picker-footer">
        ${!showMore && rest.length > 0
          ? html`<button class="btn-quiet" onClick=${() => setShowMore(true)}>More parts</button>`
          : null}
        ${currentPartKey
          ? html`<button class="btn-quiet" disabled=${saving} onClick=${onClear}>No part on this song</button>`
          : null}
      </div>
      ${error ? html`<p class="absence-error">${error}</p>` : null}
    </${Sheet}>
  `;
}

function DetailHead({ title, onBack }) {
  return html`
    <div class="detail-head">
      <button class="icon-btn" aria-label="Back to Repertoire" onClick=${onBack}>
        <${IconBack} size=${20} />
      </button>
      <h2 class="admin-head-title">${title}</h2>
    </div>
  `;
}

// --- Recordings (Stage 6) ----------------------------------------------------
const shortDate = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
function formatShortDate(isoTimestamp) {
  return shortDate.format(new Date(isoTimestamp));
}
function formatDuration(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
// "A_Little_More_Light_Alto.m4a" -> "A Little More Light Alto". A starting point the member can
// edit, never a mandatory value — the filename convention varies per phone/recorder app.
function titleFromFilename(filename) {
  return filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
}

const ALLOWED_MIME = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav'];
const ALLOWED_EXT = ['.mp3', '.m4a', '.wav'];
const MAX_BYTES = 50 * 1024 * 1024;

// Reads a file's duration via a throwaway <audio> element rather than a library — best effort
// only. `duration_seconds` is nullable for exactly this reason: if a browser can't report it,
// leave it unset rather than guess.
function readDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const cleanup = () => URL.revokeObjectURL(url);
    audio.addEventListener('loadedmetadata', () => {
      const d = Number.isFinite(audio.duration) ? audio.duration : null;
      cleanup();
      resolve(d);
    });
    audio.addEventListener('error', () => { cleanup(); resolve(null); });
    audio.src = url;
  });
}

function RecordingRow({ recording, uploaderName }) {
  const [audioUrl, setAudioUrl] = useState(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [playError, setPlayError] = useState(null);

  const play = async () => {
    if (audioUrl || loadingUrl) return;
    setLoadingUrl(true);
    setPlayError(null);
    const { data, error } = await getRecordingUrl(recording.storage_path);
    setLoadingUrl(false);
    if (error || !data?.signedUrl) { setPlayError("Couldn't load this recording — try again."); return; }
    setAudioUrl(data.signedUrl);
  };

  return html`
    <div class="rep-recording-row">
      <button class="rep-play-btn" onClick=${play} disabled=${loadingUrl} aria-label=${`Play ${recording.title || 'recording'}`}>
        <${IconPlay} size=${16} />
      </button>
      <div class="rep-recording-body">
        <p class="rep-recording-title">${recording.title || 'Untitled recording'}</p>
        <p class="form-hint" style="margin:0;">
          ${uploaderName || 'Someone'} · ${formatShortDate(recording.uploaded_at)}${recording.duration_seconds ? ` · ${formatDuration(recording.duration_seconds)}` : ''}
        </p>
        ${audioUrl ? html`<audio controls autoplay src=${audioUrl} style="width:100%;margin-top:8px;" />` : null}
        ${playError ? html`<p class="absence-error">${playError}</p>` : null}
      </div>
    </div>
  `;
}

// The upload flow: choose a part (all 11 labels, including Full choir — recordings allow it even
// though a person can never BE Full choir on song_assignments) -> see what's already there for
// that part, so uploading a fourth Alto recording is a deliberate choice, not an accident ->
// choose a file -> an editable, filename-derived title -> upload.
//
// Always opened for a fixed song (Song Detail -> Recordings -> + Add a recording) — Stage 2 of
// the Song Detail redesign moved the header's own upload shortcut to Search instead, so the
// "which song?" first step this used to have when opened songless no longer has a caller. Removed
// rather than kept dead, per the same reasoning as everywhere else unused code gets cut here.
function AddRecordingSheet({ song, partLabels, recordings, profile, directory, onDone, onClose, onRecordingSaved }) {
  const [step, setStep] = useState('part'); // 'part' | 'upload' | 'success'
  const [partLabel, setPartLabel] = useState(null);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [uploaded, setUploaded] = useState(null);

  const partsSorted = useMemo(() => [...partLabels].sort((a, b) => a.sort_order - b.sort_order), [partLabels]);
  const songRecordings = recordings.filter((r) => r.song_id === song.id);
  const existingForPart = partLabel
    ? songRecordings.filter((r) => r.part_label === partLabel).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
    : [];

  const pickPart = (key) => { setPartLabel(key); setStep('upload'); };

  const pickFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    // iOS (Voice Memos exports in particular) sometimes hands back an empty or unrecognised MIME
    // type for an otherwise perfectly valid file — fall back to the extension rather than reject
    // a real recording just because the browser didn't label it the way we expected.
    const hasAllowedExt = ALLOWED_EXT.some((ext) => f.name.toLowerCase().endsWith(ext));
    if (!ALLOWED_MIME.includes(f.type) && !hasAllowedExt) {
      setError('That file type isn\'t supported — use MP3, M4A or WAV.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setError('That file is over the 50MB limit.');
      return;
    }
    setFile(f);
    setTitle(titleFromFilename(f.name));
    setDuration(await readDuration(f));
  };

  const upload = async () => {
    setUploading(true);
    setError(null);
    const { data, error: err } = await uploadRecording({
      songId: song.id, partLabel, profileId: profile.id, file, title, durationSeconds: duration,
    });
    setUploading(false);
    if (err) { setError(err.message); return; }
    // Same realtime-round-trip gap as everywhere else — the song's own recording list/tags
    // shouldn't wait on the subscription to show what was just uploaded. 2026-09-15.
    onRecordingSaved?.(data[0]);
    setUploaded(data[0]);
    setStep('success');
  };

  const uploadAnother = () => {
    setFile(null); setTitle(''); setDuration(null); setUploaded(null); setPartLabel(null);
    setStep('part');
  };

  return html`
    <${Sheet} label="Add a recording" onClose=${onClose}>
      <h3 class="form-heading">Add a recording</h3>
      <p class="form-hint">${song.title}</p>

      ${step === 'part' ? html`
        <div class="part-picker-list" style="margin-top:12px;">
          ${partsSorted.map((p) => html`
            <button key=${p.key} class="part-picker-option" onClick=${() => pickPart(p.key)}>
              <span>${p.label}</span>
            </button>
          `)}
        </div>
      ` : null}

      ${step === 'upload' ? html`
        <div style="margin-top:12px;">
          <p class="form-hint" style="margin:0 0 10px;">
            Part: <strong>${partLabelText(partLabel, partLabels)}</strong>
            — <button class="btn-quiet" style="padding:0;" onClick=${() => setStep('part')}>Change</button>
          </p>

          ${existingForPart.length > 0 ? html`
            <p class="eyebrow eyebrow-tight">Existing ${partLabelText(partLabel, partLabels)} recordings (${existingForPart.length})</p>
            <div class="rep-song-list" style="margin-bottom:14px;">
              ${existingForPart.map((r) => html`<${RecordingRow} key=${r.id} recording=${r}
                uploaderName=${r.uploaded_by === profile.id ? 'You' : displayNameOf(directory[r.uploaded_by])} />`)}
            </div>
            <p class="form-hint" style="margin:-4px 0 14px;">You can still upload a new recording even if one already exists.</p>
          ` : null}

          <label>
            Audio file
            <input type="file" accept="audio/*"
              onChange=${pickFile} />
          </label>
          <p class="form-hint" style="margin:4px 0 14px;">MP3, M4A or WAV, up to 50MB.</p>

          ${file ? html`
            <label>
              Title
              <input type="text" value=${title} maxlength="120"
                onInput=${(e) => setTitle(e.target.value)} placeholder="Optional" />
            </label>
          ` : null}

          ${error ? html`<p class="absence-error">${error}</p>` : null}

          <div class="form-actions" style="margin-top:14px;">
            <button class="btn btn-primary" disabled=${!file || uploading} onClick=${upload}>
              ${uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
      ` : null}

      ${step === 'success' ? html`
        <div style="margin-top:12px;">
          <p class="form-saved" style="font-size:15px;">Recording uploaded.</p>
          <p class="form-hint">
            Your ${partLabelText(uploaded.part_label, partLabels)} recording has been added to ${song.title}.
          </p>
          <div class="form-actions" style="margin-top:10px;">
            <button class="btn btn-primary" onClick=${onDone}>Done</button>
            <button class="btn btn-outline" onClick=${uploadAnother}>Upload another</button>
          </div>
        </div>
      ` : null}
    </${Sheet}>
  `;
}

// --- Lyrics tab (Stage 2 of the Song Detail redesign, migration 0011) -------
// Member view: nothing until released_at is set, then the plain text. Super view: always the
// editable draft (released or not — a super can still fix a typo in already-released lyrics),
// plus Release/Hide. updated_by/released_by are never sent from here — the server trigger derives
// both, so there's nothing for this component to get right or wrong about who gets credited.
function LyricsTab({ song, lyricsRow, canManage, onSave, onRelease, onHide }) {
  const [text, setText] = useState(lyricsRow?.lyrics || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const released = !!lyricsRow?.released_at;

  const run = async (action) => {
    setBusy(true); setError(null); setSaved(false);
    const { data, error: err } = await action();
    setBusy(false);
    if (err) { setError(err.message); return; }
    // Same recurring trap as everywhere else in this app: a write filtered out by RLS returns no
    // error and no rows — only a returned row proves it landed. Missing this check is exactly
    // what let a genuinely-failed save report "Saved." (2026-09-15).
    if (!data || data.length === 0) { setError("That didn't save — reload and try again."); return; }
    setSaved(true);
  };

  if (!canManage) {
    if (!released) {
      return html`<${EmptyState} title="Lyrics not released yet" body=${`${song.title}'s lyrics haven't been released — check back closer to when it's being sung.`} />`;
    }
    return html`<div class="card"><p class="lyrics-body">${lyricsRow.lyrics}</p></div>`;
  }

  return html`
    <div>
      <div class="card lyrics-card">
        <div class="lyrics-status-row">
          <${released ? IconLockOpen : IconLock} size=${16} />
          <span>${released ? `Released ${formatShortDate(lyricsRow.released_at)} — visible to every member.` : 'Not released — only supers can see this.'}</span>
        </div>
        <div class="lyrics-textarea-wrap">
          <textarea class="lyrics-textarea" rows="12" maxlength="10000" value=${text}
            placeholder="Paste or type the lyrics…"
            onInput=${(e) => { setText(e.target.value); setSaved(false); }} />
          <span class="lyrics-char-count">${text.length.toLocaleString()} / 10,000</span>
        </div>
        ${error ? html`<p class="absence-error">${error}</p>` : null}
        ${saved ? html`<p class="form-saved">Saved.</p>` : null}
        <div class="lyrics-actions">
          <button class="btn btn-outline" disabled=${busy} onClick=${() => run(() => onSave(text))}>Save draft</button>
          ${released
            ? html`<button class="btn btn-outline" disabled=${busy} onClick=${() => run(onHide)}>Hide lyrics</button>`
            : html`<button class="btn btn-primary" disabled=${busy} onClick=${() => run(() => onRelease(text))}>
                <${IconLock} size=${14} /> Release lyrics
              </button>`}
        </div>
        <p class="lyrics-caption">${released ? 'Visible to every member right now.' : 'Visible to all members once released.'}</p>
      </div>

      <div class="lyrics-tip-card">
        <span class="lyrics-tip-icon"><${IconBulb} size=${18} /></span>
        <div>
          <p class="lyrics-tip-title">Tip</p>
          <p class="lyrics-tip-body">You can paste lyrics from a document or type them directly here.</p>
        </div>
      </div>
    </div>
  `;
}

// --- Song Detail — the canonical screen for a song, reached from anywhere ---
// Overview / Lyrics / Recordings tabs, per the approved Song Detail redesign (2026-09-14).
function SongDetail({
  song, collections, collectionItems, assignments, partLabels, recordings, profile, directory,
  canManage, lyricsRow, onSaveLyrics, onReleaseLyrics, onHideLyrics, onRecordingSaved,
  onBack, onEditPart,
}) {
  const [panel, setPanel] = useState('overview'); // 'overview' | 'lyrics' | 'recordings'
  const [addOpen, setAddOpen] = useState(false);

  const myCollections = collections.filter((c) =>
    collectionItems.some((i) => i.collection_id === c.id && i.song_id === song.id));
  const songRecordings = recordings.filter((r) => r.song_id === song.id);
  const mine = myAssignment(assignments, song.id, profile.id);

  const groups = useMemo(() => {
    const byPart = {};
    for (const r of songRecordings) (byPart[r.part_label] ||= []).push(r);
    return partLabels
      .filter((p) => byPart[p.key]?.length)
      .map((p) => ({ part: p, recordings: byPart[p.key].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)) }));
  }, [songRecordings, partLabels]);

  // Prefer the member's own part expanded, if it actually has recordings — otherwise nothing
  // starts open. Recomputed if the song changes; not meant to track later toggling.
  const [expanded, setExpanded] = useState(() => new Set(
    mine && groups.some((g) => g.part.key === mine.part_label) ? [mine.part_label] : [],
  ));
  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return html`
    <div class="tab-content">
      <${DetailHead} title=${song.title} onBack=${onBack} />

      <div class="song-detail-tabs">
        <button class=${`tab-btn ${panel === 'overview' ? 'active' : ''}`} onClick=${() => setPanel('overview')}>Overview</button>
        <button class=${`tab-btn ${panel === 'lyrics' ? 'active' : ''}`} onClick=${() => setPanel('lyrics')}>Lyrics</button>
        <button class=${`tab-btn ${panel === 'recordings' ? 'active' : ''}`} onClick=${() => setPanel('recordings')}>Recordings</button>
      </div>

      ${panel === 'overview' ? html`
        <div>
          ${song.composer ? html`<p class="form-hint" style="margin:0 0 12px;">${song.composer}</p>` : null}
          ${myCollections.length > 0 ? html`
            <div style="margin-bottom:16px;">
              ${myCollections.map((c) => html`<span key=${c.id} class="event-type-badge" style="margin-right:6px;">${c.name}</span>`)}
            </div>
          ` : null}
          <button class="card rep-song-row" onClick=${() => onEditPart(song)}>
            <span class="rep-song-title">Your part</span>
            <${PartPill} song=${song} assignments=${assignments} partLabels=${partLabels} profileId=${profile.id} />
          </button>
        </div>
      ` : null}

      ${panel === 'lyrics' ? html`<${LyricsTab}
        song=${song} lyricsRow=${lyricsRow} canManage=${canManage}
        onSave=${onSaveLyrics} onRelease=${onReleaseLyrics} onHide=${onHideLyrics} />` : null}

      ${panel === 'recordings' ? html`
        <div>
          <button class="btn btn-primary" style="width:100%;margin-bottom:22px;" onClick=${() => setAddOpen(true)}>
            <${IconUpload} size=${16} /> Add a recording
          </button>

          ${groups.length === 0
            ? html`<${EmptyState} title="No recordings yet" body="Nobody's uploaded a recording for this song yet." />`
            : groups.map(({ part, recordings: rs }) => html`
                <div key=${part.key} class="rep-recording-group">
                  <button class="rep-group-head" onClick=${() => toggle(part.key)}>
                    <span>${part.label} (${rs.length})</span>
                    <span class=${expanded.has(part.key) ? 'rep-group-chevron rep-group-chevron-open' : 'rep-group-chevron'}>
                      <${IconChevron} size=${14} />
                    </span>
                  </button>
                  ${expanded.has(part.key) ? html`
                    <div class="rep-song-list">
                      ${rs.map((r) => html`<${RecordingRow} key=${r.id} recording=${r}
                        uploaderName=${r.uploaded_by === profile.id ? 'You' : displayNameOf(directory[r.uploaded_by])} />`)}
                    </div>
                  ` : null}
                </div>
              `)}
        </div>
      ` : null}

      ${addOpen ? html`<${AddRecordingSheet}
        song=${song} partLabels=${partLabels} recordings=${recordings}
        profile=${profile} directory=${directory} onRecordingSaved=${onRecordingSaved}
        onDone=${() => setAddOpen(false)} onClose=${() => setAddOpen(false)} />` : null}
    </div>
  `;
}

// --- Collection detail (a Semester folder or Sonario Classics) --------------
function CollectionDetail({ collection, songsById, collectionItems, assignments, partLabels, profileId, recordings, onBack, onOpenSong }) {
  const items = collectionItems
    .filter((i) => i.collection_id === collection.id)
    .sort((a, b) => a.position - b.position)
    .map((i) => songsById[i.song_id])
    .filter(Boolean);

  return html`
    <div class="tab-content">
      <${DetailHead} title=${collection.name} onBack=${onBack} />
      ${items.length === 0
        ? html`<${EmptyState} title="No songs yet" body="Nothing's been added to this collection yet." />`
        : html`<div class="rep-song-list">
            ${items.map((s) => html`<${SongRow} key=${s.id} song=${s}
              assignments=${assignments} partLabels=${partLabels} profileId=${profileId}
              recordings=${recordings} onOpen=${onOpenSong} />`)}
          </div>`}
    </div>
  `;
}

// --- Concert Playlist detail (a performance event's setlist) ---------------
function ConcertDetail({ event, songsById, rehearsalSongs, assignments, partLabels, profileId, recordings, onBack, onOpenSong }) {
  const items = rehearsalSongs
    .filter((rs) => rs.rehearsal_id === event.id)
    .sort((a, b) => a.position - b.position)
    .map((rs) => songsById[rs.song_id])
    .filter(Boolean);

  return html`
    <div class="tab-content">
      <${DetailHead} title=${event.title || 'Concert'} onBack=${onBack} />
      <p class="form-hint" style="margin: -6px 0 16px;">
        ${event.location}${event.location && event.rehearsal_date ? ' · ' : ''}${event.rehearsal_date ? formatEventDateLong(event.rehearsal_date) : ''}
      </p>
      ${items.length === 0
        ? html`<${EmptyState} title="No setlist yet" body="Nothing's been added to this concert's setlist yet." />`
        : html`<div class="rep-song-list">
            ${items.map((s, i) => html`<${SongRow} key=${s.id}
              song=${{ ...s, title: `${i + 1}. ${s.title}` }}
              assignments=${assignments} partLabels=${partLabels} profileId=${profileId}
              recordings=${recordings} onOpen=${() => onOpenSong(s)} />`)}
          </div>`}
    </div>
  `;
}

// --- Browse: Concert Playlists + Your Library -------------------------------
function CollectionCard({ collection, songCount, onOpen }) {
  const Icon = collection.kind === 'classics' ? IconStar : IconNote2;
  return html`
    <button class="card rep-collection-card" onClick=${onOpen}>
      <span class=${`rep-collection-icon ${collection.kind === 'classics' ? 'rep-icon-classics' : 'rep-icon-semester'}`}>
        <${Icon} size=${20} />
      </span>
      <span class="rep-collection-body">
        <span class="rep-collection-name-row">
          <span class="rep-collection-name">${collection.name}</span>
          ${collection.is_current ? html`<span class="event-type-badge event-type-performance">Current</span>` : null}
        </span>
        <span class="form-hint" style="margin:0;">
          ${songCount} ${songCount === 1 ? 'song' : 'songs'}
        </span>
      </span>
      <${IconChevron} size=${16} />
    </button>
  `;
}

function ConcertCard({ event, songCount, onOpen }) {
  return html`
    <button class="card rep-collection-card" onClick=${onOpen}>
      <span class="rep-collection-icon rep-icon-concert"><${IconMic} size=${20} /></span>
      <span class="rep-collection-body">
        <span class="rep-collection-name">${event.title}</span>
        <span class="form-hint" style="margin:0;">${songCount} ${songCount === 1 ? 'song' : 'songs'}</span>
      </span>
      <${IconChevron} size=${16} />
    </button>
  `;
}

function Browse({ collections, collectionItems, events, rehearsalSongs, onOpenCollection, onOpenConcert }) {
  const countFor = (collectionId) => collectionItems.filter((i) => i.collection_id === collectionId).length;

  const concertEvents = useMemo(() => {
    const bySongCount = {};
    for (const rs of rehearsalSongs) bySongCount[rs.rehearsal_id] = (bySongCount[rs.rehearsal_id] || 0) + 1;
    return events
      .filter((e) => e.event_type === 'performance' && bySongCount[e.id] > 0)
      .map((e) => ({ event: e, songCount: bySongCount[e.id] }))
      .sort((a, b) => b.event.rehearsal_date.localeCompare(a.event.rehearsal_date));
  }, [events, rehearsalSongs]);

  return html`
    <div>
      ${concertEvents.length > 0 ? html`
        <p class="eyebrow eyebrow-tight">Concert playlists</p>
        <div class="rep-collection-list" style="margin-bottom: 20px;">
          ${concertEvents.map(({ event, songCount }) => html`
            <${ConcertCard} key=${event.id} event=${event} songCount=${songCount}
              onOpen=${() => onOpenConcert(event)} />
          `)}
        </div>
      ` : null}

      <p class="eyebrow eyebrow-tight">Your library</p>
      <div class="rep-collection-list">
        ${collections.map((c) => html`
          <${CollectionCard} key=${c.id} collection=${c} songCount=${countFor(c.id)}
            onOpen=${() => onOpenCollection(c)} />
        `)}
      </div>
    </div>
  `;
}

// --- All Songs: flat list grouped by collection -----------------------------
function AllSongs({ collections, collectionItems, songsById, assignments, partLabels, profileId, recordings, onOpenSong }) {
  const groups = groupSongsByCollection(collections, collectionItems, songsById);

  if (groups.length === 0) {
    return html`<${EmptyState} title="No songs yet" body="Nothing's in the repertoire yet." />`;
  }

  return html`
    <div>
      ${groups.map(({ collection, songs }) => html`
        <div key=${collection.id} style="margin-bottom: 20px;">
          <p class="eyebrow eyebrow-tight">
            ${collection.name}${collection.is_current ? ' · Current' : ''}
          </p>
          <div class="rep-song-list">
            ${songs.map((s) => html`<${SongRow} key=${s.id} song=${s}
              assignments=${assignments} partLabels=${partLabels} profileId=${profileId}
              recordings=${recordings} onOpen=${onOpenSong} />`)}
          </div>
        </div>
      `)}
    </div>
  `;
}

// --- Search (Stage 2 of the Song Detail redesign) ---------------------------
// v1 scope, agreed 2026-09-14: title + composer/artist only, not lyric text — song_lyrics isn't
// even readable for most of the choir most of the time, so indexing it for search would mean
// search results themselves leak which songs have released lyrics.
function SearchResults({ songs, query, assignments, partLabels, profileId, recordings, onOpenSong }) {
  const q = query.trim().toLowerCase();
  const results = q
    ? songs.filter((s) => s.title.toLowerCase().includes(q) || (s.composer || '').toLowerCase().includes(q))
    : songs;

  if (results.length === 0) {
    return html`<${EmptyState} title="No songs found" body=${`Nothing matches "${query}".`} />`;
  }
  return html`
    <div class="rep-song-list">
      ${results.map((s) => html`<${SongRow} key=${s.id} song=${s}
        assignments=${assignments} partLabels=${partLabels} profileId=${profileId}
        recordings=${recordings} onOpen=${onOpenSong} />`)}
    </div>
  `;
}

// --- The tab -----------------------------------------------------------------
export function RepertoireTab({
  profile, canManage, songs, songsLoading, collections, collectionItems, assignments, partLabels,
  events, rehearsalSongs, recordings, directory, songLyrics, onLyricsSaved,
  onAssignmentSaved, onRecordingSaved,
}) {
  const [mode, setMode] = useState('browse'); // 'browse' | 'all'
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const closeSearch = () => { setSearchOpen(false); setQuery(''); };
  const [detail, setDetail] = useState(null); // { type: 'collection' | 'concert' | 'song', id }
  const openSong = (song) => setDetail({ type: 'song', id: song.id });
  // One picker for the whole tab, same reasoning as app.js's one event Sheet: it works no matter
  // which screen (Browse/All Songs/a collection/a concert) you tapped a song from.
  const [editingSong, setEditingSong] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pickError, setPickError] = useState(null);

  const songsById = useMemo(() => Object.fromEntries(songs.map((s) => [s.id, s])), [songs]);

  const openPicker = (song) => { setEditingSong(song); setPickError(null); };
  const closePicker = () => { if (!saving) { setEditingSong(null); setPickError(null); } };

  const savePart = async (partLabel) => {
    const existing = myAssignment(assignments, editingSong.id, profile.id);
    setSaving(true);
    setPickError(null);
    const { data, error } = await setSongPart(
      { existingAssignmentId: existing?.id, songId: editingSong.id, profileId: profile.id },
      partLabel,
    );
    setSaving(false);
    if (error) { setPickError(error.message); return; }
    // Same recurring trap as everywhere else in this app: a write filtered out by RLS returns no
    // error and no rows. Only a returned row proves it landed.
    if (!data || data.length === 0) { setPickError("That didn't save — reload and try again."); return; }
    // Realtime round trip isn't instant — same "go through everything" pass as check-ins,
    // 2026-09-15 — so patch the shared assignments list directly rather than wait for it.
    onAssignmentSaved?.(data[0]);
    setEditingSong(null);
  };

  const clearPart = async () => {
    const existing = myAssignment(assignments, editingSong.id, profile.id);
    if (!existing) { setEditingSong(null); return; }
    setSaving(true);
    setPickError(null);
    const { data, error } = await clearSongPart(existing.id, profile.id);
    setSaving(false);
    if (error) { setPickError(error.message); return; }
    if (!data || data.length === 0) { setPickError("That didn't save — reload and try again."); return; }
    onAssignmentSaved?.(data[0]);
    setEditingSong(null);
  };

  if (songsLoading) {
    return html`<div class="tab-content"><${LoadingState} label="Loading repertoire…" /></div>`;
  }

  if (practiceOpen) {
    return html`<${PracticeFlow}
      songs=${songs} collections=${collections} collectionItems=${collectionItems}
      assignments=${assignments} partLabels=${partLabels} recordings=${recordings}
      profile=${profile} onClose=${() => setPracticeOpen(false)} onAssignmentSaved=${onAssignmentSaved} />`;
  }

  const picker = editingSong ? html`<${PartPickerSheet}
    song=${editingSong}
    currentPartKey=${myAssignment(assignments, editingSong.id, profile.id)?.part_label ?? null}
    partLabels=${partLabels} saving=${saving} error=${pickError}
    onPick=${savePart} onClear=${clearPart} onClose=${closePicker} />` : null;

  if (detail?.type === 'collection') {
    const collection = collections.find((c) => c.id === detail.id);
    if (collection) {
      return html`
        <${CollectionDetail} collection=${collection} songsById=${songsById}
          collectionItems=${collectionItems} assignments=${assignments} partLabels=${partLabels}
          profileId=${profile.id} recordings=${recordings}
          onBack=${() => setDetail(null)} onOpenSong=${openSong} />
        ${picker}
      `;
    }
  }
  if (detail?.type === 'concert') {
    const event = events.find((e) => e.id === detail.id);
    if (event) {
      return html`
        <${ConcertDetail} event=${event} songsById=${songsById}
          rehearsalSongs=${rehearsalSongs} assignments=${assignments} partLabels=${partLabels}
          profileId=${profile.id} recordings=${recordings}
          onBack=${() => setDetail(null)} onOpenSong=${openSong} />
        ${picker}
      `;
    }
  }
  if (detail?.type === 'song') {
    const song = songsById[detail.id];
    if (song) {
      const lyricsRow = songLyrics.find((l) => l.song_id === song.id) || null;
      // song_lyrics is deliberately outside Realtime (2026-09-14), so a write this client makes
      // never comes back through the postgres_changes subscription — onLyricsSaved patches the
      // local cache directly with the row Supabase just handed back, the same fix as the one Save
      // "went green" bug (2026-09-15) traced to: the write landed, the UI just never heard about it.
      const persistLyrics = async (mutate) => {
        const { data, error } = await mutate();
        if (!error && data?.[0]) onLyricsSaved(data[0]);
        return { data, error };
      };
      return html`
        <${SongDetail} song=${song} collections=${collections} collectionItems=${collectionItems}
          assignments=${assignments} partLabels=${partLabels} recordings=${recordings}
          profile=${profile} directory=${directory}
          canManage=${canManage} lyricsRow=${lyricsRow} onRecordingSaved=${onRecordingSaved}
          onSaveLyrics=${(text) => persistLyrics(() => saveLyrics({ songId: song.id, lyrics: text }))}
          onReleaseLyrics=${(text) => persistLyrics(() => saveLyrics({ songId: song.id, lyrics: text, release: true }))}
          onHideLyrics=${() => persistLyrics(() => hideLyrics(lyricsRow.id))}
          onBack=${() => setDetail(null)} onEditPart=${openPicker} />
        ${picker}
      `;
    }
  }

  return html`
    <div class="tab-content">
      <div class="cal-top">
        <div class="cal-top-head">
          ${searchOpen ? html`
            <div class="rep-search-row">
              <input class="rep-search-input" type="search" autofocus value=${query}
                placeholder="Search by title or composer" onInput=${(e) => setQuery(e.target.value)} />
              <button class="icon-btn-on-purple" aria-label="Close search" onClick=${closeSearch}>
                <span style="font-size:20px;line-height:1;">×</span>
              </button>
            </div>
          ` : html`
            <h2 class="cal-title">Repertoire</h2>
            <button class="icon-btn-on-purple" aria-label="Search repertoire" onClick=${() => setSearchOpen(true)}>
              <${IconSearch} size=${20} />
            </button>
          `}
        </div>
        ${!searchOpen ? html`
          <div class="rep-toggle">
            <button class=${`rep-toggle-btn ${mode === 'browse' ? 'rep-toggle-on' : ''}`}
              onClick=${() => setMode('browse')}>Browse</button>
            <button class=${`rep-toggle-btn ${mode === 'all' ? 'rep-toggle-on' : ''}`}
              onClick=${() => setMode('all')}>All Songs</button>
          </div>
        ` : null}
      </div>

      ${!searchOpen ? html`<${PracticeEntryCard} onOpen=${() => setPracticeOpen(true)} />` : null}

      ${searchOpen
        ? html`<${SearchResults} songs=${songs} query=${query}
            assignments=${assignments} partLabels=${partLabels} profileId=${profile.id}
            recordings=${recordings} onOpenSong=${openSong} />`
        : songs.length === 0
        ? html`<${EmptyState} title="No songs yet" body="Nothing's in the repertoire yet." />`
        : mode === 'browse'
          ? html`<${Browse} collections=${collections} collectionItems=${collectionItems}
              events=${events} rehearsalSongs=${rehearsalSongs}
              onOpenCollection=${(c) => setDetail({ type: 'collection', id: c.id })}
              onOpenConcert=${(e) => setDetail({ type: 'concert', id: e.id })} />`
          : html`<${AllSongs} collections=${collections} collectionItems=${collectionItems}
              songsById=${songsById} assignments=${assignments} partLabels=${partLabels}
              profileId=${profile.id} recordings=${recordings} onOpenSong=${openSong} />`}
      ${picker}
    </div>
  `;
}
