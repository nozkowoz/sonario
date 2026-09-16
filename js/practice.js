import { html, useState, useEffect, useRef, useMemo } from './lib.js';
import { setSongPart, clearSongPart, getRecordingUrl } from './store.js';
import {
  IconBack, IconChevron, IconPlay, IconCheck, IconPause, IconSkipBack, IconSkipForward,
  IconShuffle, IconRepeat,
} from './icons.js';
import { myAssignment, groupSongsByCollection, partLabelText, PartPickerSheet } from './repertoire.js';
import { EmptyState } from './shell.js';

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
// A song with zero recordings — for ANY part — can't produce a single playable queue entry in
// any mode, so it's disabled here rather than let someone select it and hit a wall of "no
// recording yet" two screens later. This is deliberately coarse (any recording at all, not
// "a recording for the mode/part you'll pick next") — mode isn't chosen until the next screen, so
// that's the only thing knowable at this point. The finer per-part/mode gap (e.g. only a Bass
// recording exists but you're Alto) is still caught by the existing queue-generation skip logic.
function SongSelectScreen({ songs, collections, collectionItems, recordings, selectedIds, onToggleSong, onToggleGroup, onBack, onContinue }) {
  const songsById = useMemo(() => Object.fromEntries(songs.map((s) => [s.id, s])), [songs]);
  const groups = useMemo(
    () => groupSongsByCollection(collections, collectionItems, songsById),
    [collections, collectionItems, songsById],
  );
  const recordedSongIds = useMemo(() => new Set(recordings.map((r) => r.song_id)), [recordings]);
  const count = selectedIds.size;

  return html`
    <div class="tab-content practice-screen">
      <${PracticeHeader} title="Practice Mode" backLabel="Repertoire" onBack=${onBack}
        subtitle=${`${count} ${count === 1 ? 'song' : 'songs'} selected`} />
      <div class="practice-body">
        ${groups.map(({ collection, songs: groupSongs }) => {
          const selectable = groupSongs.filter((s) => recordedSongIds.has(s.id));
          const allSelected = selectable.length > 0 && selectable.every((s) => selectedIds.has(s.id));
          return html`
            <div key=${collection.id} class="practice-group">
              <div class="section-header">
                <p class="eyebrow eyebrow-tight" style="margin:0;">
                  ${collection.name}${collection.is_current ? ' · Current' : ''}
                </p>
                ${selectable.length > 0
                  ? html`<button class="btn-quiet" onClick=${() => onToggleGroup(selectable, allSelected)}>Select all</button>`
                  : null}
              </div>
              <div class="practice-select-list">
                ${groupSongs.map((s) => {
                  const hasRecording = recordedSongIds.has(s.id);
                  return html`
                    <button key=${s.id}
                      class=${`practice-select-row ${selectedIds.has(s.id) ? 'practice-select-row-on' : ''} ${!hasRecording ? 'practice-select-row-disabled' : ''}`}
                      disabled=${!hasRecording} onClick=${() => onToggleSong(s.id)}>
                      <span class=${`practice-checkbox ${selectedIds.has(s.id) ? 'practice-checkbox-on' : ''}`}>
                        ${selectedIds.has(s.id) ? html`<${IconCheck} size=${13} />` : null}
                      </span>
                      <span class="practice-select-text">
                        <span class="rep-song-title">${s.title}</span>
                        ${!hasRecording ? html`<span class="form-hint" style="margin:0;">No recordings yet</span>` : null}
                      </span>
                    </button>
                  `;
                })}
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
function ModeAndPartsScreen({ songs, assignments, partLabels, profileId, mode, onModeChange, onEditPart, onBack, onStart, startError }) {
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
        ${startError ? html`<p class="absence-error" style="margin:0 0 10px;">${startError}</p>` : null}
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
// (and no fallback exists either); Stage 2 is what actually shows/skips that state during playback.
//
// A 'part' entry with no isolated recording falls back to the whole-choir recording rather than
// being treated as unavailable — Nina, 2026-09-15: "allow people to practice even if no alto only
// recording, make it just default to the whole choir recording." `fallback: true` marks this so
// the player can show what's actually playing (WHOLE CHOIR, not a fabricated ALTO ONLY) instead
// of silently mislabelling it. In combined mode this can mean the same whole-choir recording
// plays twice in a row for that song (once as the part fallback, once as the real whole-choir
// entry) — a known, accepted consequence of always having something playable rather than
// de-duplicating, which wasn't asked for.
export function buildPracticeQueue({ songs, mode, assignments, profileId, recordings }) {
  const queue = [];
  for (const song of songs) {
    if (mode === 'my_part' || mode === 'both') {
      const mine = myAssignment(assignments, song.id, profileId);
      const partKey = mine?.part_label ?? null;
      let recording = partKey ? latestRecordingFor(recordings, song.id, partKey) : null;
      let fallback = false;
      if (!recording) {
        const wholeChoir = latestRecordingFor(recordings, song.id, 'full_choir');
        if (wholeChoir) { recording = wholeChoir; fallback = true; }
      }
      queue.push({ songId: song.id, songTitle: song.title, kind: 'part', partKey, recording, fallback });
    }
    if (mode === 'whole_choir' || mode === 'both') {
      queue.push({
        songId: song.id, songTitle: song.title, kind: 'whole_choir', partKey: 'full_choir',
        recording: latestRecordingFor(recordings, song.id, 'full_choir'), fallback: false,
      });
    }
  }
  return queue;
}

// Shuffles SONG order, not individual queue entries — a song's part/whole-choir pair (in 'both'
// mode) always stays adjacent and in that order, so shuffle never plays a whole-choir mix before
// its own part-only recording. Fisher-Yates over the song groups, then flattened back out.
function shuffleQueue(queue) {
  const order = [];
  const bySong = new Map();
  for (const entry of queue) {
    if (!bySong.has(entry.songId)) { bySong.set(entry.songId, []); order.push(entry.songId); }
    bySong.get(entry.songId).push(entry);
  }
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.flatMap((songId) => bySong.get(songId));
}

// --- Step 3: the player ----------------------------------------------------------
// Decorative/static only, per Nina 2026-09-15: "Absolutely no audio analysis or generated
// waveform for MVP." Same bars every render, regardless of play state.
function PracticeWaveform() {
  const heights = [14, 20, 28, 38, 52, 68, 88, 68, 52, 38, 28, 20, 14];
  const mid = (heights.length - 1) / 2;
  return html`
    <svg class="practice-waveform" viewBox="0 0 200 100" width="200" height="100" aria-hidden="true">
      ${heights.map((h, i) => html`
        <rect key=${i} x=${i * 15 + 5} y=${50 - h / 2} width="6" height=${h} rx="3"
          fill=${Math.abs(i - mid) <= 1 ? 'var(--purple)' : 'rgba(255,255,255,0.25)'} />
      `)}
    </svg>
  `;
}

function partBadgeText(entry, partLabels) {
  if (entry.kind === 'whole_choir' || entry.fallback) return 'WHOLE CHOIR';
  return `${partLabelText(entry.partKey, partLabels).toUpperCase()} ONLY`;
}
function partBadgeSub(entry, partLabels) {
  if (entry.kind === 'whole_choir' || entry.fallback) return 'Whole choir';
  return `${partLabelText(entry.partKey, partLabels)} only`;
}

// Steps from `startIndex` in `direction` (+1/-1) until it finds a queue entry with a resolved
// recording, or runs off the end — -1 means "nothing playable that way". Used for initial track
// selection, Previous/Next, and auto-advance-on-ended, so "landing on" an unavailable entry never
// actually happens during playback — the position counter still reflects the real queue index
// (queue entries aren't removed), it just silently steps past gaps.
function findAvailable(queue, startIndex, direction) {
  let i = startIndex;
  while (i >= 0 && i < queue.length) {
    if (queue[i].recording) return i;
    i += direction;
  }
  return -1;
}

function PlayerScreen({ queue, partLabels, onClose }) {
  const [shuffleOn, setShuffleOn] = useState(false);
  const [repeatOn, setRepeatOn] = useState(false);
  const [shuffledQueue, setShuffledQueue] = useState(() => shuffleQueue(queue));
  const activeQueue = shuffleOn ? shuffledQueue : queue;
  const [queueIndex, setQueueIndex] = useState(() => findAvailable(activeQueue, 0, 1));
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(null);
  const [skipNotice, setSkipNotice] = useState(null);
  const audioRef = useRef(null);

  const entry = queueIndex >= 0 ? activeQueue[queueIndex] : null;

  // Re-rolls the shuffle order and restarts from its first track — simplest, most predictable
  // behaviour for a small practice session, matching a "shuffle play" button rather than trying to
  // reorder only the not-yet-played remainder around a still-playing track.
  const toggleShuffle = () => {
    if (!shuffleOn) {
      const fresh = shuffleQueue(queue);
      setShuffledQueue(fresh);
      setShuffleOn(true);
      setSkipNotice(null);
      setPlaying(false);
      setQueueIndex(findAvailable(fresh, 0, 1));
    } else {
      setShuffleOn(false);
      setSkipNotice(null);
      setPlaying(false);
      setQueueIndex(findAvailable(queue, 0, 1));
    }
  };

  // Fetch a fresh signed URL whenever the current track changes, then autoplay it — the same
  // on-demand pattern RecordingRow already uses, not pre-fetched for the whole queue up front
  // (a long practice session would otherwise risk the 1-hour signed URL expiring mid-session).
  useEffect(() => {
    if (!entry?.recording) return;
    let cancelled = false;
    setLoadingUrl(true);
    setError(null);
    getRecordingUrl(entry.recording.storage_path).then(({ data, error: err }) => {
      if (cancelled) return;
      setLoadingUrl(false);
      if (err || !data?.signedUrl) { setError("Couldn't load this recording — try again."); return; }
      if (audioRef.current) {
        audioRef.current.src = data.signedUrl;
        audioRef.current.play().catch(() => {});
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.recording?.id]);

  useEffect(() => {
    if (!skipNotice) return;
    const t = setTimeout(() => setSkipNotice(null), 3500);
    return () => clearTimeout(t);
  }, [skipNotice]);

  // Repeat only wraps the FORWARD boundary (queue end -> start) — once all songs finish, not a
  // per-track loop and not applied to Previous at the very start, matching "repeat once songs
  // finish" rather than a single-track repeat.
  const advance = (direction) => {
    const from = queueIndex + direction;
    if (direction === 1 && from >= activeQueue.length) {
      if (!repeatOn) return;
      const found = findAvailable(activeQueue, 0, 1);
      if (found === -1) return;
      setSkipNotice(null);
      setPlaying(false);
      setQueueIndex(found);
      return;
    }
    if (from < 0 || from >= activeQueue.length) return;
    const found = findAvailable(activeQueue, from, direction);
    if (found === -1) return;
    if (found !== from) {
      const skipped = activeQueue[from];
      setSkipNotice(`No ${partBadgeSub(skipped, partLabels)} recording for "${skipped.songTitle}" — skipped`);
    }
    setPlaying(false);
    setQueueIndex(found);
  };

  const jumpTo = (i) => {
    if (!activeQueue[i].recording || i === queueIndex) return;
    setSkipNotice(null);
    setPlaying(false);
    setQueueIndex(i);
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el || !el.src || loadingUrl) return;
    if (playing) el.pause(); else el.play().catch(() => {});
  };

  const canPrev = findAvailable(activeQueue, queueIndex - 1, -1) !== -1;
  const canNext = findAvailable(activeQueue, queueIndex + 1, 1) !== -1
    || (repeatOn && findAvailable(activeQueue, 0, 1) !== -1);

  if (!entry) {
    // Reachable only if every queue entry became unavailable after the queue was built (a
    // recording deleted mid-session) — the "nothing playable at all" case is caught before this
    // screen ever opens, in PracticeFlow's start().
    return html`
      <div class="practice-player">
        <button class="practice-player-done" onClick=${onClose}><${IconBack} size=${14} /> Done</button>
        <${EmptyState} title="Nothing left to play" body="Every recording in this session is now unavailable." />
      </div>
    `;
  }

  return html`
    <div class="practice-player">
      <div class="practice-player-top">
        <button class="practice-player-done" onClick=${onClose}><${IconBack} size=${14} /> Done</button>
        <span class="practice-player-label">Practice Mode</span>
        <span></span>
      </div>

      <${PracticeWaveform} />

      <p class="practice-now-playing">Now playing · ${queueIndex + 1} of ${activeQueue.length}</p>
      <h2 class="practice-player-title">${entry.songTitle}</h2>
      <span class="practice-player-badge">${partBadgeText(entry, partLabels)}</span>

      ${skipNotice ? html`<p class="practice-skip-notice">${skipNotice}</p>` : null}
      ${error ? html`<p class="practice-skip-notice">${error}</p>` : null}

      <div class="practice-controls">
        <button class=${`practice-control-btn ${shuffleOn ? 'practice-control-btn-on' : ''}`}
          aria-label=${shuffleOn ? 'Shuffle on' : 'Shuffle off'} aria-pressed=${shuffleOn} onClick=${toggleShuffle}>
          <${IconShuffle} size=${18} />
        </button>
        <button class="practice-control-btn" disabled=${!canPrev} aria-label="Previous" onClick=${() => advance(-1)}>
          <${IconSkipBack} size=${20} />
        </button>
        <button class="practice-play-btn" disabled=${loadingUrl} aria-label=${playing ? 'Pause' : 'Play'} onClick=${togglePlay}>
          ${playing ? html`<${IconPause} size=${22} />` : html`<${IconPlay} size=${22} />`}
        </button>
        <button class="practice-control-btn" disabled=${!canNext} aria-label="Next" onClick=${() => advance(1)}>
          <${IconSkipForward} size=${20} />
        </button>
        <button class=${`practice-control-btn ${repeatOn ? 'practice-control-btn-on' : ''}`}
          aria-label=${repeatOn ? 'Repeat on' : 'Repeat off'} aria-pressed=${repeatOn} onClick=${() => setRepeatOn((v) => !v)}>
          <${IconRepeat} size=${18} />
        </button>
      </div>

      <p class="practice-up-next-label">Up next</p>
      <div class="practice-queue-list">
        ${activeQueue.map((q, i) => html`
          <button key=${i}
            class=${`practice-queue-row ${i === queueIndex ? 'practice-queue-row-active' : ''} ${!q.recording ? 'practice-queue-row-disabled' : ''}`}
            disabled=${!q.recording} onClick=${() => jumpTo(i)}>
            <span class="practice-queue-index">${i + 1}</span>
            <span class="practice-queue-text">
              <span class="practice-queue-title">${q.songTitle}</span>
              <span class="practice-queue-sub">${q.recording ? partBadgeSub(q, partLabels) : `No ${partBadgeSub(q, partLabels)} recording yet`}</span>
            </span>
            ${q.recording ? html`<${IconPlay} size=${13} />` : null}
          </button>
        `)}
      </div>

      <audio ref=${audioRef} style="display:none;"
        onEnded=${() => advance(1)} onPlay=${() => setPlaying(true)} onPause=${() => setPlaying(false)}
        onError=${() => setError("Couldn't play this recording — try Next.")} />
    </div>
  `;
}

// --- Orchestrator ----------------------------------------------------------------
export function PracticeFlow({ songs, collections, collectionItems, assignments, partLabels, recordings, profile, onClose, onAssignmentSaved }) {
  const [step, setStep] = useState('select'); // 'select' | 'mode' | 'player'
  const [queue, setQueue] = useState(null);
  const [startError, setStartError] = useState(null);
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
    onAssignmentSaved?.(data[0]);
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
    onAssignmentSaved?.(data[0]);
    setEditingSong(null);
  };

  const picker = editingSong ? html`<${PartPickerSheet}
    song=${editingSong}
    currentPartKey=${myAssignment(assignments, editingSong.id, profile.id)?.part_label ?? null}
    partLabels=${partLabels} saving=${saving} error=${pickError}
    onPick=${savePart} onClear=${clearPart} onClose=${closePicker} />` : null;

  // Don't open the player at all if nothing in the session can actually play — agreed
  // 2026-09-15 ("don't enter an empty player — show a useful message instead").
  const start = () => {
    const q = buildPracticeQueue({ songs: selectedSongs, mode, assignments, profileId: profile.id, recordings });
    if (!q.some((e) => e.recording)) {
      setStartError('None of the selected songs have a recording yet for this practice mode — add one from Song Detail first.');
      return;
    }
    setStartError(null);
    setQueue(q);
    setStep('player');
  };

  if (step === 'select') {
    return html`
      <${SongSelectScreen}
        songs=${songs} collections=${collections} collectionItems=${collectionItems} recordings=${recordings}
        selectedIds=${selectedIds} onToggleSong=${toggleSong} onToggleGroup=${toggleGroup}
        onBack=${onClose} onContinue=${() => setStep('mode')} />
    `;
  }

  if (step === 'player') {
    return html`<${PlayerScreen} queue=${queue} partLabels=${partLabels} onClose=${onClose} />`;
  }

  return html`
    <${ModeAndPartsScreen}
      songs=${selectedSongs} assignments=${assignments} partLabels=${partLabels} profileId=${profile.id}
      mode=${mode} onModeChange=${setMode} onEditPart=${openPicker}
      onBack=${() => setStep('select')} onStart=${start} startError=${startError} />
    ${picker}
  `;
}
