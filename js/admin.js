import { html, useState, useMemo } from './lib.js';
import { todayStr } from './lib.js';
import { AdminMembers } from './members.js';
import { AdminAttendance } from './attendance.js';
import { EventRow, EventForm } from './events.js';
import { AdminInvoices } from './invoices.js';
import { AdminNotifications } from './notifications.js';
import { EmptyState, LoadingState } from './shell.js';
import { IconCalendar, IconUsers, IconCheckSquare, IconBell, IconAdmin, IconCrown, IconInvoice,
  IconChevron, IconBack, IconCheck } from './icons.js';

// The organiser console. Everything an organiser does lives here, so the member-facing screens
// (Home, Calendar, More) read identically whether you're staff or not — which is the whole
// point: Nina can judge the member experience without a second account, and can't cancel a
// rehearsal by mis-tapping while browsing.
//
// Hiding a section here is presentation only. Every action below is still enforced by RLS/the
// underlying functions — an admin who somehow reached the Invoices screen could look at it and
// change nothing, since that data/those RPCs are Super-Admin-gated server-side (migrations
// 0028-0030). superOnly here just keeps a plain admin from being shown a dead end.
const SECTIONS = [
  { key: 'events', label: 'Events', Icon: IconCalendar,
    body: 'Create, edit and manage all choir events and rehearsals.' },
  { key: 'members', label: 'Members', Icon: IconUsers,
    body: 'View and manage choir members and membership requests.' },
  // Listed but not built, deliberately: showing the shape of the console is useful, and each of
  // these is real work rather than a screen waiting to be drawn.
  { key: 'attendance', label: 'Attendance', Icon: IconCheckSquare,
    body: 'View and manage member attendance.' },
  { key: 'invoices', label: 'Invoices', Icon: IconInvoice,
    body: 'Generate term invoices and manage invoice numbering.', superOnly: true },
  { key: 'notifications', label: 'Notifications', Icon: IconBell,
    body: 'Send a push notification to your choir.' },
  { key: 'settings', label: 'Settings', Icon: IconAdmin,
    body: 'Update choir details, term dates and preferences.', soon: true },
];

export function AdminTab({
  session, isSuperAdmin, view, setView, events, eventsLoading, terms, onEventSaved,
  directory, checkins, absences, awayDates, onCheckinSaved, onCheckinRemoved,
}) {
  if (view?.section === 'events') {
    return html`<${AdminEvents} events=${events} loading=${eventsLoading} terms=${terms}
      initialEditId=${view.editId || null} onBack=${() => setView(null)} onEventSaved=${onEventSaved} />`;
  }
  if (view?.section === 'members') {
    return html`<${AdminMembers} session=${session} isSuperAdmin=${isSuperAdmin} onBack=${() => setView(null)} />`;
  }
  if (view?.section === 'attendance') {
    return html`<${AdminAttendance} session=${session} events=${events} checkins=${checkins}
      absences=${absences} awayDates=${awayDates} terms=${terms}
      onCheckinSaved=${onCheckinSaved} onCheckinRemoved=${onCheckinRemoved}
      onBack=${() => setView(null)} />`;
  }
  // Defense in depth on top of RLS: a plain admin who navigates here directly (e.g. a stale
  // deep-link from before a demotion) sees the same "not available" state as any other
  // super-only section, not a screen that quietly does nothing when they tap a button.
  if (view?.section === 'invoices' && isSuperAdmin) {
    return html`<${AdminInvoices} terms=${terms} directory=${directory} profileId=${session.user.id}
      onBack=${() => setView(null)} />`;
  }
  if (view?.section === 'notifications') {
    return html`<${AdminNotifications} onBack=${() => setView(null)} />`;
  }
  if (view?.section) {
    const section = SECTIONS.find((s) => s.key === view.section);
    return html`
      <div class="tab-content">
        <${AdminHead} title=${section?.label || 'Admin'} onBack=${() => setView(null)} />
        <${EmptyState} title=${section?.superOnly && !isSuperAdmin ? 'Super Admin only' : 'Not built yet'}
          body=${section?.superOnly && !isSuperAdmin
            ? 'Invoicing is only available to Super Admins.'
            : `${section?.body || ''} This is next on the list rather than a screen waiting to be filled in.`} />
      </div>
    `;
  }

  const visibleSections = SECTIONS.filter((s) => !s.superOnly || isSuperAdmin);

  return html`
    <div class="tab-content">
      <h2>Admin</h2>
      <p class="admin-intro">Manage your choir, events and members.</p>
      <div class="admin-menu">
        ${visibleSections.map((s) => html`
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
          <p class="super-card-title">${isSuperAdmin ? 'Super Admin access' : 'Admin access'}</p>
          <p class="super-card-body">
            ${isSuperAdmin
              ? 'You have full administrative access to Sonario, including invoicing and roles.'
              : 'You have administrative access to Sonario. Invoicing and role changes are Super Admin only.'}
          </p>
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

