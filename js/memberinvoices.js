import { html, useMemo, useState } from './lib.js';
import { todayStr, parseLocalDate } from './lib.js';
import {
  formatInvoiceDate, formatCents, parseTermLabel, buildInvoicePdfBytes, downloadBlob,
  invoiceFilename, SONARIO_EMAIL, SONARIO_ACCOUNT_NAME, SONARIO_BANK, SONARIO_BSB,
  SONARIO_ACCOUNT_NUMBER,
} from './invoices.js';
import { reportInvoicePaid } from './store.js';
import { IconBack, IconChevron } from './icons.js';
import { EmptyState } from './shell.js';

// Member-facing invoices. Originally (2026-09-28) built with only due_date to reason about, per
// Nina's explicit "don't invent Paid/Unpaid" rule at the time — migration 0030 (2026-09-29) added
// a real `status` column and an "I've paid" flow, so this file now reads status first and only
// falls back to due-date math while status is 'due'. The old rule still holds in spirit: even now,
// nothing here shows "Unpaid"/"Overdue", and payment_reported never claims to BE paid, only that
// the member says they paid and Sonario has not yet confirmed it.
//
// due_date is read directly off each invoice row, never invoice_runs.default_due_date: an admin's
// per-invoice edit (updateInvoiceDueDate in store.js) is authoritative everywhere a member sees
// their own invoice. The member never sees WHY a date moved — no audit fields, no "extension"
// language — just the current date, same as the admin-facing RunDetail screen already treats it.

// Nina's proposal in the reviewed mockup: due soon at 2 days out. Only applies while status is
// still 'due' — every caller goes through this one function, nothing hardcodes "2" a second time.
const DUE_SOON_DAYS = 2;

// 'due_soon'/'passed' only apply while status is 'due' — every other status is its own state,
// with no due-date urgency layered on top (Nina, 2026-09-29: "suppress due-soon/past-due chasing
// messaging" for payment_reported/on_hold/waived, and paid obviously needs none either).
export function invoiceDueState(invoice, today = todayStr()) {
  if (invoice.status !== 'due') return invoice.status;
  const daysLeft = Math.round((parseLocalDate(invoice.due_date) - parseLocalDate(today)) / 86400000);
  if (daysLeft < 0) return 'passed';
  if (daysLeft <= DUE_SOON_DAYS) return 'due_soon';
  return 'normal';
}

function dueDateText(dueDateStr, state, today = todayStr()) {
  const daysLeft = Math.round((parseLocalDate(dueDateStr) - parseLocalDate(today)) / 86400000);
  const dateText = formatInvoiceDate(dueDateStr);
  if (state === 'passed') return `Was due ${dateText}`;
  if (state === 'due_soon') {
    if (daysLeft <= 0) return `Due today · ${dateText}`;
    if (daysLeft === 1) return `Due tomorrow · ${dateText}`;
    return `Due in ${daysLeft} days · ${dateText}`;
  }
  return `Due ${dateText}`;
}

// Member-facing wording — deliberately different from the admin side's "Payment to confirm" for
// the same payment_reported status (Nina, 2026-09-29: different audience, different framing).
const STATE_LABEL = {
  due_soon: 'Due soon', passed: 'Due date passed',
  payment_reported: 'Payment reported', paid: 'Paid', on_hold: 'On hold', waived: 'Waived',
};
const STATE_PILL_CLASS = {
  due_soon: 'soon', passed: 'passed', payment_reported: 'soon', on_hold: '', waived: '',
};

// --- Home > Term Fees card ---------------------------------------------------------
// Shows the member's single most recent invoice, if any exists at all — there is no "hide once
// paid" rule yet (explicitly future/backlog per Nina's spec: "Once payment tracking exists and it
// becomes Paid, remove the Home card entirely"). Until then, "relevant" just means "exists".
// Nina's original rule ("once it becomes Paid, remove the Home card entirely") now has a real
// status to check rather than being aspirational. Waived gets the same treatment: nothing is
// outstanding either way, and the whole point of this card is "something needs your attention".
const HIDDEN_STATES = ['paid', 'waived'];

export function TermFeesCard({ myInvoices, terms, onOpen }) {
  const latest = myInvoices?.[0];
  if (!latest || HIDDEN_STATES.includes(latest.status)) return null;
  const state = invoiceDueState(latest);
  const term = terms.find((t) => t.id === latest.term_id);
  const termLabel = term ? parseTermLabel(term) : null;
  const dueText = latest.status === 'due' ? dueDateText(latest.due_date, state)
    : latest.status === 'payment_reported' ? 'Waiting for Sonario to confirm'
    : dueDateText(latest.due_date, 'normal'); // on_hold: plain date, no urgency styling

  return html`
    <button class="card fee-card" onClick=${() => onOpen(latest)}>
      <span class="fee-icon" aria-hidden="true">🧾</span>
      <div class="fee-body">
        <div class="fee-label-row">
          <span class="fee-label">${termLabel ? `Term ${termLabel.number} fees` : 'Choir fees'}</span>
          ${STATE_LABEL[state] ? html`<span class="fee-state-pill ${STATE_PILL_CLASS[state]}">${STATE_LABEL[state]}</span>` : null}
        </div>
        <div class="fee-amount">${formatCents(latest.amount_cents)}</div>
        <div class="fee-due">${dueText}</div>
        <span class="fee-link">View invoice →</span>
      </div>
    </button>
  `;
}

// --- Invoice detail ----------------------------------------------------------------
export function MemberInvoiceDetail({ invoice, terms, onInvoiceUpdated, onBack }) {
  const term = terms.find((t) => t.id === invoice.term_id);
  const termLabel = term ? parseTermLabel(term) : { number: '?', year: new Date(invoice.invoice_date).getFullYear() };
  const state = invoiceDueState(invoice);
  const [confirmingPaid, setConfirmingPaid] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState(null);

  const markPaid = async () => {
    setReporting(true); setReportError(null);
    const { data, error } = await reportInvoicePaid(invoice.id);
    setReporting(false);
    if (error) { setReportError(error.message); return; }
    setConfirmingPaid(false);
    onInvoiceUpdated?.(data);
  };

  const download = async () => {
    const bytes = await buildInvoicePdfBytes({
      invoiceNumberLabel: String(invoice.invoice_number),
      memberName: invoice.member_name,
      memberEmail: invoice.member_email,
      invoiceDateStr: formatInvoiceDate(invoice.invoice_date),
      dueDateStr: formatInvoiceDate(invoice.due_date),
      amountCents: invoice.amount_cents,
      termLabel,
    });
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), invoiceFilename(invoice));
  };

  const copyPaymentDetails = () => {
    const text = [
      `Account name: ${SONARIO_ACCOUNT_NAME}`, `Bank: ${SONARIO_BANK}`,
      `BSB: ${SONARIO_BSB}`, `Account: ${SONARIO_ACCOUNT_NUMBER}`,
      `Reference: ${invoice.member_name}`,
    ].join('\n');
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  const contactHref = `mailto:${SONARIO_EMAIL}?subject=${encodeURIComponent(`Invoice #${invoice.invoice_number}`)}`;

  return html`
    <div class="tab-content">
      <div class="detail-head">
        <button class="icon-btn" aria-label="Back" onClick=${onBack}><${IconBack} size=${20} /></button>
        <h2 class="admin-head-title">Invoice</h2>
      </div>

      <div class="card" style="margin-bottom:16px;">
        <p class="inv-term" style="margin:0;font-size:13px;color:var(--ink-soft);font-weight:600;">
          Term ${termLabel.number} ${termLabel.year}
        </p>
        <p style="margin:2px 0 10px;font-size:28px;font-weight:800;">${formatCents(invoice.amount_cents)}</p>
        <span class="fee-state-pill ${STATE_PILL_CLASS[state] || ''}"
          style=${!STATE_PILL_CLASS[state] ? { background: 'var(--purple-light)', color: 'var(--purple-dark)' } : {}}>
          ${state === 'passed' ? `Was due ${formatInvoiceDate(invoice.due_date)}`
            : state === 'payment_reported' ? 'Payment reported'
            : state === 'paid' ? 'Paid'
            : state === 'on_hold' ? 'On hold'
            : state === 'waived' ? 'Waived'
            : `Due ${formatInvoiceDate(invoice.due_date)}`}
        </span>
      </div>

      ${invoice.status === 'due' ? html`
        <div class="card" style="margin-bottom:16px;">
          ${confirmingPaid ? html`
            <p style="margin:0 0 12px;">
              Let Sonario know you've paid?
              <span class="form-hint" style="display:block;margin-top:4px;">
                We'll let the Sonario team know so they can confirm your payment.
              </span>
            </p>
            ${reportError ? html`<p class="absence-error" style="margin:0 0 10px;">${reportError}</p>` : null}
            <div class="form-actions">
              <button class="btn btn-primary btn-sm" disabled=${reporting} onClick=${markPaid}>
                ${reporting ? 'Saving…' : 'Yes, I’ve paid'}
              </button>
              <button class="btn-quiet" disabled=${reporting} onClick=${() => setConfirmingPaid(false)}>Cancel</button>
            </div>
          ` : html`
            <button class="btn btn-primary" style="width:100%;" onClick=${() => setConfirmingPaid(true)}>
              I've paid this invoice
            </button>
          `}
        </div>
      ` : null}

      ${invoice.status === 'payment_reported' ? html`
        <div class="card" style="margin-bottom:16px;background:var(--butter-bg);box-shadow:none;">
          <p style="margin:0 0 4px;font-weight:700;">Payment reported ✓</p>
          <p class="form-hint" style="margin:0;">Thanks — Sonario will confirm your payment once it's been received.</p>
        </div>
      ` : null}

      <div class="card" style="margin-bottom:16px;">
        <p class="section-label" style="margin:0 0 8px;">Invoice details</p>
        <div class="inv-row"><span class="k">Invoice number</span><span class="v">#${invoice.invoice_number}</span></div>
        <div class="inv-row"><span class="k">Issue date</span><span class="v">${formatInvoiceDate(invoice.invoice_date)}</span></div>
        <div class="inv-row"><span class="k">Description</span><span class="v">Choir fees, Term ${termLabel.number} ${termLabel.year}</span></div>
        <div class="inv-row"><span class="k">GST</span><span class="v">N/A</span></div>
      </div>

      <div class="card" style="margin-bottom:16px;">
        <p class="section-label" style="margin:0 0 8px;">Payment details (EFT)</p>
        <div class="inv-row"><span class="k">Account name</span><span class="v">${SONARIO_ACCOUNT_NAME}</span></div>
        <div class="inv-row"><span class="k">Bank</span><span class="v">${SONARIO_BANK}</span></div>
        <div class="inv-row"><span class="k">BSB</span><span class="v">${SONARIO_BSB}</span></div>
        <div class="inv-row"><span class="k">Account</span><span class="v">${SONARIO_ACCOUNT_NUMBER}</span></div>
        <div class="inv-row"><span class="k">Reference</span><span class="v">${invoice.member_name}</span></div>
        <button class="btn btn-outline btn-sm" style="width:100%;margin-top:10px;" onClick=${copyPaymentDetails}>Copy payment details</button>
      </div>

      <button class="btn btn-primary" style="width:100%;margin-bottom:12px;" onClick=${download}>Download PDF invoice</button>

      <div class="card" style="background:var(--purple-light);box-shadow:none;">
        <p style="margin:0 0 4px;font-weight:700;">
          ${invoice.status === 'due' || invoice.status === 'on_hold' ? 'Need more time to pay?' : 'Questions about this invoice?'}
        </p>
        <p class="form-hint" style="margin:0 0 10px;">Contact Sonario if you'd like to discuss payment timing.</p>
        <a class="btn btn-outline btn-sm" href=${contactHref} style="display:block;text-align:center;">Contact Sonario</a>
      </div>
    </div>
  `;
}

// --- More > My Invoices --------------------------------------------------------------
export function MyInvoicesList({ myInvoices, terms, loading, onOpen, onBack }) {
  const byYear = useMemo(() => {
    const groups = new Map();
    for (const inv of myInvoices) {
      const year = parseLocalDate(inv.invoice_date).getFullYear();
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year).push(inv);
    }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]);
  }, [myInvoices]);

  return html`
    <div class="tab-content">
      <div class="detail-head">
        <button class="icon-btn" aria-label="Back to More" onClick=${onBack}><${IconBack} size=${20} /></button>
        <h2 class="admin-head-title">My Invoices</h2>
      </div>
      <p class="form-hint" style="margin:0 0 16px;">Your invoices and membership fees.</p>

      ${loading ? null : byYear.length === 0
        ? html`<${EmptyState} title="No invoices yet" body="Any invoices issued to you will show up here." />`
        : byYear.map(([year, invoicesForYear]) => html`
            <div key=${year}>
              <p class="section-header-secondary" style="margin:20px 0 8px;">${year}</p>
              ${invoicesForYear.map((inv) => {
                const term = terms.find((t) => t.id === inv.term_id);
                const termLabel = term ? parseTermLabel(term) : null;
                return html`
                  <button key=${inv.id} class="rep-song-row" onClick=${() => onOpen(inv)}>
                    <span class="rep-song-title">
                      ${termLabel ? `Term ${termLabel.number}` : 'Invoice'}
                      <span class="form-hint" style="display:block;margin-top:1px;">
                        ${STATE_LABEL[inv.status] || formatInvoiceDate(inv.due_date)}
                      </span>
                    </span>
                    <span style="display:flex;align-items:center;gap:8px;">
                      <span style="font-weight:700;font-size:14px;">${formatCents(inv.amount_cents)}</span>
                      <${IconChevron} size=${16} />
                    </span>
                  </button>
                `;
              })}
            </div>
          `)}
    </div>
  `;
}
