import { html, useState, useMemo, formatEventDateLong } from './lib.js';
import { displayNameOf } from './store.js';
import { LoadingState, EmptyState } from './shell.js';
import { IconBack, IconChevron, IconNote2, IconStar, IconMic } from './icons.js';

// Repertoire, Stage 3 (2026-09-13) — read-only. Built to the final Figma design (Browse/All Songs
// toggle, Concert Playlists, Your Library), against the real song_collections/song_collection_items
// schema from migration 0008 plus the existing songs/song_assignments/rehearsal_songs tables.
//
// DELIBERATELY NOT HERE YET, per the agreed staged build order:
//  - Practice Mode (no engine exists — the Figma's entry card is omitted rather than shown as a
//    dead link; "a nav item leading nowhere is worse than one that isn't there" already governed
//    the decision to keep this whole tab in the nav pre-build, same reasoning applies to one card).
//  - Editing a part assignment — the pill below is a read-only badge, not a button, this stage.
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
// never a fabricated default. Not a button at this stage — editing is Stage 4.
function PartPill({ song, assignments, partLabels, profileId }) {
  const mine = myAssignment(assignments, song.id, profileId);
  return mine
    ? html`<span class="event-type-badge">${partLabelText(mine.part_label, partLabels)}</span>`
    : html`<span class="event-type-badge part-pill-empty">Set part</span>`;
}

function SongRow({ song, assignments, partLabels, profileId, onOpen }) {
  const Tag = onOpen ? 'button' : 'div';
  return html`
    <${Tag} class="rep-song-row" onClick=${onOpen}>
      <span class="rep-song-title">${song.title}</span>
      <${PartPill} song=${song} assignments=${assignments} partLabels=${partLabels} profileId=${profileId} />
    </${Tag}>
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
function CollectionDetail({ collection, songsById, collectionItems, assignments, partLabels, profileId, onBack }) {
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
              assignments=${assignments} partLabels=${partLabels} profileId=${profileId} />`)}
          </div>`}
    </div>
  `;
}

// --- Concert Playlist detail (a performance event's setlist) ---------------
function ConcertDetail({ event, songsById, rehearsalSongs, assignments, partLabels, profileId, onBack }) {
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
              assignments=${assignments} partLabels=${partLabels} profileId=${profileId} />`)}
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
function AllSongs({ collections, collectionItems, songsById, assignments, partLabels, profileId }) {
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
              assignments=${assignments} partLabels=${partLabels} profileId=${profileId} />`)}
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

  const songsById = useMemo(() => Object.fromEntries(songs.map((s) => [s.id, s])), [songs]);

  if (songsLoading) {
    return html`<div class="tab-content"><${LoadingState} label="Loading repertoire…" /></div>`;
  }

  if (detail?.type === 'collection') {
    const collection = collections.find((c) => c.id === detail.id);
    if (collection) {
      return html`<${CollectionDetail} collection=${collection} songsById=${songsById}
        collectionItems=${collectionItems} assignments=${assignments} partLabels=${partLabels}
        profileId=${profile.id} onBack=${() => setDetail(null)} />`;
    }
  }
  if (detail?.type === 'concert') {
    const event = events.find((e) => e.id === detail.id);
    if (event) {
      return html`<${ConcertDetail} event=${event} songsById=${songsById}
        rehearsalSongs=${rehearsalSongs} assignments=${assignments} partLabels=${partLabels}
        profileId=${profile.id} onBack=${() => setDetail(null)} />`;
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
              profileId=${profile.id} />`}
    </div>
  `;
}
