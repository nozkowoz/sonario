import { html, useState, useEffect } from './lib.js';
import { supabase } from './supabaseClient.js';
import { decideMembership, setMemberRole } from './store.js';

// Super-only. `memberships` rows don't carry display_name/email themselves (those live on
// `profiles`) — join client-side against a profiles lookup rather than a second query per row.
// Small counts (a choir's membership list), so refetching on every id-set change is fine.
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

function MemberRow({ membership, profile, myProfileId, onAction, onRole }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(null); // null | 'promote' | 'demote'
  const name = profile?.display_name || 'Unknown';
  const email = profile?.google_email || '';
  const isSelf = membership.profile_id === myProfileId;
  const isSuper = membership.role === 'super';

  // An RLS-blocked UPDATE returns no error and no rows, so silence isn't success — the same trap
  // already found twice elsewhere in this codebase. Every action here now reports a failure.
  const act = async (fn) => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await fn();
    setBusy(false);
    setConfirming(null);
    if (err) { setError(err.message); return; }
    if (!data || data.length === 0) {
      setError("That didn't save — check you still have organiser access.");
    }
  };

  return html`
    <div class="card member-row">
      <div class="member-row-main">
        <div class="member-row-name">
          ${name}${isSelf ? ' (you)' : ''}
          ${isSuper ? html`<span class="event-type-badge role-badge">Super</span>` : null}
        </div>
        ${email ? html`<div class="member-row-email">${email}</div>` : null}
        ${error ? html`<p class="absence-error">${error}</p>` : null}
      </div>

      ${confirming ? html`
        <div class="member-confirm">
          <p class="member-confirm-text">
            ${confirming === 'promote'
              ? html`Give <strong>${name}</strong> full organiser access?`
              : html`Remove organiser access from <strong>${name}</strong>?`}
          </p>
          <div class="member-row-actions">
            <button class="btn-icon" disabled=${busy}
              onClick=${() => act(() => onRole(membership.profile_id, confirming === 'promote' ? 'super' : 'member'))}>
              ${busy ? 'Saving…' : confirming === 'promote' ? 'Yes, make super' : 'Yes, remove'}
            </button>
            <button class="btn-quiet" disabled=${busy} onClick=${() => setConfirming(null)}>Cancel</button>
          </div>
        </div>
      ` : html`
        <div class="member-row-actions">
          ${membership.status === 'pending' ? html`
            <button class="btn-icon" disabled=${busy || isSelf}
              onClick=${() => act(() => onAction(membership.profile_id, { status: 'active' }))}>Approve</button>
            <button class="btn-icon" disabled=${busy || isSelf}
              onClick=${() => act(() => onAction(membership.profile_id, { status: 'declined' }))}>Decline</button>
          ` : membership.status === 'active' ? html`
            ${/* Promotion is a two-step: full organiser access is not something to hand over on a
                  mistap, and there's no undo beyond doing it again in reverse. */ ''}
            <button class="btn-icon" disabled=${busy || isSelf}
              onClick=${() => setConfirming(isSuper ? 'demote' : 'promote')}>
              ${isSuper ? 'Remove super' : 'Make super'}
            </button>
            <button class="btn-icon" disabled=${busy || isSelf}
              onClick=${() => act(() => onAction(membership.profile_id, { status: 'deactivated' }))}>Deactivate</button>
          ` : html`
            <button class="btn-icon" disabled=${busy || isSelf}
              onClick=${() => act(() => onAction(membership.profile_id, { status: 'active' }))}>Reactivate</button>
          `}
        </div>
      `}
    </div>
  `;
}

export function ApprovalQueue({ memberships, myProfileId }) {
  const [selected, setSelected] = useState(new Set());
  const [bulking, setBulking] = useState(false);

  const ids = memberships.map((m) => m.profile_id);
  const profilesById = useProfilesById(ids);

  const pending = memberships.filter((m) => m.status === 'pending');
  const active = memberships.filter((m) => m.status === 'active');
  const other = memberships.filter((m) => m.status === 'declined' || m.status === 'deactivated');

  const doDecide = (profileId, patch) => decideMembership(profileId, patch, myProfileId);
  const doRole = (profileId, role) => setMemberRole(profileId, role, myProfileId);

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const [bulkError, setBulkError] = useState(null);

  const approveSelected = async () => {
    setBulking(true);
    setBulkError(null);
    const results = await Promise.all([...selected].map((id) => doDecide(id, { status: 'active' })));
    // Same "no error, no rows" trap as the single actions: count what actually landed.
    const failed = results.filter((r) => r.error || !r.data || r.data.length === 0).length;
    setSelected(new Set());
    setBulking(false);
    if (failed) setBulkError(`${failed} of ${results.length} couldn't be approved — check you still have organiser access.`);
  };

  return html`
    <div class="tab-content">
      <div class="section-header">
        <h2>Pending requests</h2>
        ${selected.size > 0 ? html`
          <button class="btn btn-primary" disabled=${bulking} onClick=${approveSelected}>
            ${bulking ? 'Approving…' : `Approve selected (${selected.size})`}
          </button>
        ` : null}
      </div>
      ${bulkError ? html`<p class="absence-error">${bulkError}</p>` : null}
      ${pending.length === 0 ? html`<p class="empty-state">No pending requests.</p>` : pending.map((m) => html`
        <div key=${m.id} style=${{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input type="checkbox" checked=${selected.has(m.profile_id)} onChange=${() => toggle(m.profile_id)} style=${{ flexShrink: 0 }} />
          <div style=${{ flex: 1 }}>
            <${MemberRow} membership=${m} profile=${profilesById[m.profile_id]} myProfileId=${myProfileId} onAction=${doDecide} onRole=${doRole} />
          </div>
        </div>
      `)}

      <h2 class="section-header-secondary">Active members</h2>
      ${active.length === 0 ? html`<p class="empty-state">Nobody active yet.</p>` : active.map((m) => html`
        <${MemberRow} key=${m.id} membership=${m} profile=${profilesById[m.profile_id]} myProfileId=${myProfileId} onAction=${doDecide} onRole=${doRole} />
      `)}

      ${other.length > 0 ? html`
        <h2 class="section-header-secondary">Declined / deactivated</h2>
        ${other.map((m) => html`
          <${MemberRow} key=${m.id} membership=${m} profile=${profilesById[m.profile_id]} myProfileId=${myProfileId} onAction=${doDecide} onRole=${doRole} />
        `)}
      ` : null}
    </div>
  `;
}
