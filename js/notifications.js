import { html, useState } from './lib.js';
import { sendAdminNotification, useNotifiableMemberCount } from './store.js';
import { Sheet } from './shell.js';
import { IconBack, IconSend } from './icons.js';

// Admin > Notifications (2026-09-28, redesigned same day per Nina's spec). No personal
// "send myself a test" button — this IS the real send-to-everyone feature, and a genuine send
// doubles as the test if she wants one. Broadcasts to every member who currently has push enabled
// (has a push_subscriptions row) — there is no audience picker, matching "recipient scope remains
// all enabled members only" from her spec. See supabase/functions/send-admin-notification.
//
// Naming: the Admin menu entry is "Notifications" (admin.js), this composer screen is
// "Send Notification" — deliberately different, so that when a "Recent notifications" list gets
// built later (reading notification_log, type='admin_broadcast'), it sits alongside this as a
// sibling under the same "Notifications" section rather than needing a rename.
const AdminHeadNotifications = ({ title, onBack }) => html`
  <div class="detail-head">
    <button class="icon-btn" aria-label="Back to Admin" onClick=${onBack}>
      <${IconBack} size=${20} />
    </button>
    <h2 class="admin-head-title">${title}</h2>
  </div>
`;

function NotificationPreview({ title, body }) {
  return html`
    <div class="notif-preview">
      <img src="icons/icon-192.png" class="notif-preview-icon" alt="" />
      <div class="notif-preview-text">
        <div class="notif-preview-row">
          <span class="notif-preview-title">${title || 'Notification title'}</span>
          <span class="notif-preview-now">now</span>
        </div>
        <p class="notif-preview-body">${body || 'Your message will appear here'}</p>
      </div>
    </div>
  `;
}

function ConfirmSendSheet({ recipientCount, busy, onConfirm, onCancel }) {
  return html`
    <${Sheet} label="Send this notification?" onClose=${onCancel}>
      <h3 class="form-heading">Send this notification?</h3>
      <p style="margin:0 0 18px;">
        This will be sent immediately to ${recipientCount} member${recipientCount === 1 ? '' : 's'}
        and cannot be recalled.
      </p>
      <div class="form-actions">
        <button class="btn-quiet" disabled=${busy} onClick=${onCancel}>Cancel</button>
        <button class="btn btn-primary" disabled=${busy} onClick=${onConfirm}>
          ${busy ? 'Sending…' : 'Send now'}
        </button>
      </div>
    </${Sheet}>
  `;
}

export function AdminNotifications({ onBack }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { sentCount, failedCount, totalRecipients } | null
  const { count: recipientCount, error: countError } = useNotifiableMemberCount();

  const ready = title.trim().length > 0 && body.trim().length > 0;

  const send = async () => {
    setBusy(true);
    setError(null);
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

  if (result) {
    return html`
      <div class="tab-content">
        <${AdminHeadNotifications} title="Send Notification" onBack=${onBack} />
        <div class="card" style="text-align:center;">
          <p style="margin:0 0 6px;font-weight:700;font-size:16px;">
            Notification sent to ${result.sentCount} member${result.sentCount === 1 ? '' : 's'}
          </p>
          ${result.failedCount > 0
            ? html`<p class="form-hint" style="margin:0 0 14px;">${result.failedCount} failed to deliver.</p>`
            : null}
          <button class="btn btn-outline" onClick=${() => setResult(null)}>Send another</button>
        </div>
      </div>
    `;
  }

  return html`
    <div class="tab-content">
      <${AdminHeadNotifications} title="Send Notification" onBack=${onBack} />
      <p class="form-hint" style="margin:0 0 18px;">
        Send a push notification to members with notifications enabled.
      </p>

      <div class="card" style="margin-bottom:14px;">
        <div class="step-row">
          <span class="step-num">1</span>
          <div>
            <p style="margin:0;font-weight:700;">Notification preview</p>
            <p class="form-hint" style="margin:0;">This is how it will appear on members' devices.</p>
          </div>
        </div>
        <${NotificationPreview} title=${title} body=${body} />
      </div>

      <div class="card" style="margin-bottom:14px;">
        <div class="step-row">
          <span class="step-num">2</span>
          <div>
            <p style="margin:0;font-weight:700;">Notification content</p>
            <p class="form-hint" style="margin:0;">Keep it short and clear — this will appear on members' devices.</p>
          </div>
        </div>
        <label>
          <div class="field-label-row"><span>Title *</span><span class="form-hint">${title.length}/80</span></div>
          <input type="text" maxlength="80" value=${title} disabled=${busy}
            placeholder="e.g. Rehearsal Tonight" onInput=${(e) => setTitle(e.target.value)} />
        </label>
        <p class="form-hint" style="margin:4px 0 12px;">
          A short, clear title (e.g. Rehearsal Tonight, Location Change)
        </p>
        <label>
          <div class="field-label-row"><span>Message *</span><span class="form-hint">${body.length}/500</span></div>
          <textarea rows="4" maxlength="500" value=${body} disabled=${busy}
            placeholder="What do people need to know?" onInput=${(e) => setBody(e.target.value)}></textarea>
        </label>
        <p class="form-hint" style="margin:4px 0 0;">
          Keep it brief and to the point. You can include key details like time, location, or what
          members need to know.
        </p>
      </div>

      <div class="card" style="margin-bottom:14px;">
        <div class="step-row">
          <span class="step-num">3</span>
          <div>
            <p style="margin:0;font-weight:700;">Recipients</p>
            <p class="form-hint" style="margin:0;">
              This will be sent to all members who currently have notifications enabled.
            </p>
          </div>
        </div>
        <div class="card" style="background:var(--purple-light);box-shadow:none;margin:0;">
          <p style="margin:0;font-weight:700;">
            ${countError
              ? "Couldn't check who's enabled notifications."
              : recipientCount === null
                ? 'Checking…'
                : `${recipientCount} member${recipientCount === 1 ? '' : 's'} will receive this notification`}
          </p>
          <p class="form-hint" style="margin:4px 0 0;">Only members with notifications enabled will receive it.</p>
        </div>
      </div>

      ${error ? html`<p class="absence-error">${error}</p>` : null}
      <div class="form-actions">
        <button class="btn-quiet" disabled=${busy} onClick=${onBack}>Cancel</button>
        <button class="btn btn-primary" disabled=${!ready || busy || !recipientCount}
          onClick=${() => setConfirming(true)}>
          <${IconSend} size=${14} /> Send notification
        </button>
      </div>

      ${confirming ? html`<${ConfirmSendSheet} recipientCount=${recipientCount} busy=${busy}
        onConfirm=${send} onCancel=${() => setConfirming(false)} />` : null}
    </div>
  `;
}
