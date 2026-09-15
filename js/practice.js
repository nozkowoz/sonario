import { html, useState, useMemo } from './lib.js';
import { setSongPart, clearSongPart } from './store.js';
import { IconBack, IconChevron, IconPlay, IconCheck } from './icons.js';
import { myAssignment, groupSongsByCollection, partLabelText, PartPickerSheet } from './repertoire.js';

// Practice Mode — Stage 1 (2026-09-15): song selection + mode/part setup, against the five Figma
// screens Nina supplied. No new schema: everything here reads/writes the same songs/
// song_collections/song_collection_items/song_assignments/recordings tables the rest of
// Repertoire already uses. Agreed decisions baked in (see chat 2026-09-15, don't relitigate
// without asking her again):
//   - Part pre-fill: an existing song_assignments row is picked up automatically and never
//     re-asked for. Picking a part here writes through setSongPart/clearSongPart — the SAME
//     table Song Detail's "Your part" edits — there is no separate "practice part" concept.
//   - Whole choir mode skips the per-song part step entirely.
//   - My part + Whole choir alternates WITHIN each song (part, then whole choir, then the next
//     song's part, then its whole choir) — for 2 songs that's 4 queue entries, not 2.
//   - Missing recordings stay visible in the queue rather than being silently dropped; Stage 2
//     is what actually surfaces/skips them during playback. Stage 1 only needs to resolve which
//     entries have no matching recording, which buildPracticeQueue already does.
//   - No player, no audio, no persisted session state in this stage — see Stage 2.

const MODE_OPTIONS = [
  { key: 'my_part', title: 'My part', desc: 'Play your part recording for each song' },
  { key: 'whole_choir', title: 'Whole choir', desc: 'Full mix recording for each song' },
  { key: 'both', title: 'My part + Whole choir', desc: 'Alternate between your part and full mix' },
];

export function PracticeEntryCard({ onOpen }) {
  return html`
    <button class="practice-entry-card" onClick=${onOpen}>
      <span class="practice-entry-icon"><${IconPlay} size=${16} /></span>
      <span class="practice-entry-body">
        <span class="practice-entry-title">Practice Mode</span>
        <span class="practice-entry-sub">Select songs, choose your part, and play through your recordings.</span>
      </span>
      <${IconChevron} size=${16} />
    </button>
  `;
}

// Purple-hero header shared by both setup screens — back link text differs per screen to match
// the Figma exactly ("← Repertoire" on song selection, "← Song selection" on the mode screen).
function PracticeHeader({ title, subtitle, backLabel, onBack }) {
  return html`
    <div class="cal-top practice-top">
      <button class="practice-back-link" onClick=${onBack}><${IconBack} size=${14} /> ${backLabel}</button>
      <h2 class="cal-title">${title}</h2>
      ${subtitle ? html`<p class="cal-term">${subtitle}</p>` : null}
    </div>
  `;
}

// --- Step 1: song selection ---------------------------------------------------
function SongSelectScreen({ songs, collections, collectionItems, selectedIds, onToggleSong, onToggleGroup, onBack, onContinue }) {
  const songsById = useMemo(() => Object.fromEntries(songs.map((s) => [s.id, s])), [songs]);
  const groups = useMemo(
    () => groupSongsByCollection(collections, collectionItems, songsById),
    [collections, collectionItems, songsById],
  );
  const count = selectedIds.size;

  return html`
    <div class="tab-content practice-screen">
      <${PracticeHeader} title="Practice Mode" backLabel="Repertoire" onBack=${onBack}
        subtitle=${`${count} ${count === 1 ? 'song' : 'songs'} selected`} />
      <div class="practice-body">
        ${groups.map(({ collection, songs: groupSongs }) => {
          const allSelected = groupSongs.length > 0 && groupSongs.every((s) => selectedIds.has(s.id));
          return html`
            <div key=${collection.id} class="practice-group">
              <div class="section-header">
                <p class="eyebrow eyebrow-tight" style="margin:0;">
                  ${collection.name}${collection.is_current ? ' · Current' : ''}
                </p>
                <button class="btn-quiet" onClick=${() => onToggleGroup(groupSongs, allSelected)}>Select all</button>
              </div>
              <div class="practice-select-list">
                ${groupSongs.map((s) => html`
                  <button key=${s.id} class=${`practice-select-row ${selectedIds.has(s.id) ? 'practice-select-row-on' : ''}`}
                    onClick=${() => onToggleSong(s.id)}>
                    <span class=${`practice-checkbox ${selectedIds.has(s.id) ? 'practice-checkbox-on' : ''}`}>
                      ${selectedIds.has(s.id) ? html`<${IconCheck} size=${13} />` : null}
                    </span>
                    <span class="rep-song-title">${s.title}</span>
                  </button>
                `)}
              </div>
            </div>
          `;
        })}
      </div>
      <div class="practice-sticky-footer">
        <button class="btn btn-primary" style="width:100%;" disabled=${count === 0} onClick=${onContinue}>
          <${IconPlay} size=${14} /> Practice ${count} ${count === 1 ? 'song' : 'songs'}
        </button>
      </div>
    </div>
  `;
}

// --- Step 2: mode + per-song part resolution ----------------------------------
function ModeAndPartsScreen({ songs, assignments, partLabels, profileId, mode, onModeChange, onEditPart, onBack, onStart }) {
  const needsParts = mode !== 'whole_choir';
  const remaining = needsParts ? songs.filter((s) => !myAssignment(assignments, s.id, profileId)).length : 0;
  const ready = !needsParts || remaining === 0;

  return html`
    <div class="tab-content practice-screen">
      <${PracticeHeader} title="How do you want to practice?" backLabel="Song selection" onBack=${onBack}
        subtitle=${`${songs.length} ${songs.length === 1 ? 'song' : 'songs'}`} />
      <div class="practice-body">
        <p class="eyebrow eyebrow-tight">Practice mode</p>
        <div class="practice-mode-list">
          ${MODE_OPTIONS.map((o) => html`
            <button key=${o.key} class=${`practice-mode-radio ${mode === o.key ? 'practice-mode-radio-on' : ''}`}
              onClick=${() => onModeChange(o.key)}>
              <span class=${`practice-radio-dot ${mode === o.key ? 'practice-radio-dot-on' : ''}`}></span>
              <span class="practice-mode-text">
                <span class="practice-mode-title">${o.title}</span>
                <span class="form-hint" style="margin:0;">${o.desc}</span>
              </span>
            </button>
          `)}
        </div>

        ${needsParts ? html`
          <div class="section-header" style="margin-top:22px;">
            <p class="eyebrow eyebrow-tight" style="margin:0;">Your parts</p>
            ${remaining > 0 ? html`<span class="practice-remaining">${remaining} remaining</span>` : null}
          </div>
          <div class="rep-song-list">
            ${songs.map((s, i) => {
              const mine = myAssignment(assignments, s.id, profileId);
              return html`
                <button key=${s.id} class="rep-song-row" onClick=${() => onEditPart(s)}>
                  <span class="rep-song-title">${i + 1}. ${s.title}</span>
                  ${mine
                    ? html`<span class="event-type-badge">${partLabelText(mine.part_label, partLabels)}</span>`
                    : html`<span class="event-type-badge part-pill-empty">Choose</span>`}
                </button>
              `;
            })}
          </div>
        ` : null}
      </div>
      <div class="practice-sticky-footer">
        <button class="btn btn-primary" style="width:100%;" disabled=${!ready} onClick=${onStart}>
          ${ready ? 'Start practicing' : `Choose ${remaining} more part${remaining === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  `;
}

// --- Queue generation ----------------------------------------------------------
function latestRecordingFor(recordings, songId, partKey) {
  const matches = recordings.filter((r) => r.song_id === songId && r.part_label === partKey);
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))[0];
}

// One entry per song for 'my_part'/'whole_choir'; TWO entries per song for 'both' (part then
// whole choir, in that order, before the next song) — agreed 2026-09-15, explicitly NOT
// song-level alternation. `recording` is null when nothing's been uploaded for that song+part
// yet; Stage 2 is what actually shows/skips that state during playback.
export function buildPracticeQueue({ songs, mode, assignments, profileId, recordings }) {
  const queue = [];
  for (const song of songs) {
    if (mode === 'my_part' || mode === 'both') {
      const mine = myAssignment(assignments, song.id, profileId);
      const partKey = mine?.part_label ?? null;
      queue.push({
        songId: song.id, songTitle: song.title, kind: 'part', partKey,
        recording: partKey ? latestRecordingFor(recordings, song.id, partKey) : null,
      });
    }
    if (mode === 'whole_choir' || mode === 'both') {
      queue.push({
        songId: song.id, songTitle: song.title, kind: 'whole_choir', partKey: 'full_choir',
        recording: latestRecordingFor(recordings, song.id, 'full_choir'),
      });
    }
  }
  return queue;
}

// --- Orchestrator ----------------------------------------------------------------
export function PracticeFlow({ songs, collections, collectionItems, assignments, partLabels, recordings, profile, onClose }) {
  const [step, setStep] = useState('select'); // 'select' | 'mode'
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [mode, setMode] = useState('my_part');
  const [editingSong, setEditingSong] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pickError, setPickError] = useState(null);

  const toggleSong = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleGroup = (groupSongs, allSelected) => setSelectedIds((prev) => {
    const next = new Set(prev);
    for (const s of groupSongs) { if (allSelected) next.delete(s.id); else next.add(s.id); }
    return next;
  });

  const selectedSongs = useMemo(() => songs.filter((s) => selectedIds.has(s.id)), [songs, selectedIds]);

  const openPicker = (song) => { setEditingSong(song); setPickError(null); };
  const closePicker = () => { if (!saving) { setEditingSong(null); setPickError(null); } };

  // Same shape as RepertoireTab's own savePart/clearPart — deliberately not shared as a prop
  // across files, since these two flows just happen to write to the same table.
  const savePart = async (partLabel) => {
    const existing = myAssignment(assignments, editingSong.id, profile.id);
    setSaving(true); setPickError(null);
    const { data, error } = await setSongPart(
      { existingAssignmentId: existing?.id, songId: editingSong.id, profileId: profile.id },
      partLabel,
    );
    setSaving(false);
    if (error) { setPickError(error.message); return; }
    if (!data || data.length === 0) { setPickError("That didn't save — reload and try again."); return; }
    setEditingSong(null);
  };

  const clearPart = async () => {
    const existing = myAssignment(assignments, editingSong.id, profile.id);
    if (!existing) { setEditingSong(null); return; }
    setSaving(true); setPickError(null);
    const { data, error } = await clearSongPart(existing.id, profile.id);
    setSaving(false);
    if (error) { setPickError(error.message); return; }
    if (!data || data.length === 0) { setPickError("That didn't save — reload and try again."); return; }
    setEditingSong(null);
  };

  const picker = editingSong ? html`<${PartPickerSheet}
    song=${editingSong}
    currentPartKey=${myAssignment(assignments, editingSong.id, profile.id)?.part_label ?? null}
    partLabels=${partLabels} saving=${saving} error=${pickError}
    onPick=${savePart} onClear=${clearPart} onClose=${closePicker} />` : null;

  // Stage 1 stand-in for Stage 2's real player screen: prove the queue is right, don't build a
  // throwaway placeholder UI that looks like it's trying to be the final design.
  const start = () => {
    const queue = buildPracticeQueue({ songs: selectedSongs, mode, assignments, profileId: profile.id, recordings });
    // eslint-disable-next-line no-console
    console.log('[Practice Mode] generated queue', queue);
    window.__practiceQueue = queue;
  };

  if (step === 'select') {
    return html`
      <${SongSelectScreen}
        songs=${songs} collections=${collections} collectionItems=${collectionItems}
        selectedIds=${selectedIds} onToggleSong=${toggleSong} onToggleGroup=${toggleGroup}
        onBack=${onClose} onContinue=${() => setStep('mode')} />
    `;
  }

  return html`
    <${ModeAndPartsScreen}
      songs=${selectedSongs} assignments=${assignments} partLabels=${partLabels} profileId=${profile.id}
      mode=${mode} onModeChange=${setMode} onEditPart=${openPicker}
      onBack=${() => setStep('select')} onStart=${start} />
    ${picker}
  `;
}
