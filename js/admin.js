import { html, useState, useMemo } from './lib.js';
import { todayStr } from './lib.js';
import { ApprovalQueue } from './approvals.js';
import { useAllMemberships } from './store.js';
import { EventRow, EventForm } from './events.js';
import { EmptyState, LoadingState } from './shell.js';
import { IconCalendar, IconUsers, IconCheckSquare, IconBell, IconAdmin, IconCrown,
  IconChevron, IconBack } from './icons.js';

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
    body: 'View attendance, check-ins and absence reports.', soon: true },
  { key: 'notifications', label: 'Notifications', Icon: IconBell,
    body: 'Send and schedule messages to your choir.', soon: true },
  { key: 'settings', label: 'Settings', Icon: IconAdmin,
    body: 'Update choir details, term dates and preferences.', soon: true },
];

export function AdminTab({ session, view, setView, events, eventsLoading, terms }) {
  if (view?.section === 'events') {
    return html`<${AdminEvents} events=${events} loading=${eventsLoading} terms=${terms}
      initialEditId=${view.editId || null} onBack=${() => setView(null)} />`;
  }
  if (view?.section === 'members') {
    return html`<${AdminMembers} session=${session} onBack=${() => setView(null)} />`;
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
function AdminEvents({ events, loading, terms, initialEditId, onBack }) {
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
          onDone=${() => setEditing(null)} />
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
// Admin > Members. The approval queue, moved off the More tab so More reads the same for
// everyone. Promoting a member to super is NOT here yet — it needs care around the policy that
// stops anyone approving or promoting themselves, so it's its own piece of work.
// ---------------------------------------------------------------------------
function AdminMembers({ session, onBack }) {
  const { memberships } = useAllMemberships();

  return html`
    <div class="tab-content">
      <${AdminHead} title="Members" onBack=${onBack} />
      <${ApprovalQueue} memberships=${memberships} myProfileId=${session.user.id} />
    </div>
  `;
}
