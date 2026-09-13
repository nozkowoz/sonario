import { html, useState, useMemo, formatEventDateLong } from './lib.js';
import { displayNameOf, setSongPart, clearSongPart } from './store.js';
import { LoadingState, EmptyState, Sheet } from './shell.js';
import { IconBack, IconChevron, IconNote2, IconStar, IconMic, IconCheck } from './icons.js';

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

function partLabelText(key, partLabels) {
  return partLabels.find((p) => p.key === key)?.label || key;
}

function myAssignment(assignments, songId, profileId) {
  return assignments.find(
    (a) => a.song_id === songId && a.profile_id === profileId && !a.archived_at,
  );
}

// A song row's trailing pill: the member's own saved part, or an unmistakably-empty "Set part" —
// never a fabricated default.
function PartPill({ song, assignments, partLabels, profileId }) {
  const mine = myAssignment(assignments, song.id, profileId);
  return mine
    ? html`<span class="event-type-badge">${partLabelText(mine.part_label, partLabels)}</span>`
    : html`<span class="event-type-badge part-pill-empty">Set part</span>`;
}

// The whole row opens the part picker for YOUR OWN part on this song — matching the Figma
// exactly (every "Set part"/pill tap in the design opens "Your voice part for this song").
// song_assignments' RLS allows any active member to edit anyone's part (collaborative editing,
// per the original brief), but no screen anywhere in the approved Figma offers editing someone
// else's — so that capability exists in the database and isn't built as a UI feature yet.
function SongRow({ song, assignments, partLabels, profileId, onEditPart }) {
  return html`
    <button class="rep-song-row" onClick=${() => onEditPart(song)}>
      <span class="rep-song-title">${song.title}</span>
      <${PartPill} song=${song} assignments=${assignments} partLabels=${partLabels} profileId=${profileId} />
    </button>
  `;
}

// --- The part picker sheet --------------------------------------------------
// Tap-to-select-and-close, no separate Save button — matches the Figma's own picker flow exactly.
function PartPickerSheet({ song, currentPartKey, partLabels, saving, error, onPick, onClear, onClose }) {
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

// --- Collection detail (a Semester folder or Sonario Classics) --------------
function CollectionDetail({ collection, songsById, collectionItems, assignments, partLabels, profileId, onBack, onEditPart }) {
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
              assignments=${assignments} partLabels=${partLabels} profileId=${profileId} onEditPart=${onEditPart} />`)}
          </div>`}
    </div>
  `;
}

// --- Concert Playlist detail (a performance event's setlist) ---------------
function ConcertDetail({ event, songsById, rehearsalSongs, assignments, partLabels, profileId, onBack, onEditPart }) {
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
              assignments=${assignments} partLabels=${partLabels} profileId=${profileId} onEditPart=${() => onEditPart(s)} />`)}
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
function AllSongs({ collections, collectionItems, songsById, assignments, partLabels, profileId, onEditPart }) {
  const groups = collections
    .map((c) => ({
      collection: c,
      songs: collectionItems
        .filter((i) => i.collection_id === c.id)
        .sort((a, b) => a.position - b.position)
        .map((i) => songsById[i.song_id])
        .filter(Boolean),
    }))
    .filter((g) => g.songs.length > 0);

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
              assignments=${assignments} partLabels=${partLabels} profileId=${profileId} onEditPart=${onEditPart} />`)}
          </div>
        </div>
      `)}
    </div>
  `;
}

// --- The tab -----------------------------------------------------------------
export function RepertoireTab({
  profile, songs, songsLoading, collections, collectionItems, assignments, partLabels,
  events, rehearsalSongs,
}) {
  const [mode, setMode] = useState('browse'); // 'browse' | 'all'
  const [detail, setDetail] = useState(null); // { type: 'collection' | 'concert', id }
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
    setEditingSong(null);
  };

  if (songsLoading) {
    return html`<div class="tab-content"><${LoadingState} label="Loading repertoire…" /></div>`;
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
          profileId=${profile.id} onBack=${() => setDetail(null)} onEditPart=${openPicker} />
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
          profileId=${profile.id} onBack=${() => setDetail(null)} onEditPart=${openPicker} />
        ${picker}
      `;
    }
  }

  return html`
    <div class="tab-content">
      <div class="cal-top">
        <div class="cal-top-head">
          <h2 class="cal-title">Repertoire</h2>
        </div>
        <div class="rep-toggle">
          <button class=${`rep-toggle-btn ${mode === 'browse' ? 'rep-toggle-on' : ''}`}
            onClick=${() => setMode('browse')}>Browse</button>
          <button class=${`rep-toggle-btn ${mode === 'all' ? 'rep-toggle-on' : ''}`}
            onClick=${() => setMode('all')}>All Songs</button>
        </div>
      </div>

      ${songs.length === 0
        ? html`<${EmptyState} title="No songs yet" body="Nothing's in the repertoire yet." />`
        : mode === 'browse'
          ? html`<${Browse} collections=${collections} collectionItems=${collectionItems}
              events=${events} rehearsalSongs=${rehearsalSongs}
              onOpenCollection=${(c) => setDetail({ type: 'collection', id: c.id })}
              onOpenConcert=${(e) => setDetail({ type: 'concert', id: e.id })} />`
          : html`<${AllSongs} collections=${collections} collectionItems=${collectionItems}
              songsById=${songsById} assignments=${assignments} partLabels=${partLabels}
              profileId=${profile.id} onEditPart=${openPicker} />`}
      ${picker}
    </div>
  `;
}
