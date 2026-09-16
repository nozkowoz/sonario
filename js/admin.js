import { html, useState, useMemo } from './lib.js';
import { todayStr, formatEventDateLong } from './lib.js';
import { ApprovalQueue } from './approvals.js';
import { useAllMemberships, backfillCheckin, removeBackfillCheckin } from './store.js';
import { EventRow, EventForm } from './events.js';
import { AdminInvoices } from './invoices.js';
import { EmptyState, LoadingState } from './shell.js';
import { IconCalendar, IconUsers, IconCheckSquare, IconBell, IconAdmin, IconCrown, IconInvoice,
  IconChevron, IconBack, IconCheck } from './icons.js';

// The organiser console. Everything an organiser does lives here, so the member-facing screens
// (Home, Calendar, More) read identically whether you're a super or not — which is the whole
// point: Nina can judge the member experience without a second account, and can't cancel a
// rehearsal by mis-tapping while browsing.
//
// Hiding this tab is presentation only. Every action below is still enforced by RLS — the
// "super manage rehearsals" and "super decides memberships" policies — so a member who somehow
// reached this screen could look at it and change nothing.
const SECTIONS = [
  { key: 'events', label: 'Events', Icon: IconCalendar,
    body: 'Create, edit and manage all choir events and rehearsals.' },
  { key: 'members', label: 'Members', Icon: IconUsers,
    body: 'View and manage choir members and membership requests.' },
  // Listed but not built, deliberately: showing the shape of the console is useful, and each of
  // these is real work rather than a screen waiting to be drawn.
  { key: 'attendance', label: 'Attendance', Icon: IconCheckSquare,
    body: 'Backfill past attendance for a member, week by week.' },
  { key: 'invoices', label: 'Invoices', Icon: IconInvoice,
    body: 'Generate term invoices and manage invoice numbering.' },
  { key: 'notifications', label: 'Notifications', Icon: IconBell,
    body: 'Send and schedule messages to your choir.', soon: true },
  { key: 'settings', label: 'Settings', Icon: IconAdmin,
    body: 'Update choir details, term dates and preferences.', soon: true },
];

export function AdminTab({
  session, view, setView, events, eventsLoading, terms, onEventSaved,
  directory, checkins, onCheckinSaved, onCheckinRemoved,
}) {
  if (view?.section === 'events') {
    return html`<${AdminEvents} events=${events} loading=${eventsLoading} terms=${terms}
      initialEditId=${view.editId || null} onBack=${() => setView(null)} onEventSaved=${onEventSaved} />`;
  }
  if (view?.section === 'members') {
    return html`<${AdminMembers} session=${session} onBack=${() => setView(null)} />`;
  }
  if (view?.section === 'attendance') {
    return html`<${AdminAttendance} session=${session} events=${events} directory=${directory}
      checkins=${checkins} onCheckinSaved=${onCheckinSaved} onCheckinRemoved=${onCheckinRemoved}
      onBack=${() => setView(null)} />`;
  }
  if (view?.section === 'invoices') {
    return html`<${AdminInvoices} terms=${terms} directory=${directory} profileId=${session.user.id}
      onBack=${() => setView(null)} />`;
  }
  if (view?.section) {
    const section = SECTIONS.find((s) => s.key === view.section);
    return html`
      <div class="tab-content">
        <${AdminHead} title=${section?.label || 'Admin'} onBack=${() => setView(null)} />
        <${EmptyState} title="Not built yet"
          body=${`${section?.body || ''} This is next on the list rather than a screen waiting to be filled in.`} />
      </div>
    `;
  }

  return html`
    <div class="tab-content">
      <h2>Admin</h2>
      <p class="admin-intro">Manage your choir, events and members.</p>
      <div class="admin-menu">
        ${SECTIONS.map((s) => html`
          <button key=${s.key} class="admin-row ${s.soon ? 'admin-row-soon' : ''}"
            onClick=${() => setView({ section: s.key })}>
            <span class="admin-row-icon"><${s.Icon} size=${22} /></span>
            <span class="admin-row-text">
              <span class="admin-row-label">
                ${s.label}${s.soon ? html`<span class="admin-soon">Soon</span>` : null}
              </span>
              <span class="admin-row-body">${s.body}</span>
            </span>
            <span class="admin-row-chev"><${IconChevron} size=${18} /></span>
          </button>
        `)}
      </div>
      <div class="card super-card">
        <span class="super-card-icon"><${IconCrown} size=${20} /></span>
        <div>
          <p class="super-card-title">Super user access</p>
          <p class="super-card-body">You have full administrative access to Sonario.</p>
        </div>
      </div>
    </div>
  `;
}

function AdminHead({ title, onBack, action = null }) {
  return html`
    <div class="detail-head">
      <button class="icon-btn" aria-label="Back to Admin" onClick=${onBack}>
        <${IconBack} size=${20} />
      </button>
      <h2 class="admin-head-title">${title}</h2>
      ${action}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Admin > Events. The same rows and form the Calendar used to carry inline, now the only place
// events are created or changed. Tapping a row here opens the editor rather than the member
// detail screen — in this context editing is the intent, not reading.
// ---------------------------------------------------------------------------
function AdminEvents({ events, loading, terms, initialEditId, onBack, onEventSaved }) {
  const [editing, setEditing] = useState(() => {
    if (!initialEditId) return null;
    const ev = events.find((e) => e.id === initialEditId);
    return ev ? { event: ev, focus: null } : null;
  });

  const today = todayStr();
  const upcoming = useMemo(() => events.filter((e) => e.rehearsal_date >= today), [events, today]);
  const past = useMemo(
    () => events.filter((e) => e.rehearsal_date < today).slice().reverse(),
    [events, today],
  );

  const rowProps = (e) => ({
    event: e,
    canManage: true,
    onOpen: (ev) => setEditing({ event: ev, focus: null }),
    onEdit: (ev) => setEditing({ event: ev, focus: null }),
    onReschedule: (ev) => setEditing({ event: ev, focus: 'date' }),
    onEventSaved,
  });

  return html`
    <div class="tab-content">
      <${AdminHead} title="Events" onBack=${onBack}
        action=${editing ? null : html`
          <button class="btn btn-dark btn-sm" onClick=${() => setEditing({ event: null, focus: null })}>
            + Add event
          </button>`} />

      ${editing ? html`
        <${EventForm} event=${editing.event} focusField=${editing.focus} terms=${terms}
          onDone=${(saved) => { onEventSaved?.(saved); setEditing(null); }} />
      ` : null}

      ${loading ? html`<${LoadingState} label="Loading events…" />` : null}

      ${!loading && events.length === 0 ? html`
        <${EmptyState} title="No events yet"
          body="Add your first rehearsal, workshop, performance or social and it will show up on everyone's calendar." />
      ` : null}

      ${!loading && upcoming.length > 0 ? html`
        <p class="eyebrow">Coming up</p>
        <div class="event-list">
          ${upcoming.map((e) => html`<${EventRow} key=${e.id} ...${rowProps(e)} showRelative=${true} />`)}
        </div>
      ` : null}

      ${!loading && past.length > 0 ? html`
        <p class="eyebrow">Earlier</p>
        <div class="event-list">
          ${past.map((e) => html`<${EventRow} key=${e.id} ...${rowProps(e)} />`)}
        </div>
      ` : null}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Admin > Attendance. Super-only backfill of past attendance, per member per week — for a term
// that predates the app (migration 0012, agreed 2026-09-15). Deliberately narrow: rehearsals
// only ("per week" means the weekly recurring thing, not workshops/performances/socials), and
// only weeks that have already happened — the RLS policy enforces that server-side too, this
// just keeps the UI from offering something it knows will be rejected.
//
// A week already carrying a REAL check-in (live or friend_confirmed) shows ticked but disabled —
// this screen backfills gaps, it doesn't let a super silently overwrite someone's genuine record.
// ---------------------------------------------------------------------------
function AdminAttendance({ session, events, directory, checkins, onCheckinSaved, onCheckinRemoved, onBack }) {
  const [memberId, setMemberId] = useState(null);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const today = todayStr();
  const pastRehearsals = useMemo(() => events
    .filter((e) => e.event_type === 'rehearsal' && e.status === 'scheduled' && e.rehearsal_date < today)
    .sort((a, b) => b.rehearsal_date.localeCompare(a.rehearsal_date)),
    [events, today]);

  const members = useMemo(
    () => Object.values(directory).sort((a, b) => a.display_name.localeCompare(b.display_name)),
    [directory],
  );

  if (!memberId) {
    return html`
      <div class="tab-content">
        <${AdminHead} title="Attendance" onBack=${onBack} />
        <p class="form-hint" style="margin:0 0 14px;">
          Backfill past attendance for a member — for weeks before the choir used Sonario.
        </p>
        ${members.length === 0
          ? html`<${EmptyState} title="No members yet" body="Nobody to backfill attendance for." />`
          : html`<div class="rep-song-list">
              ${members.map((m) => html`
                <button key=${m.id} class="rep-song-row" onClick=${() => setMemberId(m.id)}>
                  <span class="rep-song-title">${m.display_name}</span>
                  <${IconChevron} size=${16} />
                </button>
              `)}
            </div>`}
      </div>
    `;
  }

  const member = directory[memberId];
  const theirCheckins = checkins.filter((c) => c.profile_id === memberId);
  const checkinFor = (rehearsalId) => theirCheckins.find((c) => c.rehearsal_id === rehearsalId);

  const toggle = async (rehearsal) => {
    const existing = checkinFor(rehearsal.id);
    if (existing && existing.source !== 'super_backfill') return; // a real check-in, not ours to touch
    setBusyId(rehearsal.id);
    setError(null);
    if (existing) {
      const { data, error: err } = await removeBackfillCheckin(existing.id);
      setBusyId(null);
      if (err) { setError(err.message); return; }
      if (!data || data.length === 0) { setError("That didn't save — reload and try again."); return; }
      onCheckinRemoved?.(existing.id);
    } else {
      const { data, error: err } = await backfillCheckin({
        rehearsalId: rehearsal.id, profileId: memberId, correctedBy: session.user.id, reason,
      });
      setBusyId(null);
      if (err) { setError(err.message); return; }
      if (!data || data.length === 0) { setError("That didn't save — reload and try again."); return; }
      onCheckinSaved?.(data[0]);
    }
  };

  return html`
    <div class="tab-content">
      <${AdminHead} title="Attendance" onBack=${() => setMemberId(null)} />
      <p class="form-hint" style="margin:0 0 4px;">${member?.display_name || 'Member'}</p>
      <label style="margin-bottom:14px;">
        Reason (optional, applies to weeks you tick below)
        <input type="text" value=${reason} onInput=${(e) => setReason(e.target.value)}
          placeholder="e.g. Backfilled from Sean's paper roll, Term 2" />
      </label>
      ${error ? html`<p class="absence-error">${error}</p>` : null}
      ${pastRehearsals.length === 0
        ? html`<${EmptyState} title="No past rehearsals yet" body="Nothing to backfill until at least one rehearsal has happened." />`
        : html`<div class="practice-select-list">
            ${pastRehearsals.map((r) => {
              const existing = checkinFor(r.id);
              const isReal = !!existing && existing.source !== 'super_backfill';
              return html`
                <button key=${r.id}
                  class=${`practice-select-row ${existing ? 'practice-select-row-on' : ''} ${isReal ? 'practice-select-row-disabled' : ''}`}
                  disabled=${busyId === r.id || isReal} onClick=${() => toggle(r)}>
                  <span class=${`practice-checkbox ${existing ? 'practice-checkbox-on' : ''}`}>
                    ${existing ? html`<${IconCheck} size=${13} />` : null}
                  </span>
                  <span class="practice-select-text">
                    <span class="rep-song-title">${formatEventDateLong(r.rehearsal_date)}</span>
                    ${isReal ? html`<span class="form-hint" style="margin:0;">Already checked in</span>` : null}
                  </span>
                </button>
              `;
            })}
          </div>`}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Admin > Members. The approval queue, moved off the More tab so More reads the same for
// everyone. Promoting a member to super is NOT here yet — it needs care around the policy that
// stops anyone approving or promoting themselves, so it's its own piece of work.
// ---------------------------------------------------------------------------
function AdminMembers({ session, onBack }) {
  const { memberships, patchMembership } = useAllMemberships();

  return html`
    <div class="tab-content">
      <${AdminHead} title="Members" onBack=${onBack} />
      <${ApprovalQueue} memberships=${memberships} myProfileId=${session.user.id} onMembershipSaved=${patchMembership} />
    </div>
  `;
}
