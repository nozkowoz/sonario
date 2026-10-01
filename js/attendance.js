import { html, useState, useMemo } from './lib.js';
import { formatEventDateLong, formatTimeRange, todayStr } from './lib.js';
import { displayNameOf, useProfilesById, useAllMemberships, backfillCheckin, removeBackfillCheckin } from './store.js';
import { AttendanceHistoryView } from './checkin.js';
import { currentTermOf } from './events.js';
import { EmptyState, Sheet } from './shell.js';
import { IconBack, IconChevron, IconSearch, IconCalendar, IconList, IconCheck } from './icons.js';

// Admin > Attendance (2026-09-28 redesign, per Nina's mockup). Three entry points on the home
// screen; only the first two are real — "View all attendance" has no mockup detail behind it (the
// given screens only ever show the backfill flow), so it's marked Soon rather than guessed at.
//
// Backfill itself changed shape from a straight "tap = write immediately" model to select-then-
// confirm, matching the mockup's 5-screen flow (select member, select rehearsals, confirm,
// success). A backfilled row can no longer be un-ticked from this screen — the mockup's success
// state only ever shows a plain "Attended" pill, no way back — so that's a real capability this
// redesign drops, not an oversight; flag if undoing a backfill is still needed somewhere.
//
// Filters on `counts_towards_attendance` (matching AttendanceHistoryView's own filter) rather than
// the old `event_type === 'rehearsal'` check it's replacing, which would have missed a workshop
// like Panton Hill that also counts.

const AdminHeadAttendance = ({ title, onBack }) => html`
  <div class="detail-head">
    <button class="icon-btn" aria-label="Back" onClick=${onBack}>
      <${IconBack} size=${20} />
    </button>
    <h2 class="admin-head-title">${title}</h2>
  </div>
`;

function HomeCard({ Icon, title, body, soon, onOpen }) {
  return html`
    <button class="card member-row" disabled=${soon} onClick=${onOpen} style=${soon ? { opacity: 0.55, cursor: 'default' } : {}}>
      <span class="member-avatar" aria-hidden="true"><${Icon} size=${20} /></span>
      <div class="member-row-main">
        <div class="member-row-name">${title}${soon ? html`<span class="admin-soon">Soon</span>` : null}</div>
        <div class="member-row-email">${body}</div>
      </div>
      ${soon ? null : html`<${IconChevron} size=${18} />`}
    </button>
  `;
}

function MemberPicker({ title, subtitle, activeMembers, profilesById, onPick, onBack }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const visible = q
    ? activeMembers.filter((m) => {
        const p = profilesById[m.profile_id];
        return (displayNameOf(p) || '').toLowerCase().includes(q) || (p?.google_email || '').toLowerCase().includes(q);
      })
    : activeMembers;

  return html`
    <div class="tab-content">
      <${AdminHeadAttendance} title=${title} onBack=${onBack} />
      <p class="form-hint" style="margin:0 0 16px;">${subtitle}</p>
      <div style="position:relative;margin-bottom:16px;">
        <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--fig-mute);">
          <${IconSearch} size=${16} />
        </span>
        <input type="search" value=${query} placeholder="Search members…" style="padding-left:36px;"
          onInput=${(e) => setQuery(e.target.value)} />
      </div>
      ${visible.length === 0
        ? html`<${EmptyState} title="No members found" body="No one matches that search." />`
        : visible.map((m) => {
            const p = profilesById[m.profile_id];
            return html`
              <button key=${m.id} class="card member-row" onClick=${() => onPick(m, p)}>
                <span class="member-avatar" aria-hidden="true">${(displayNameOf(p) || '?').trim()[0].toUpperCase()}</span>
                <div class="member-row-main">
                  <div class="member-row-name">${displayNameOf(p) || 'Unknown'}</div>
                  ${p?.google_email ? html`<div class="member-row-email">${p.google_email}</div>` : null}
                </div>
                <${IconChevron} size=${18} />
              </button>
            `;
            })}
    </div>
  `;
}

// --- Backfill flow -------------------------------------------------------------
function ConfirmBackfillSheet({ count, reason, setReason, busy, onConfirm, onCancel }) {
  return html`
    <${Sheet} label="Mark rehearsals as attended?" onClose=${onCancel}>
      <div style="display:flex;flex-direction:column;align-items:center;text-align:center;">
        <span class="more-avatar" style="background:var(--purple-light);color:var(--purple);border:none;margin-bottom:12px;">
          <${IconCalendar} size=${22} />
        </span>
        <h3 class="form-heading" style="margin:0 0 6px;">Mark ${count} rehearsal${count === 1 ? '' : 's'} as attended?</h3>
        <p class="form-hint" style="margin:0 0 16px;">This will record attendance for the rehearsals you selected.</p>
      </div>
      <label style="margin-bottom:16px;">
        Reason (optional)
        <input type="text" value=${reason} disabled=${busy} onInput=${(e) => setReason(e.target.value)}
          placeholder="e.g. Backfilled from Sean's paper roll, Term 2" />
      </label>
      <div class="form-actions">
        <button class="btn-quiet" disabled=${busy} onClick=${onCancel}>Cancel</button>
        <button class="btn btn-primary" disabled=${busy} onClick=${onConfirm}>${busy ? 'Saving…' : 'Confirm'}</button>
      </div>
    </${Sheet}>
  `;
}

function BackfillRehearsalSelect({ member, profile, events, checkins, session, onCheckinSaved, onCheckinRemoved, onBack }) {
  const today = new Date().toISOString().slice(0, 10);
  const pastRehearsals = useMemo(() => events
    .filter((e) => e.counts_towards_attendance && e.status === 'scheduled' && e.rehearsal_date < today)
    .sort((a, b) => b.rehearsal_date.localeCompare(a.rehearsal_date)),
    [events, today]);

  const theirCheckins = checkins.filter((c) => c.profile_id === member.profile_id);
  const checkinFor = (rehearsalId) => theirCheckins.find((c) => c.rehearsal_id === rehearsalId);

  const [selected, setSelected] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [justMarked, setJustMarked] = useState(null); // Set of rehearsal ids, for the success banner
  const [dismissedSuccess, setDismissedSuccess] = useState(false);
  const [removingId, setRemovingId] = useState(null);

  const toggle = (rehearsalId) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(rehearsalId)) next.delete(rehearsalId); else next.add(rehearsalId);
    return next;
  });

  // Nina, 2026-09-28: "we need to be able to undo anything" — a backfilled row can be removed
  // again from right here, same as the pre-redesign screen could. A REAL check-in (not our own
  // super_backfill source) still can't be touched from this screen: backfilling closes gaps, it
  // was never meant to let a super silently overwrite someone's genuine record.
  const undoBackfill = async (checkinId) => {
    setRemovingId(checkinId);
    setError(null);
    const { data, error: err } = await removeBackfillCheckin(checkinId);
    setRemovingId(null);
    if (err) { setError(err.message); return; }
    if (!data || data.length === 0) { setError("That didn't save, reload and try again."); return; }
    onCheckinRemoved?.(checkinId);
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const ids = [...selected];
    const results = await Promise.all(ids.map((rehearsalId) => backfillCheckin({
      rehearsalId, profileId: member.profile_id, correctedBy: session.user.id, reason,
    })));
    setBusy(false);
    const failed = results.filter((r) => r.error || !r.data?.[0]).length;
    for (const r of results) { if (!r.error && r.data?.[0]) onCheckinSaved?.(r.data[0]); }
    if (failed === ids.length) {
      setError("That didn't save, check you still have organiser access.");
      return;
    }
    setJustMarked(new Set(ids));
    setSelected(new Set());
    setReason('');
    setConfirming(false);
    setDismissedSuccess(false);
    if (failed > 0) setError(`${failed} of ${ids.length} couldn't be saved.`);
  };

  return html`
    <div class="tab-content">
      <${AdminHeadAttendance} title="Backfill attendance" onBack=${onBack} />

      <div class="card" style="margin-bottom:16px;display:flex;align-items:center;gap:10px;">
        <span class="member-avatar" aria-hidden="true">${(displayNameOf(profile) || '?').trim()[0].toUpperCase()}</span>
        <div>
          <div class="member-row-name">${displayNameOf(profile) || 'Unknown'}</div>
          ${profile?.google_email ? html`<div class="member-row-email">${profile.google_email}</div>` : null}
        </div>
      </div>

      ${justMarked && !dismissedSuccess ? html`
        <div class="card" style="background:var(--green-bg, #e6f6ec);box-shadow:none;margin-bottom:16px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
          <div>
            <p style="margin:0;font-weight:700;color:var(--green);">Attendance recorded</p>
            <p class="form-hint" style="margin:2px 0 0;">
              ${justMarked.size} rehearsal${justMarked.size === 1 ? '' : 's'} marked as attended for ${displayNameOf(profile)}.
            </p>
          </div>
          <button class="icon-btn" aria-label="Dismiss" onClick=${() => setDismissedSuccess(true)}>×</button>
        </div>
      ` : null}

      <p style="margin:0 0 4px;font-weight:700;">Select rehearsals</p>
      <p class="form-hint" style="margin:0 0 14px;">Only rehearsals that count towards attendance are shown.</p>
      ${error ? html`<p class="absence-error">${error}</p>` : null}

      ${pastRehearsals.length === 0
        ? html`<${EmptyState} title="No past rehearsals yet" body="Nothing to backfill until at least one rehearsal has happened." />`
        : html`<div class="practice-select-list">
            ${pastRehearsals.map((r) => {
              const existing = checkinFor(r.id);
              const isAttended = !!existing; // either a real check-in or an earlier backfill
              const isOurBackfill = existing?.source === 'super_backfill';
              if (isAttended) {
                return html`
                  <div key=${r.id} class="practice-select-row practice-select-row-disabled">
                    <span class="practice-select-text">
                      <span class="rep-song-title">${formatEventDateLong(r.rehearsal_date)}</span>
                      <span class="form-hint" style="margin:0;">${formatTimeRange(r.start_time, r.end_time)}</span>
                    </span>
                    <span class="event-type-badge" style="background:var(--green-bg, #e6f6ec);color:var(--green);">Attended</span>
                    ${isOurBackfill ? html`
                      <button class="btn-quiet" disabled=${removingId === existing.id}
                        onClick=${() => undoBackfill(existing.id)}>
                        ${removingId === existing.id ? 'Removing…' : 'Remove'}
                      </button>
                    ` : null}
                  </div>
                `;
              }
              return html`
                <button key=${r.id} class=${`practice-select-row ${selected.has(r.id) ? 'practice-select-row-on' : ''}`}
                  onClick=${() => toggle(r.id)}>
                  <span class=${`practice-checkbox ${selected.has(r.id) ? 'practice-checkbox-on' : ''}`}>
                    ${selected.has(r.id) ? html`<${IconCheck} size=${13} />` : null}
                  </span>
                  <span class="practice-select-text">
                    <span class="rep-song-title">${formatEventDateLong(r.rehearsal_date)}</span>
                    <span class="form-hint" style="margin:0;">${formatTimeRange(r.start_time, r.end_time)}</span>
                  </span>
                  <span class="event-type-badge">Rehearsal</span>
                </button>
              `;
            })}
          </div>`}

      ${selected.size > 0 ? html`
        <div class="practice-sticky-footer">
          <button class="btn btn-primary" style="width:100%;" onClick=${() => setConfirming(true)}>
            Mark ${selected.size} rehearsal${selected.size === 1 ? '' : 's'} as attended
          </button>
        </div>
      ` : null}

      ${confirming ? html`<${ConfirmBackfillSheet} count=${selected.size} reason=${reason} setReason=${setReason}
        busy=${busy} onConfirm=${confirm} onCancel=${() => setConfirming(false)} />` : null}
    </div>
  `;
}

// --- Home + router ---------------------------------------------------------------
export function AdminAttendance({ session, events, checkins, absences, awayDates, terms, onCheckinSaved, onCheckinRemoved, onBack }) {
  const [screen, setScreen] = useState('home'); // 'home' | 'insights' | 'backfill-pick' | 'backfill-select' | 'history'
  const [chosen, setChosen] = useState(null); // { membership, profile }

  const { memberships } = useAllMemberships();
  const activeMembers = useMemo(() => memberships.filter((m) => m.status === 'active'), [memberships]);
  const ids = activeMembers.map((m) => m.profile_id);
  const profilesById = useProfilesById(ids);

  // Attendance insights (2026-10-01, replacing the old "View all attendance" Soon stub): this
  // term's rehearsals/workshops that have actually happened so far, same denominator rule as
  // Home's own My Term card — only what's already past counts, never the whole term scheduled.
  const term = useMemo(() => currentTermOf(terms || []), [terms]);
  const today = todayStr();
  const soFarEvents = useMemo(() => (term
    ? events.filter((e) => e.term_id === term.id && e.counts_towards_attendance
        && e.status !== 'cancelled' && e.rehearsal_date < today)
    : []), [events, term, today]);
  const insights = useMemo(() => activeMembers.map((m) => {
    const attended = checkins.filter((c) => c.profile_id === m.profile_id
      && soFarEvents.some((e) => e.id === c.rehearsal_id)).length;
    const soFar = soFarEvents.length;
    const pct = soFar ? Math.round((attended / soFar) * 100) : null;
    return { membership: m, profile: profilesById[m.profile_id], attended, soFar, pct };
    // Lowest attendance first — that's the actionable end of the list for a super to look at;
    // members with no data yet (pct null) sort to the bottom rather than the top.
  }).sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101)), [activeMembers, checkins, soFarEvents, profilesById]);

  if (screen === 'insights') {
    return html`
      <div class="tab-content">
        <${AdminHeadAttendance} title="Attendance insights" onBack=${() => setScreen('home')} />
        ${!term ? html`<${EmptyState} title="No current term" body="Insights need an active term with at least one past rehearsal." />`
          : soFarEvents.length === 0 ? html`<${EmptyState} title="Nothing yet this term" body="Insights will show up once a rehearsal has happened this term." />`
          : html`
            <p class="form-hint" style="margin:0 0 14px;">
              ${term.name} · ${soFarEvents.length} rehearsal${soFarEvents.length === 1 ? '' : 's'} so far. Tap a member for their full history.
            </p>
            <div class="rep-song-list">
              ${insights.map(({ membership, profile, attended, soFar, pct }) => html`
                <button key=${membership.id} class="rep-song-row"
                  onClick=${() => { setChosen({ membership, profile }); setScreen('history'); }}>
                  <span class="rep-song-title">${displayNameOf(profile)}</span>
                  <span class="form-hint">${pct === null ? 'No data' : `${pct}% (${attended}/${soFar})`}</span>
                  <${IconChevron} size=${16} />
                </button>
              `)}
            </div>
          `}
      </div>
    `;
  }
  if (screen === 'backfill-pick') {
    return html`<${MemberPicker} title="Backfill attendance" subtitle="Choose a member to mark past attendance for."
      activeMembers=${activeMembers} profilesById=${profilesById}
      onPick=${(m, p) => { setChosen({ membership: m, profile: p }); setScreen('backfill-select'); }}
      onBack=${() => setScreen('home')} />`;
  }
  if (screen === 'backfill-select' && chosen) {
    return html`<${BackfillRehearsalSelect} member=${chosen.membership} profile=${chosen.profile}
      events=${events} checkins=${checkins} session=${session} onCheckinSaved=${onCheckinSaved}
      onCheckinRemoved=${onCheckinRemoved} onBack=${() => setScreen('backfill-pick')} />`;
  }
  if (screen === 'history' && chosen) {
    return html`<${AttendanceHistoryView} events=${events} checkins=${checkins} absences=${absences}
      awayDates=${awayDates} profile=${chosen.profile} subjectName=${displayNameOf(chosen.profile)}
      onBack=${() => setScreen('insights')} />`;
  }

  return html`
    <div class="tab-content">
      <${AdminHeadAttendance} title="Attendance" onBack=${onBack} />
      <p class="form-hint" style="margin:0 0 16px;">Manage attendance and view history.</p>
      <${HomeCard} Icon=${IconList} title="View attendance insights" body="See attendance rates across all members, this term."
        onOpen=${() => setScreen('insights')} />
      <${HomeCard} Icon=${IconCalendar} title="Backfill attendance" body="Mark past attendance for a member."
        onOpen=${() => setScreen('backfill-pick')} />
    </div>
  `;
}
