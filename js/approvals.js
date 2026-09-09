import { html, useState, useEffect } from './lib.js';
import { supabase } from './supabaseClient.js';
import { decideMembership } from './store.js';

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

function MemberRow({ membership, profile, myProfileId, onAction }) {
  const [busy, setBusy] = useState(false);
  const name = profile?.display_name || 'Unknown';
  const email = profile?.google_email || '';
  const isSelf = membership.profile_id === myProfileId;

  const act = async (fn) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };

  return html`
    <div class="card" style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
      <div>
        <div style=${{ fontWeight: 700 }}>${name}${isSelf ? ' (you)' : ''}</div>
        <div style=${{ fontSize: '13px', color: 'var(--ink-soft)' }}>${email}</div>
      </div>
      <div style=${{ display: 'flex', gap: '8px' }}>
        ${membership.status === 'pending' ? html`
          <button class="btn-icon" disabled=${busy || isSelf} onClick=${() => act(() => onAction(membership.profile_id, { status: 'active' }))}>Approve</button>
          <button class="btn-icon" disabled=${busy || isSelf} onClick=${() => act(() => onAction(membership.profile_id, { status: 'declined' }))}>Decline</button>
        ` : membership.status === 'active' ? html`
          <button class="btn-icon" disabled=${busy || isSelf} onClick=${() => act(() => onAction(membership.profile_id, { status: 'deactivated' }))}>Deactivate</button>
        ` : html`
          <button class="btn-icon" disabled=${busy || isSelf} onClick=${() => act(() => onAction(membership.profile_id, { status: 'active' }))}>Reactivate</button>
        `}
      </div>
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

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const approveSelected = async () => {
    setBulking(true);
    await Promise.all([...selected].map((id) => doDecide(id, { status: 'active' })));
    setSelected(new Set());
    setBulking(false);
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
      ${pending.length === 0 ? html`<p class="empty-state">No pending requests.</p>` : pending.map((m) => html`
        <div key=${m.id} style=${{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input type="checkbox" checked=${selected.has(m.profile_id)} onChange=${() => toggle(m.profile_id)} style=${{ flexShrink: 0 }} />
          <div style=${{ flex: 1 }}>
            <${MemberRow} membership=${m} profile=${profilesById[m.profile_id]} myProfileId=${myProfileId} onAction=${doDecide} />
          </div>
        </div>
      `)}

      <h2 class="section-header-secondary">Active members</h2>
      ${active.length === 0 ? html`<p class="empty-state">Nobody active yet.</p>` : active.map((m) => html`
        <${MemberRow} key=${m.id} membership=${m} profile=${profilesById[m.profile_id]} myProfileId=${myProfileId} onAction=${doDecide} />
      `)}

      ${other.length > 0 ? html`
        <h2 class="section-header-secondary">Declined / deactivated</h2>
        ${other.map((m) => html`
          <${MemberRow} key=${m.id} membership=${m} profile=${profilesById[m.profile_id]} myProfileId=${myProfileId} onAction=${doDecide} />
        `)}
      ` : null}
    </div>
  `;
}
