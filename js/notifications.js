import { html, useState } from './lib.js';
import { sendAdminNotification } from './store.js';
import { IconBack } from './icons.js';

// Admin > Notifications (2026-09-28). Nina's call: no personal "send myself a test" button —
// this IS the real send-to-everyone feature, and a genuine send doubles as the test if she wants
// one. Broadcasts to every member who currently has push enabled (has a push_subscriptions row) —
// there is no audience picker, matching "if any admins want to communicate to people" as stated.
// See supabase/functions/send-admin-notification.
const AdminHeadNotifications = ({ title, onBack }) => html`
  <div class="detail-head">
    <button class="icon-btn" aria-label="Back to Admin" onClick=${onBack}>
      <${IconBack} size=${20} />
    </button>
    <h2 class="admin-head-title">${title}</h2>
  </div>
`;

export function AdminNotifications({ onBack }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const ready = title.trim().length > 0 && body.trim().length > 0;

  const send = async () => {
    setBusy(true); setError(null); setResult(null);
    const { data, error: err } = await sendAdminNotification({ title: title.trim(), body: body.trim() });
    setBusy(false);
    setConfirming(false);
    if (err) { setError(err.message || 'Could not send the notification.'); return; }
    if (!data?.ok && data?.totalRecipients === 0) {
      setError('No members have notifications turned on yet.');
      return;
    }
    setResult(data);
    setTitle('');
    setBody('');
  };

  return html`
    <div class="tab-content">
      <${AdminHeadNotifications} title="Notifications" onBack=${onBack} />

      <div class="card" style="margin-bottom:14px;">
        <p class="form-hint" style="margin:0 0 12px;">
          Sends a real push notification to every member who currently has notifications turned
          on. There's no drafts or scheduling yet — this goes out the moment you send it.
        </p>

        <label style="display:block;margin-bottom:12px;">
          Title
          <input type="text" maxlength="80" value=${title} disabled=${busy}
            placeholder="e.g. Rehearsal moved to Sth Yarra" onInput=${(e) => setTitle(e.target.value)} />
        </label>

        <label style="display:block;margin-bottom:12px;">
          Message
          <textarea rows="4" maxlength="500" value=${body} disabled=${busy}
            placeholder="What do people need to know?" onInput=${(e) => setBody(e.target.value)}></textarea>
        </label>

        ${!confirming ? html`
          <button class="btn btn-primary" style="width:100%;" disabled=${!ready || busy}
            onClick=${() => setConfirming(true)}>
            Send to all members
          </button>
        ` : html`
          <div class="card" style="background:var(--purple-light);margin:0;box-shadow:none;">
            <p style="margin:0 0 12px;">Send this now? Every member with notifications on will get it immediately.</p>
            <div class="form-actions">
              <button class="btn btn-primary btn-sm" disabled=${busy} onClick=${send}>
                ${busy ? 'Sending…' : 'Yes, send it'}
              </button>
              <button class="btn-quiet" disabled=${busy} onClick=${() => setConfirming(false)}>Cancel</button>
            </div>
          </div>
        `}

        ${result ? html`
          <p class="form-saved" style="margin-top:12px;">
            Sent to ${result.sentCount} of ${result.totalRecipients} member${result.totalRecipients === 1 ? '' : 's'} with notifications on.
            ${result.failedCount > 0 ? html`${result.failedCount} failed to deliver.` : null}
          </p>
        ` : null}
        ${error ? html`<p class="absence-error" style="margin-top:12px;">${error}</p>` : null}
      </div>
    </div>
  `;
}
