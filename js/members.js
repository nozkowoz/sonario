import { html, useState, useEffect } from './lib.js';
import { supabase } from './supabaseClient.js';
import { displayNameOf, decideMembership, setMemberRole, useAllMemberships } from './store.js';
import { EmptyState } from './shell.js';
import { IconBack, IconChevron, IconSearch } from './icons.js';

// Admin > Members (2026-09-28 redesign, per Nina's mockup). Replaces approvals.js's flat
// Pending/Active/Declined-or-deactivated list with tabs + search + a real drill-in detail
// screen. "Add member" from the mockup is deliberately NOT here — there's no way to create a
// member without them signing in first (handle_new_auth_user only ever fires from a real
// auth.users insert), so a button with nothing behind it would just be a dead end.
//
// Two mockup details deliberately NOT built, both permissions-driven rather than oversights:
//   - Email is read-only in Contact details. It comes from the identity provider (same reasoning
//     as My Profile in more.js) — editing it here wouldn't change how the person signs in, so it
//     would just create a mismatch between what Sonario shows and what Google actually has.
//   - Name is ALSO read-only here, for a more mundane reason: `update own profile` on
//     sonario.profiles is `id = auth.uid()` only — no super bypass exists. Building an editable
//     name field for someone else's profile would need a new RLS policy, which felt like a
//     bigger call to make silently than the mockup implied. Flag if this is wanted for real.
//
// Status is deliberately NOT a raw dropdown, even though the mockup shows one: jumping straight
// from Active to Declined in one careless select is exactly the kind of mistap MemberRow's
// existing two-step promote/demote confirm was built to prevent. Same actions as before
// (Approve/Decline/Deactivate/Reactivate), just grouped under one "Access & status" card instead
// of scattered, plus a distinct danger-zone card for the irreversible-feeling ones.

function useProfilesById(ids) {
  const [byId, setById] = useState({});
  const key = ids.slice().sort().join(',');

  useEffect(() => {
    if (!ids.length) return;
    let cancelled = false;
    supabase.from('profiles').select('*').in('id', ids).then(({ data }) => {
      if (!cancelled && data) setById(Object.fromEntries(data.map((p) => [p.id, p])));
    });
    return () => { cancelled = true; };
  }, [key]);

  return byId;
}

const initialsOf = (profile) => {
  const first = (profile?.first_name || displayNameOf(profile) || '?').trim()[0] || '?';
  const last = (profile?.last_name || '').trim()[0] || '';
  return (first + last).toUpperCase();
};

const joinedDateText = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

const AdminHeadMembers = ({ title, onBack }) => html`
  <div class="detail-head">
    <button class="icon-btn" aria-label="Back to Admin" onClick=${onBack}>
      <${IconBack} size=${20} />
    </button>
    <h2 class="admin-head-title">${title}</h2>
  </div>
`;

function MemberListRow({ membership, profile, myProfileId, onOpen }) {
  const isSelf = membership.profile_id === myProfileId;
  const isSuper = membership.role === 'super';
  return html`
    <button class="card member-row" onClick=${() => onOpen(membership)}>
      <span class="member-avatar" aria-hidden="true" style="flex-shrink:0;">${initialsOf(profile)}</span>
      <div class="member-row-main">
        <div class="member-row-name">
          ${displayNameOf(profile) || 'Unknown'}${isSelf ? ' (you)' : ''}
          ${isSuper ? html`<span class="event-type-badge role-badge">Super</span>` : null}
        </div>
        ${profile?.google_email ? html`<div class="member-row-email">${profile.google_email}</div>` : null}
      </div>
      <${IconChevron} size=${18} />
    </button>
  `;
}

function PendingPreviewCard({ pending, profilesById, onViewAll }) {
  if (pending.length === 0) return null;
  const first = pending[0];
  const profile = profilesById[first.profile_id];
  return html`
    <div class="card" style="margin-bottom:16px;">
      <div class="section-header" style="margin-bottom:10px;">
        <p style="margin:0;font-weight:700;">Pending requests</p>
        <button class="btn-quiet" onClick=${onViewAll}>View all ${pending.length > 1 ? `(${pending.length})` : ''} ›</button>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="member-avatar" aria-hidden="true">${initialsOf(profile)}</span>
        <div style="flex:1;min-width:0;">
          <div class="member-row-name">${displayNameOf(profile) || 'Unknown'}</div>
          ${profile?.google_email ? html`<div class="member-row-email">${profile.google_email}</div>` : null}
        </div>
      </div>
    </div>
  `;
}

export function AdminMembers({ session, onBack }) {
  const { memberships, patchMembership } = useAllMemberships();
  const [tab, setTab] = useState('active'); // 'active' | 'pending' | 'deactivated'
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);

  const ids = memberships.map((m) => m.profile_id);
  const profilesById = useProfilesById(ids);
  const myProfileId = session.user.id;

  const pending = memberships.filter((m) => m.status === 'pending');
  const active = memberships.filter((m) => m.status === 'active');
  const deactivated = memberships.filter((m) => m.status === 'declined' || m.status === 'deactivated');

  const byTab = tab === 'active' ? active : tab === 'pending' ? pending : deactivated;
  const q = query.trim().toLowerCase();
  const visible = q
    ? byTab.filter((m) => {
        const p = profilesById[m.profile_id];
        return (displayNameOf(p) || '').toLowerCase().includes(q)
          || (p?.google_email || '').toLowerCase().includes(q);
      })
    : byTab;

  const openMembership = openId ? memberships.find((m) => m.id === openId) : null;

  if (openMembership) {
    return html`<${MemberDetail} membership=${openMembership} profile=${profilesById[openMembership.profile_id]}
      myProfileId=${myProfileId} onBack=${() => setOpenId(null)} onMembershipSaved=${patchMembership} />`;
  }

  return html`
    <div class="tab-content">
      <${AdminHeadMembers} title="Members" onBack=${onBack} />
      <p class="form-hint" style="margin:0 0 16px;">
        Manage choir members, pending requests and access permissions.
      </p>

      <div class="chips" style="margin-bottom:14px;">
        <button class=${`chip ${tab === 'active' ? 'chip-on' : ''}`} onClick=${() => setTab('active')}>Active</button>
        <button class=${`chip ${tab === 'pending' ? 'chip-on' : ''}`} onClick=${() => setTab('pending')}>
          Pending${pending.length > 0 ? ` (${pending.length})` : ''}
        </button>
        <button class=${`chip ${tab === 'deactivated' ? 'chip-on' : ''}`} onClick=${() => setTab('deactivated')}>Deactivated</button>
      </div>

      <div style="position:relative;margin-bottom:16px;">
        <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--fig-mute);">
          <${IconSearch} size=${16} />
        </span>
        <input type="search" value=${query} placeholder="Search members…" style="padding-left:36px;"
          onInput=${(e) => setQuery(e.target.value)} />
      </div>

      ${tab === 'active' ? html`<${PendingPreviewCard} pending=${pending} profilesById=${profilesById}
        onViewAll=${() => setTab('pending')} />` : null}

      <div class="section-header" style="margin-bottom:10px;">
        <p style="margin:0;font-weight:700;">
          ${tab === 'active' ? 'Active members' : tab === 'pending' ? 'Pending requests' : 'Declined / deactivated'}
        </p>
        <span class="form-hint">${visible.length} member${visible.length === 1 ? '' : 's'}</span>
      </div>

      ${visible.length === 0
        ? html`<${EmptyState} title="No members here" body=${q ? 'No one matches that search.' : 'Nothing to show yet.'} />`
        : visible.map((m) => html`<${MemberListRow} key=${m.id} membership=${m}
            profile=${profilesById[m.profile_id]} myProfileId=${myProfileId}
            onOpen=${(mm) => setOpenId(mm.id)} />`)}
    </div>
  `;
}

// --- Member detail -----------------------------------------------------------
function MemberDetail({ membership, profile, myProfileId, onBack, onMembershipSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmingRole, setConfirmingRole] = useState(null); // null | 'promote' | 'demote'
  const isSelf = membership.profile_id === myProfileId;
  const isSuper = membership.role === 'super';

  const act = async (fn) => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await fn();
    setBusy(false);
    setConfirmingRole(null);
    if (err) { setError(err.message); return; }
    if (!data || data.length === 0) {
      setError("That didn't save — check you still have organiser access.");
      return;
    }
    onMembershipSaved?.(data[0]);
  };

  const doDecide = (patch) => act(() => decideMembership(membership.profile_id, patch, myProfileId));
  const doRole = (role) => act(() => setMemberRole(membership.profile_id, role, myProfileId));

  return html`
    <div class="tab-content">
      <${AdminHeadMembers} title="Member details" onBack=${onBack} />

      <div class="card" style="margin-bottom:16px;display:flex;align-items:center;gap:12px;">
        <span class="member-avatar" aria-hidden="true">${initialsOf(profile)}</span>
        <div style="min-width:0;">
          <div class="member-row-name" style="font-size:16px;">
            ${displayNameOf(profile) || 'Unknown'}${isSelf ? ' (you)' : ''}
            ${isSuper ? html`<span class="event-type-badge role-badge">Super</span>` : null}
          </div>
          ${profile?.google_email ? html`<div class="member-row-email">${profile.google_email}</div>` : null}
          ${joinedDateText(membership.requested_at) ? html`
            <div class="form-hint" style="margin-top:2px;">Joined ${joinedDateText(membership.requested_at)}</div>
          ` : null}
        </div>
      </div>

      ${error ? html`<p class="absence-error">${error}</p>` : null}

      <div class="card" style="margin-bottom:16px;">
        <p style="margin:0 0 12px;font-weight:700;">Access &amp; status</p>

        ${membership.status === 'pending' ? html`
          <div class="form-actions">
            <button class="btn btn-primary btn-sm" disabled=${busy || isSelf} onClick=${() => doDecide({ status: 'active' })}>Approve</button>
            <button class="btn-quiet" disabled=${busy || isSelf} onClick=${() => doDecide({ status: 'declined' })}>Decline</button>
          </div>
        ` : html`
          <p class="form-hint" style="margin:0 0 14px;">
            Status: <strong style="color:var(--fig-ink);">${membership.status === 'active' ? 'Active' : membership.status === 'declined' ? 'Declined' : 'Deactivated'}</strong>
          </p>
        `}

        ${membership.status === 'active' ? html`
          <div style="border-top:1px solid var(--border);margin-top:${membership.status === 'pending' ? '14px' : '0'};padding-top:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div>
              <p style="margin:0;font-weight:600;">Super user</p>
              <p class="form-hint" style="margin:2px 0 0;">
                Super users can manage members, send notifications and access admin features.
              </p>
            </div>
            <label class="switch">
              <input type="checkbox" checked=${isSuper} disabled=${busy || isSelf}
                onChange=${() => setConfirmingRole(isSuper ? 'demote' : 'promote')} />
              <span class="switch-track"></span>
            </label>
          </div>
        ` : null}

        ${confirmingRole ? html`
          <div class="card" style="background:var(--purple-light);box-shadow:none;margin-top:14px;">
            <p style="margin:0 0 12px;">
              ${confirmingRole === 'promote'
                ? html`Give <strong>${displayNameOf(profile)}</strong> full organiser access?`
                : html`Remove organiser access from <strong>${displayNameOf(profile)}</strong>?`}
            </p>
            <div class="form-actions">
              <button class="btn btn-primary btn-sm" disabled=${busy}
                onClick=${() => doRole(confirmingRole === 'promote' ? 'super' : 'member')}>
                ${busy ? 'Saving…' : confirmingRole === 'promote' ? 'Yes, make super' : 'Yes, remove'}
              </button>
              <button class="btn-quiet" disabled=${busy} onClick=${() => setConfirmingRole(null)}>Cancel</button>
            </div>
          </div>
        ` : null}
      </div>

      <div class="card" style="margin-bottom:16px;">
        <p style="margin:0 0 12px;font-weight:700;">Contact details</p>
        <label>
          Name
          <input type="text" value=${displayNameOf(profile)} disabled />
        </label>
        <label>
          Email
          <input type="text" value=${profile?.google_email || '—'} disabled />
        </label>
        <p class="form-hint" style="margin:8px 0 0;">
          Set from however they signed in — not editable here.
        </p>
      </div>

      ${!isSelf && (membership.status === 'active' || membership.status === 'declined' || membership.status === 'deactivated') ? html`
        <div class=${`card ${membership.status === 'active' ? 'danger-card' : ''}`} style="margin-bottom:16px;">
          ${membership.status === 'active' ? html`
            <p style="margin:0 0 6px;font-weight:700;color:var(--error);">Deactivate member</p>
            <p class="form-hint" style="margin:0 0 12px;">
              This will remove ${displayNameOf(profile)}'s access to Sonario. Their data will be retained.
            </p>
            <button class="btn btn-danger" disabled=${busy} onClick=${() => doDecide({ status: 'deactivated' })}>
              Deactivate member
            </button>
          ` : html`
            <p style="margin:0 0 6px;font-weight:700;">Reactivate member</p>
            <p class="form-hint" style="margin:0 0 12px;">Restore ${displayNameOf(profile)}'s access to Sonario.</p>
            <button class="btn btn-outline" disabled=${busy} onClick=${() => doDecide({ status: 'active' })}>
              Reactivate member
            </button>
          `}
        </div>
      ` : null}
    </div>
  `;
}
