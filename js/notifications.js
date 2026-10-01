import { html, useState, useEffect } from './lib.js';
import { sendAdminNotification, useNotifiableMemberCount, fetchNotificationLog, fetchDueInvoicesForReminders } from './store.js';
import { Sheet, EmptyState, LoadingState } from './shell.js';
import { formatCents, formatInvoiceDate } from './invoices.js';
import { IconBack, IconSend, IconChevron, IconList, IconClock } from './icons.js';

// Every notification type any rule has ever logged, in plain words for this screen (2026-10-01,
// alongside History/Upcoming) — kept here rather than in each Edge Function, since this is the
// one place that needs to turn a type string back into something a human reads.
const NOTIFICATION_TYPE_LABEL = {
  admin_broadcast: 'Admin broadcast',
  checkin_reminder: 'Check-in reminder',
  lyrics_released: 'Lyrics released',
  new_member_request: 'New member request',
  recap_admin_reminder: 'Recap needed (staff)',
  recap_member: 'Recap published',
  term_start: 'Term starting',
  term_end: 'Term ending',
  invoice_due_reminder: 'Invoice due/overdue',
};
const NOTIFICATION_STATUS_LABEL = { pending: 'Pending', sent: 'Sent', failed: 'Failed' };

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

function NotificationComposer({ onBack }) {
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

// --- History: every push any rule or manual send has ever attempted --------------------------
function NotificationHistory({ onBack }) {
  const [events, setEvents] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchNotificationLog().then(({ data }) => { if (!cancelled) setEvents(data || []); });
    return () => { cancelled = true; };
  }, []);

  return html`
    <div class="tab-content">
      <${AdminHeadNotifications} title="Notification history" onBack=${onBack} />
      ${!events ? html`<${LoadingState} label="Loading…" />`
        : events.length === 0 ? html`<${EmptyState} title="Nothing sent yet" body="Every push notification, automated or manual, will show up here." />`
        : html`<div class="rep-song-list">
            ${events.map((ev) => html`
              <div key=${ev.id} class="rep-song-row" style="cursor:default;">
                <span class="rep-song-title">
                  ${NOTIFICATION_TYPE_LABEL[ev.type] || ev.type}
                  <span class="form-hint" style="display:block;margin-top:1px;">
                    ${ev.profiles?.display_name || 'Someone'} · ${formatInvoiceDate((ev.sent_at || ev.created_at).slice(0, 10))}
                  </span>
                </span>
                <span class="form-hint">${NOTIFICATION_STATUS_LABEL[ev.status] || ev.status}</span>
              </div>
            `)}
          </div>`}
    </div>
  `;
}

// --- Upcoming: invoices still due, and when their next reminder fires ------------------------
// Scoped to invoice reminders only (2026-10-01) — the other automated rules (check-in, term
// boundary, recap) are time-window checks rather than a per-record schedule, so there's no
// equivalent "list of future sends" to show for them without re-implementing each one's own
// eligibility logic here. Invoice reminders are genuinely per-record and forward-computable, so
// this is a read of the same rule send-invoice-reminders itself uses, not a separate guess at it.
function nextInvoiceReminderLabel(dueDateStr) {
  const daysOverdue = Math.round((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(dueDateStr)) / 86400000);
  if (daysOverdue < 0) return `Due date reminder in ${-daysOverdue} day${-daysOverdue === 1 ? '' : 's'}`;
  if (daysOverdue === 0) return 'Due-date reminder today';
  const daysUntilNext = 7 - (daysOverdue % 7 === 0 ? 7 : daysOverdue % 7);
  return daysUntilNext === 0 ? 'Overdue reminder today' : `Overdue reminder in ${daysUntilNext} day${daysUntilNext === 1 ? '' : 's'}`;
}

function UpcomingNotifications({ onBack }) {
  const [invoices, setInvoices] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchDueInvoicesForReminders().then(({ data }) => { if (!cancelled) setInvoices(data || []); });
    return () => { cancelled = true; };
  }, []);

  return html`
    <div class="tab-content">
      <${AdminHeadNotifications} title="Upcoming reminders" onBack=${onBack} />
      <p class="form-hint" style="margin:0 0 16px;">
        Invoice-due reminders only — check-in, term and recap reminders are time-window checks, not
        a per-record schedule, so there's nothing equivalent to list for those.
      </p>
      ${!invoices ? html`<${LoadingState} label="Loading…" />`
        : invoices.length === 0 ? html`<${EmptyState} title="Nothing due" body="No invoice is currently sitting in Due status." />`
        : html`<div class="rep-song-list">
            ${invoices.map((inv) => html`
              <div key=${inv.id} class="rep-song-row" style="cursor:default;">
                <span class="rep-song-title">
                  ${inv.member_name} — ${formatCents(inv.amount_cents)}
                  <span class="form-hint" style="display:block;margin-top:1px;">
                    ${inv.terms?.name || 'Invoice'} · due ${formatInvoiceDate(inv.due_date)}
                  </span>
                </span>
                <span class="form-hint">${nextInvoiceReminderLabel(inv.due_date)}</span>
              </div>
            `)}
          </div>`}
    </div>
  `;
}

// --- Home: Send / History / Upcoming ----------------------------------------------------------
export function AdminNotifications({ onBack }) {
  const [screen, setScreen] = useState('home'); // 'home' | 'send' | 'history' | 'upcoming'

  if (screen === 'send') return html`<${NotificationComposer} onBack=${() => setScreen('home')} />`;
  if (screen === 'history') return html`<${NotificationHistory} onBack=${() => setScreen('home')} />`;
  if (screen === 'upcoming') return html`<${UpcomingNotifications} onBack=${() => setScreen('home')} />`;

  return html`
    <div class="tab-content">
      <${AdminHeadNotifications} title="Notifications" onBack=${onBack} />
      <p class="form-hint" style="margin:0 0 16px;">Send a push notification, or see what's gone out and what's coming.</p>
      <button class="card member-row" style="width:100%;text-align:left;margin-bottom:10px;" onClick=${() => setScreen('send')}>
        <span class="member-avatar" aria-hidden="true"><${IconSend} size=${20} /></span>
        <div class="member-row-main">
          <div class="member-row-name">Send Notification</div>
          <div class="member-row-email">Send a one-off push to everyone with notifications enabled.</div>
        </div>
        <${IconChevron} size=${18} />
      </button>
      <button class="card member-row" style="width:100%;text-align:left;margin-bottom:10px;" onClick=${() => setScreen('history')}>
        <span class="member-avatar" aria-hidden="true"><${IconList} size=${20} /></span>
        <div class="member-row-main">
          <div class="member-row-name">Notification history</div>
          <div class="member-row-email">Every push sent, automated or manual.</div>
        </div>
        <${IconChevron} size=${18} />
      </button>
      <button class="card member-row" style="width:100%;text-align:left;" onClick=${() => setScreen('upcoming')}>
        <span class="member-avatar" aria-hidden="true"><${IconClock} size=${20} /></span>
        <div class="member-row-main">
          <div class="member-row-name">Upcoming reminders</div>
          <div class="member-row-email">Invoices still due, and when their next reminder fires.</div>
        </div>
        <${IconChevron} size=${18} />
      </button>
    </div>
  `;
}
