import { html, useState } from './lib.js';
import { supabase } from './supabaseClient.js';

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function NoticeCard({ notice, displayName, canManage }) {
  const canDelete = canManage || notice.author_name === displayName;

  const togglePin = async () => {
    await supabase.from('notices').update({ pinned: !notice.pinned }).eq('id', notice.id);
  };
  const remove = async () => {
    if (!confirm('Delete this notice?')) return;
    await supabase.from('notices').delete().eq('id', notice.id);
  };

  return html`
    <div class=${'card notice-card' + (notice.pinned ? ' pinned' : '')}>
      <div class="notice-card-header">
        <div class="notice-author">${notice.author_name}</div>
        <div class="notice-time">${notice.pinned ? html`<span class="pin-badge">Pinned</span>` : null} ${timeAgo(notice.created_at)}</div>
      </div>
      <p class="notice-message">${notice.message}</p>
      ${(canManage || canDelete) ? html`
        <div class="card-admin-actions">
          ${canManage ? html`<button class="btn-icon" onClick=${togglePin}>${notice.pinned ? 'Unpin' : 'Pin'}</button>` : null}
          ${canDelete ? html`<button class="btn-icon" onClick=${remove}>Delete</button>` : null}
        </div>
      ` : null}
    </div>
  `;
}

export function NoticeBoard({ notices, displayName, canManage }) {
  const [message, setMessage] = useState('');
  const [posting, setPosting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) return;
    setPosting(true);
    await supabase.from('notices').insert({ author_name: displayName, message: trimmed });
    setMessage('');
    setPosting(false);
  };

  return html`
    <div class="tab-content">
      <h2>Notice board</h2>
      <form onSubmit=${submit} class="card form-card">
        <textarea
          value=${message}
          onInput=${(e) => setMessage(e.target.value)}
          placeholder="Post an announcement…"
          rows="3"
        />
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" disabled=${posting || !message.trim()}>${posting ? 'Posting…' : 'Post'}</button>
        </div>
      </form>
      ${notices.length === 0 ? html`<p class="empty-state">No notices yet.</p>` : null}
      ${notices.map((n) => html`<${NoticeCard} key=${n.id} notice=${n} displayName=${displayName} canManage=${canManage} />`)}
    </div>
  `;
}
