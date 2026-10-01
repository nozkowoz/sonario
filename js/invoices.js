// Invoicing (migration 0015/0016). Admin-only: super gets the whole flow, nothing here is
// member-facing yet (see 0015's HOOK FOR LATER comment for what that would need).
//
// PDF generation and ZIP bundling both happen entirely client-side, same "no backend beyond
// Supabase" philosophy as everything else in this app — pdf-lib draws the page, fflate zips the
// bytes, both loaded the same pinned-CDN-ESM way Preact/htm already are (see lib.js's own header
// comment). Pinned exact versions, never @latest, per Nina's explicit instruction.
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { zipSync } from 'https://esm.sh/fflate@0.8.2';

import { html, useState, useEffect, useMemo } from './lib.js';
import { parseLocalDate, localDateStr, todayStr } from './lib.js';
import {
  useInvoiceSettings, updateInvoiceFee, initializeInvoiceNumbering, useInvoiceRuns,
  createInvoiceRun, fetchInvoicesForRun, fetchInvoicedProfileIdsForTerm, updateInvoiceDueDate,
  usePaymentsToConfirm, confirmInvoicePayment, rejectInvoicePayment, markInvoicePaid,
  holdInvoice, resumeInvoice, waiveInvoice, sendInvoiceEmail, createTerm,
} from './store.js';
import { LoadingState, EmptyState } from './shell.js';
import { IconBack, IconChevron, IconMail, IconKey, IconCheckCircle, IconSend } from './icons.js';

// --- Sonario's fixed invoice details --------------------------------------------------------
// Nina, 2026-09-17: real details from the current invoices, not placeholders. The fee itself is
// the one thing expected to change over time, hence it living in invoice_settings instead of here.
// Exported (2026-09-28) so the member-facing invoice screen (memberinvoices.js) shows the exact
// same payment details the PDF does, from one source, rather than a second hardcoded copy.
export const SONARIO_ABN = '64 562 823 088';
export const SONARIO_EMAIL = 'sonario.au@gmail.com';
export const SONARIO_ACCOUNT_NAME = 'Sonario';
export const SONARIO_BANK = 'Bendigo Bank';
export const SONARIO_BSB = '633-000';
export const SONARIO_ACCOUNT_NUMBER = '171622970';

const AdminHeadInvoices = ({ title, onBack }) => html`
  <div class="detail-head">
    <button class="icon-btn" aria-label="Back" onClick=${onBack}><${IconBack} size=${20} /></button>
    <h2 class="admin-head-title">${title}</h2>
  </div>
`;

export const formatCents = (cents) => `$${(cents / 100).toFixed(2)}`;
const centsFromDollarsInput = (v) => Math.round(Number(v) * 100);

// Invoice status, admin-facing (migration 0030). "payment_reported" reads as "Payment to
// confirm" here — the member's own screen calls the same status "Payment reported" (Nina,
// 2026-09-29: different audiences, different framing of the same fact). "due" gets no badge at
// all in the run/queue lists — an outstanding invoice is the default, unremarkable state, and a
// badge on every single row would just be noise; it only shows up spelled out on the detail screen.
const STATUS_LABEL = {
  payment_reported: 'Payment to confirm',
  paid: 'Paid',
  on_hold: 'On hold',
  waived: 'Waived',
};
const STATUS_BADGE_CLASS = {
  payment_reported: 'status-badge-amber',
  paid: 'status-badge-green',
  on_hold: 'status-badge-grey',
  waived: 'status-badge-grey',
};

// The real Sonario wordmark (Nina, 2026-09-17 — a clean recreation, black on white, no
// transparency needed since the invoice page is white too). Fetched once per page load and
// cached; a missing/blocked file falls back to plain bold text rather than breaking PDF
// generation, same defensive shape as everything else that fetches an asset at runtime here.
let wordmarkImageBytesPromise = null;
function loadWordmarkImageBytes() {
  if (!wordmarkImageBytesPromise) {
    wordmarkImageBytesPromise = fetch('assets/sonario-wordmark.png')
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
  }
  return wordmarkImageBytesPromise;
}

const INV_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Plain "16 Sep 2026" — no weekday. Every existing date formatter in lib.js either includes one or
// is uppercase-rail-styled; an invoice wants neither, so this stays local rather than exported.
export function formatInvoiceDate(dateStr) {
  const d = parseLocalDate(dateStr);
  return `${d.getDate()} ${INV_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function addDays(dateStr, days) {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

// term.name is "Term 3 2026" live (confirmed against the real data) — parsed rather than
// hardcoded so the invoice heading is automatically correct in future years. Falls back
// gracefully if a term is ever named differently.
export function parseTermLabel(term) {
  const m = /Term\s+(\d+)\s+(\d{4})/.exec(term?.name || '');
  if (m) return { number: m[1], year: m[2] };
  const year = term?.starts_on ? parseLocalDate(term.starts_on).getFullYear() : new Date().getFullYear();
  return { number: term?.name || '?', year };
}

const slug = (s) => String(s || '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '');
export const invoiceFilename = (invoice) => `Invoice-${invoice.invoice_number}-${slug(invoice.member_name)}.pdf`;

// Browser-safe bytes -> base64, chunked so a large PDF doesn't blow the call-stack limit that a
// naive String.fromCharCode(...bytes) hits on bigger invoices. Used to hand the already-generated
// PDF to send-invoice-email as JSON, rather than re-generating it server-side.
function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// The PDF itself. Matches Nina's existing real invoice format (heading, ABN, email, bill-to,
// invoice number/dates, description/GST/total, EFT details, the non-refundable/7-day terms
// wording, footer branding) as closely as plain drawn text can. Nina, 2026-09-17: "we have actual
// Sonario branding/wordmark available... don't permanently approximate the invoice logo with
// generic styled text." The bold "SONARIO" text below IS still that approximation — tried the real
// brand font (Big Shoulders Display, confirmed against both css/styles.css's `.app-title` and the
// live sonario.com.au site) and hit a real wall: only a variable font file is publicly available
// (no static Black/900 instance anywhere — Google's own repo ships variable-only, Fontsource's
// static exports are woff2, which fontkit/pdf-lib can't parse), and pdf-lib's embedFont has no way
// to select a variable font's weight axis — it only accepts raw bytes and always renders whatever
// the font's default instance is, which for this family is Thin, not Black. Tested directly (see
// this session's transcript): looked wrong, worse than Helvetica. Resolved properly with a real
// wordmark IMAGE instead (Nina supplied one, see loadWordmarkImageBytes above) — falls back to
// Helvetica Bold text only if that file is ever missing.
export async function buildInvoicePdfBytes({
  invoiceNumberLabel, memberName, memberEmail, invoiceDateStr, dueDateStr, amountCents, termLabel,
  isSample = false,
}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4, in points
  const { width } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.13, 0.11, 0.18);
  const soft = rgb(0.35, 0.33, 0.44);
  const warn = rgb(0.71, 0.2, 0.18);

  let y = 780;
  const text = (t, { x = 50, size = 11, f = font, color = ink } = {}) => {
    page.drawText(t, { x, y, size, font: f, color });
  };
  const gap = (n) => { y -= n; };

  // Wordmark image if it's available; a target WIDTH is chosen and height follows the image's own
  // aspect ratio, so it never looks stretched regardless of the source file's exact dimensions.
  const wordmarkImageBytes = await loadWordmarkImageBytes();
  const wordmarkImage = wordmarkImageBytes ? await pdfDoc.embedPng(wordmarkImageBytes) : null;
  const drawWordmark = (targetWidth) => {
    if (!wordmarkImage) { text('SONARIO', { size: targetWidth / 5.4, f: bold }); gap(targetWidth / 4.4); return; }
    const h = targetWidth * (wordmarkImage.height / wordmarkImage.width);
    page.drawImage(wordmarkImage, { x: 50, y: y - h, width: targetWidth, height: h });
    gap(h + 12);
  };

  drawWordmark(150);
  if (isSample) {
    text('SAMPLE ONLY, not a real invoice', { size: 10, f: bold, color: warn });
    gap(18);
  }
  text(`SONARIO ${termLabel.year} TAX INVOICE – TERM ${termLabel.number}`, { size: 13, f: bold });
  gap(30);

  text(`ABN ${SONARIO_ABN}`, { size: 10, color: soft }); gap(14);
  text(SONARIO_EMAIL, { size: 10, color: soft }); gap(28);

  text(`Invoice ${invoiceNumberLabel}`, { f: bold }); gap(16);
  text(`Invoice date: ${invoiceDateStr}`); gap(16);
  text(`Due date: ${dueDateStr}`); gap(28);

  text('Bill to', { size: 10, f: bold, color: soft }); gap(14);
  text(memberName); gap(16);
  text(memberEmail, { size: 10, color: soft }); gap(30);

  text('Description', { size: 10, f: bold, color: soft });
  text('Amount', { x: width - 130, size: 10, f: bold, color: soft });
  gap(16);
  text(`Sonario membership fees for Term ${termLabel.number} ${termLabel.year}`);
  text(formatCents(amountCents), { x: width - 130 });
  gap(20);
  text('GST', { size: 10, color: soft });
  text('N/A', { x: width - 130, size: 10, color: soft });
  gap(20);
  text('Total', { f: bold });
  text(formatCents(amountCents), { x: width - 130, f: bold });
  gap(36);

  text('Payment (EFT)', { f: bold }); gap(16);
  text(`Account name: ${SONARIO_ACCOUNT_NAME}`, { size: 10 }); gap(14);
  text(`Bank: ${SONARIO_BANK}`, { size: 10 }); gap(14);
  text(`BSB: ${SONARIO_BSB}`, { size: 10 }); gap(14);
  text(`Account: ${SONARIO_ACCOUNT_NUMBER}`, { size: 10 }); gap(14);
  text(`Reference: ${memberName}`, { size: 10 }); gap(30);

  text('Fees are invoiced at the start of each term, due within 7 days of the invoice date,', { size: 9, color: soft });
  gap(12);
  text('and are non-refundable.', { size: 9, color: soft });
  gap(40);

  drawWordmark(60);
  text('A SINGING ENSEMBLE', { size: 9, color: soft });

  return pdfDoc.save();
}

async function buildSampleInvoicePdfBytes(feeCents, term) {
  const termLabel = term ? parseTermLabel(term) : { number: 'X', year: new Date().getFullYear() };
  const invoiceDate = todayStr();
  return buildInvoicePdfBytes({
    invoiceNumberLabel: 'SAMPLE',
    memberName: 'Test Member',
    memberEmail: 'test.member@example.com',
    invoiceDateStr: formatInvoiceDate(invoiceDate),
    dueDateStr: formatInvoiceDate(addDays(invoiceDate, 7)),
    amountCents: feeCents,
    termLabel,
    isSample: true,
  });
}

async function downloadRunPdfs(invoices, term) {
  const termLabel = parseTermLabel(term);
  const files = {};
  for (const inv of invoices) {
    const bytes = await buildInvoicePdfBytes({
      invoiceNumberLabel: String(inv.invoice_number),
      memberName: inv.member_name,
      memberEmail: inv.member_email,
      invoiceDateStr: formatInvoiceDate(inv.invoice_date),
      dueDateStr: formatInvoiceDate(inv.due_date),
      amountCents: inv.amount_cents,
      termLabel,
    });
    files[invoiceFilename(inv)] = bytes;
  }
  const zipped = zipSync(files);
  downloadBlob(new Blob([zipped], { type: 'application/zip' }),
    `Sonario-Term-${termLabel.number}-${termLabel.year}-Invoices.zip`);
}

// Opens a blank tab SYNCHRONOUSLY on the click, before the (async) PDF is even built, then points
// it at the real file once ready — the usual workaround for a popup blocker, which only allows
// window.open in direct response to the click itself, not after an await. Lets a super sanity-check
// an individual invoice's PDF before emailing it out, without it landing in Downloads like the
// sample/ZIP buttons do (2026-10-01, Nina: "let me check before it goes out").
async function viewInvoicePdf(invoice, term) {
  const win = window.open('', '_blank');
  const termLabel = parseTermLabel(term);
  const bytes = await buildInvoicePdfBytes({
    invoiceNumberLabel: String(invoice.invoice_number),
    memberName: invoice.member_name,
    memberEmail: invoice.member_email,
    invoiceDateStr: formatInvoiceDate(invoice.invoice_date),
    dueDateStr: formatInvoiceDate(invoice.due_date),
    amountCents: invoice.amount_cents,
    termLabel,
  });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  if (win) win.location = url; else window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---------------------------------------------------------------------------
// Top-level router for the whole Invoices admin section. Own internal `screen` state, same
// pattern as AdminAttendance's own memberId drill-down — not lifted into admin.js's shared view
// object, since nothing outside this section ever needs to jump straight into a sub-screen here.
// ---------------------------------------------------------------------------
export function AdminInvoices({ terms, directory, profileId, onBack }) {
  const { settings, loading: settingsLoading, setSettings } = useInvoiceSettings();
  const { invoiceRuns, loading: runsLoading, patchInvoiceRun } = useInvoiceRuns();
  const { invoices: toConfirm, loading: toConfirmLoading, setInvoices: setToConfirm } = usePaymentsToConfirm();
  const [screen, setScreen] = useState('home');
  const [draft, setDraft] = useState(null); // working state for the create-run flow
  const [activeRun, setActiveRun] = useState(null);
  const [activeRunInvoices, setActiveRunInvoices] = useState(null);
  const [openQueueInvoiceId, setOpenQueueInvoiceId] = useState(null);

  const openRun = async (run) => {
    setActiveRun(run);
    setActiveRunInvoices(null);
    setScreen('run-detail');
    const { data } = await fetchInvoicesForRun(run.id);
    setActiveRunInvoices(data || []);
  };

  // A payment-status change can affect an invoice sitting in either the queue or an open run's
  // list — patch both, whichever actually has it, rather than tracking which one is "live".
  const patchInvoiceEverywhere = (updated) => {
    setToConfirm((prev) => prev.filter((i) => i.id !== updated.id || updated.status === 'payment_reported'));
    setActiveRunInvoices((prev) => (prev ? prev.map((i) => (i.id === updated.id ? updated : i)) : prev));
  };

  if (settingsLoading || runsLoading) {
    return html`<div class="tab-content"><${AdminHeadInvoices} title="Invoices" onBack=${onBack} /><${LoadingState} label="Loading invoicing…" /></div>`;
  }

  if (screen === 'setup') {
    return html`<${InvoicingSetup} settings=${settings} terms=${terms} profileId=${profileId}
      onSettingsSaved=${setSettings} onBack=${() => setScreen('home')} />`;
  }
  if (screen === 'create-setup') {
    return html`<${CreateRunSetup} terms=${terms} settings=${settings}
      onBack=${() => setScreen('home')}
      onContinue=${(d) => { setDraft(d); setScreen('create-preview'); }} />`;
  }
  if (screen === 'create-preview') {
    return html`<${CreateRunPreview} draft=${draft} directory=${directory} terms=${terms}
      onBack=${() => setScreen('create-setup')}
      onGenerated=${async (run) => {
        patchInvoiceRun(run);
        const { data } = await fetchInvoicesForRun(run.id);
        setActiveRun(run);
        setActiveRunInvoices(data || []);
        setScreen('run-created');
      }} />`;
  }
  // A handful of invoices just generated — email-them-all is the thing Nina actually does next
  // almost every time, so it gets its own screen rather than only being reachable by opening the
  // run and finding the bulk-email entry point buried there (2026-10-01, per Nina's mockup).
  if (screen === 'run-created' && activeRun) {
    const term = terms.find((t) => t.id === activeRun.term_id);
    return html`<${RunCreated} run=${activeRun} invoices=${activeRunInvoices || []} term=${term}
      onEmail=${() => setScreen('email-run')}
      onDownload=${() => downloadRunPdfs(activeRunInvoices || [], term)}
      onDone=${() => openRun(activeRun)} />`;
  }
  if (screen === 'email-run' && activeRun) {
    const term = terms.find((t) => t.id === activeRun.term_id);
    return html`<${EmailRunWizard} run=${activeRun} invoices=${activeRunInvoices || []} term=${term}
      onDone=${() => openRun(activeRun)}
      onInvoiceUpdated=${(updated) => { setActiveRunInvoices((prev) =>
        (prev || []).map((i) => (i.id === updated.id ? updated : i))); patchInvoiceEverywhere(updated); }} />`;
  }
  if (screen === 'run-detail' && activeRun) {
    return html`<${RunDetail} run=${activeRun} invoices=${activeRunInvoices}
      term=${terms.find((t) => t.id === activeRun.term_id)}
      onInvoiceUpdated=${(updated) => { setActiveRunInvoices((prev) =>
        (prev || []).map((i) => (i.id === updated.id ? updated : i))); patchInvoiceEverywhere(updated); }}
      onEmailAll=${() => setScreen('email-run')}
      onBack=${() => setScreen('home')} />`;
  }
  if (screen === 'payments-queue') {
    const openInvoice = openQueueInvoiceId ? toConfirm.find((i) => i.id === openQueueInvoiceId) : null;
    if (openInvoice) {
      return html`<${InvoiceDetail} invoice=${openInvoice} terms=${terms}
        onBack=${() => setOpenQueueInvoiceId(null)}
        onSaved=${(updated) => { patchInvoiceEverywhere(updated); setOpenQueueInvoiceId(null); }} />`;
    }
    return html`
      <div class="tab-content">
        <${AdminHeadInvoices} title="Payments to confirm" onBack=${() => setScreen('home')} />
        ${toConfirmLoading ? html`<${LoadingState} label="Loading…" />`
          : toConfirm.length === 0
          ? html`<${EmptyState} title="Nothing to confirm" body="Invoices a member has marked as paid will show up here." />`
          : html`<div class="rep-song-list">
              ${toConfirm.map((inv) => {
                const term = terms.find((t) => t.id === inv.term_id);
                const termLabel = term ? parseTermLabel(term) : null;
                return html`
                  <button key=${inv.id} class="rep-song-row" onClick=${() => setOpenQueueInvoiceId(inv.id)}>
                    <span class="rep-song-title">
                      ${inv.member_name}
                      <span class="form-hint" style="display:block;margin-top:1px;">
                        ${termLabel ? `Term ${termLabel.number}` : 'Invoice'} · ${formatCents(inv.amount_cents)}
                        ${inv.payment_reported_at ? ` · Reported ${formatInvoiceDate(inv.payment_reported_at.slice(0, 10))}` : ''}
                      </span>
                    </span>
                    <${IconChevron} size=${16} />
                  </button>
                `;
              })}
            </div>`}
      </div>
    `;
  }

  const numberingReady = !!settings?.numbering_initialized_at;

  return html`
    <div class="tab-content">
      <${AdminHeadInvoices} title="Invoices" onBack=${onBack} />

      <div class="card">
        <p class="form-hint" style="margin:0 0 4px;">Current membership fee</p>
        <p style="margin:0 0 12px;font-size:20px;font-weight:800;">${formatCents(settings?.fee_cents ?? 0)}
          <span class="form-hint" style="font-weight:400;"> per member per term</span></p>
        <${FeeEditor} settings=${settings} profileId=${profileId} onSaved=${setSettings} />
      </div>

      ${numberingReady ? html`
        <button class="btn btn-primary" style="width:100%;margin-bottom:10px;" onClick=${() => setScreen('create-setup')}>
          Create term invoices
        </button>
        <button class="btn-quiet" style="margin-bottom:20px;" onClick=${() => setScreen('setup')}>
          Invoicing setup
        </button>
      ` : html`
        <button class="btn btn-primary" style="width:100%;margin-bottom:20px;" onClick=${() => setScreen('setup')}>
          Finish invoicing setup
        </button>
      `}

      <button class="card" style="width:100%;text-align:left;display:flex;align-items:center;gap:12px;margin-bottom:20px;"
        onClick=${() => setScreen('payments-queue')}>
        <span class="fee-icon" aria-hidden="true">🧾</span>
        <div style="flex:1;min-width:0;">
          <p style="margin:0;font-weight:700;">Payments to confirm</p>
          <p class="form-hint" style="margin:2px 0 0;">
            ${toConfirmLoading ? 'Loading…' : `${toConfirm.length} invoice${toConfirm.length === 1 ? '' : 's'} reported paid`}
          </p>
        </div>
        <${IconChevron} size=${18} />
      </button>

      <p class="eyebrow eyebrow-tight">Previous invoice runs</p>
      ${!invoiceRuns.length
        ? html`<${EmptyState} title="No invoices generated yet" body="Once you generate a term's invoices, they'll show up here." />`
        : html`<div class="rep-song-list">
            ${invoiceRuns.map((run) => {
              const term = terms.find((t) => t.id === run.term_id);
              return html`
                <button key=${run.id} class="rep-song-row" onClick=${() => openRun(run)}>
                  <span class="rep-song-title">${term?.name || 'Unknown term'}</span>
                  <span class="form-hint">${formatInvoiceDate(run.invoice_date)}</span>
                  <${IconChevron} size=${16} />
                </button>
              `;
            })}
          </div>`}
    </div>
  `;
}

function FeeEditor({ settings, profileId, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => ((settings?.fee_cents ?? 0) / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!editing) {
    return html`<button class="btn-quiet" onClick=${() => { setValue(((settings?.fee_cents ?? 0) / 100).toFixed(2)); setEditing(true); }}>Edit fee</button>`;
  }

  const save = async () => {
    const cents = centsFromDollarsInput(value);
    if (!cents || cents <= 0) { setError('Enter a valid amount.'); return; }
    setBusy(true); setError(null);
    const { data, error: err } = await updateInvoiceFee(cents, profileId);
    setBusy(false);
    if (err) { setError(err.message); return; }
    if (!data) { setError("That didn't save — reload and try again."); return; }
    onSaved(data);
    setEditing(false);
  };

  return html`
    <div class="form-row" style="align-items:flex-end;">
      <label style="flex:0 0 140px;">
        Fee ($ per term)
        <input type="number" min="0" step="0.01" value=${value} onInput=${(e) => setValue(e.target.value)} />
      </label>
      <button class="btn btn-primary btn-sm" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>
      <button class="btn-quiet" disabled=${busy} onClick=${() => setEditing(false)}>Cancel</button>
    </div>
    ${error ? html`<p class="absence-error">${error}</p>` : null}
  `;
}

// ---------------------------------------------------------------------------
// Invoice Email Setup wizard (2026-09-28, per Nina's mockup with one deliberate change): screens
// 1 through 4 follow the mockup closely (Overview, Gmail account, 2-Step Verification, Create an
// App Password), but there is no screen 5/6 here, no "enter the app password into Sonario" field,
// no in-app "send test email". Nina's explicit call: the password gets texted to her and goes
// straight into Supabase's secret store, same as the existing plan already in TODO.md, kept for a
// real reason, not an oversight — a live email-sending credential sitting in the app's own
// database is reachable by any future bug or an overly broad RLS policy in a way Supabase's actual
// secrets vault isn't. The final screen explains this, rather than silently ending at "text Nina"
// with no reason given.
const WIZARD_STEP_COUNT = 4;

function StepBadge({ Icon, tone = 'purple' }) {
  return html`<span class="setup-icon-badge setup-icon-badge-${tone}"><${Icon} size=${20} /></span>`;
}

function InvoiceEmailSetupWizard({ onClose }) {
  const [step, setStep] = useState(0);
  const next = () => setStep((s) => Math.min(s + 1, WIZARD_STEP_COUNT));
  const back = () => (step === 0 ? onClose() : setStep((s) => s - 1));

  const titles = ['Invoice Email Setup', '1. Gmail account', '2. Turn on 2-Step Verification',
    '3. Create an App Password', 'Text it to Nina'];

  return html`
    <div class="tab-content">
      <div class="detail-head">
        <button class="icon-btn" aria-label="Back" onClick=${back}>
          <${IconBack} size=${20} />
        </button>
        <h2 class="admin-head-title">${titles[step]}</h2>
      </div>

      ${step === 0 ? html`
        <p style="margin:0 0 16px;">
          Sonario will send invoice emails via the Sonario Gmail account, using a secure connection.
        </p>
        <div class="card" style="display:flex;gap:12px;margin-bottom:16px;">
          <${StepBadge} Icon=${IconMail} />
          <div>
            <p style="margin:0;font-weight:700;">What you'll need</p>
            <p class="form-hint" style="margin:2px 0 0;">
              The Sonario Gmail account (${SONARIO_EMAIL}), with 2-Step Verification and an app password.
            </p>
          </div>
        </div>
        <div class="step-row">
          <span class="step-num">1</span>
          <div><p style="margin:0;font-weight:700;">Turn on 2-Step Verification</p>
            <p class="form-hint" style="margin:0;">Required by Google before it will issue an app password.</p></div>
        </div>
        <div class="step-row">
          <span class="step-num">2</span>
          <div><p style="margin:0;font-weight:700;">Create an App Password</p>
            <p class="form-hint" style="margin:0;">A 16-character password Sonario's Edge Function will use to send emails.</p></div>
        </div>
        <div class="step-row" style="margin-bottom:20px;">
          <span class="step-num">3</span>
          <div><p style="margin:0;font-weight:700;">Text it to Nina</p>
            <p class="form-hint" style="margin:0;">She adds it to Supabase's secret store. It's never typed into Sonario itself.</p></div>
        </div>
        <button class="btn btn-primary" style="width:100%;" onClick=${next}>Let's get started</button>
      ` : null}

      ${step === 1 ? html`
        <p style="margin:0 0 16px;">Use the Sonario Gmail account for sending invoice emails.</p>
        <div class="card" style="margin-bottom:16px;">
          <div style="display:flex;gap:12px;margin-bottom:12px;">
            <${StepBadge} Icon=${IconMail} />
            <p style="margin:0;font-weight:700;align-self:center;">${SONARIO_EMAIL}</p>
          </div>
          <ul style="margin:0;padding-left:20px;">
            <li>The same account already used for Sonario's Drive folders and sign-in.</li>
            <li>Keeps invoice emails separate from anyone's personal email.</li>
            <li>Makes it clear to recipients where invoices come from.</li>
          </ul>
        </div>
        <p class="form-hint" style="margin:0 0 20px;">
          Sean needs to sign in to this account (or already has access to it) to complete the next
          two steps.
        </p>
        <button class="btn btn-primary" style="width:100%;" onClick=${next}>I have access to this account</button>
      ` : null}

      ${step === 2 ? html`
        <div class="card" style="display:flex;gap:12px;margin-bottom:16px;">
          <${StepBadge} Icon=${IconCheckCircle} tone="green" />
          <div>
            <p style="margin:0;font-weight:700;">Why this is needed</p>
            <p class="form-hint" style="margin:2px 0 0;">
              2-Step Verification is what lets Google issue an app password for Sonario at all.
            </p>
          </div>
        </div>
        <p style="margin:0 0 8px;font-weight:700;">How to turn it on</p>
        <div class="step-row">
          <span class="step-num">1</span>
          <p style="margin:0;">
            Go to <strong>myaccount.google.com/security</strong>, signed in as ${SONARIO_EMAIL}.
          </p>
        </div>
        <div class="step-row">
          <span class="step-num">2</span>
          <p style="margin:0;">Under "How you sign in to Google", select 2-Step Verification.</p>
        </div>
        <div class="step-row" style="margin-bottom:20px;">
          <span class="step-num">3</span>
          <p style="margin:0;">Follow Google's prompts to turn it on, if it isn't on already.</p>
        </div>
        <button class="btn btn-primary" style="width:100%;" onClick=${next}>I've turned on 2-Step Verification</button>
      ` : null}

      ${step === 3 ? html`
        <div class="card" style="display:flex;gap:12px;margin-bottom:16px;">
          <${StepBadge} Icon=${IconKey} />
          <div>
            <p style="margin:0;font-weight:700;">What is an app password?</p>
            <p class="form-hint" style="margin:2px 0 0;">
              A 16-character password Google generates for one specific app. It lets Sonario send
              email without ever knowing the real Gmail password.
            </p>
          </div>
        </div>
        <p style="margin:0 0 8px;font-weight:700;">How to create it</p>
        <div class="step-row">
          <span class="step-num">1</span>
          <p style="margin:0;">Go to <strong>myaccount.google.com/apppasswords</strong>.</p>
        </div>
        <div class="step-row">
          <span class="step-num">2</span>
          <p style="margin:0;">Give it a name, e.g. "Sonario".</p>
        </div>
        <div class="step-row" style="margin-bottom:20px;">
          <span class="step-num">3</span>
          <p style="margin:0;">Click "Create" and copy the 16-character password shown.</p>
        </div>
        <button class="btn btn-primary" style="width:100%;" onClick=${next}>I have my app password</button>
      ` : null}

      ${step === 4 ? html`
        <div class="card" style="text-align:center;margin-bottom:16px;">
          <p style="margin:0 0 6px;font-weight:700;font-size:16px;">Text that password to Nina</p>
          <p style="margin:0 0 4px;font-size:22px;font-weight:800;color:var(--purple);">0438 477 458</p>
          <p class="form-hint" style="margin:0;">Don't email it. Don't type it into Sonario itself.</p>
        </div>
        <div class="card" style="margin-bottom:16px;">
          <p style="margin:0 0 8px;font-weight:700;">Why text it instead of entering it here?</p>
          <p style="margin:0;">
            The password could send email as sonario.au@gmail.com, so it needs to live somewhere
            more locked down than the app's own database. Nina adds it directly to Supabase's
            secret store, where only the Edge Function that sends invoices can ever read it, not
            any table a bug or a permissions mistake could expose.
          </p>
        </div>
        <button class="btn btn-primary" style="width:100%;" onClick=${onClose}>Done</button>
      ` : null}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Invoicing Setup — the onboarding checklist. Only the numbering step is enforced at the database
// level (see 0015); the rest is sequencing for a good first-run experience. Email is intentionally
// not built in this pass — see the Send test email row below.
// ---------------------------------------------------------------------------
function InvoicingSetup({ settings, terms, profileId, onSettingsSaved, onBack }) {
  const numberingReady = !!settings?.numbering_initialized_at;
  const [nextNumber, setNextNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  if (wizardOpen) {
    return html`<${InvoiceEmailSetupWizard} onClose=${() => setWizardOpen(false)} />`;
  }

  const setNumbering = async () => {
    const n = parseInt(nextNumber, 10);
    if (!n || n < 1) { setError('Enter the next real invoice number to issue.'); return; }
    setBusy(true); setError(null);
    const { data, error: err } = await initializeInvoiceNumbering(n);
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSettingsSaved(data);
  };

  const genSample = async () => {
    setSampleBusy(true);
    const term = terms[terms.length - 1] || null;
    const bytes = await buildSampleInvoicePdfBytes(settings?.fee_cents ?? 0, term);
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'Sonario-Sample-Invoice.pdf');
    setSampleBusy(false);
  };

  return html`
    <div class="tab-content">
      <${AdminHeadInvoices} title="Invoicing Setup" onBack=${onBack} />

      <div class="card" style="margin-bottom:14px;">
        <p class="form-hint" style="margin:0 0 8px;">1. Invoice email (one-time setup)</p>
        <p style="margin:0 0 12px;">
          Sending invoices from inside Sonario isn't built yet, but it will send from the Sonario
          Gmail once that account has an app password ready. A guided walkthrough for Sean covers
          getting it and texting it to Nina.
        </p>
        <button class="btn btn-outline btn-sm" onClick=${() => setWizardOpen(true)}>Start setup</button>
        <p class="form-hint" style="margin:8px 0 0;">
          The send button itself isn't built yet (invoices are downloadable PDFs for now), but
          having the app password ready means this step is one less thing later.
        </p>
      </div>

      <div class="card" style="margin-bottom:14px;">
        <p class="form-hint" style="margin:0 0 8px;">2. Next invoice number to issue</p>
        ${numberingReady ? html`
          <p class="form-saved" style="margin:0;">Invoice numbering is set up and locked in — it can't be changed again.</p>
        ` : html`
          <div class="form-row" style="align-items:flex-end;">
            <label style="flex:0 0 200px;">
              Next invoice number
              <input type="number" min="1" step="1" value=${nextNumber}
                placeholder="e.g. 582" onInput=${(e) => setNextNumber(e.target.value)} />
            </label>
            <button class="btn btn-primary btn-sm" disabled=${busy} onClick=${setNumbering}>
              ${busy ? 'Setting…' : 'Set number'}
            </button>
          </div>
          <p class="form-hint" style="margin:8px 0 0;">
            This can only be done once, and only before any invoice has ever been generated. Use
            whatever number comes after the last one actually issued, on paper or otherwise.
          </p>
          ${error ? html`<p class="absence-error">${error}</p>` : null}
        `}
      </div>

      <div class="card" style="margin-bottom:14px;">
        <p class="form-hint" style="margin:0 0 8px;">3. Generate a test invoice</p>
        <button class="btn btn-outline btn-sm" disabled=${sampleBusy} onClick=${genSample}>
          ${sampleBusy ? 'Generating…' : 'Download sample PDF'}
        </button>
        <p class="form-hint" style="margin:8px 0 0;">
          Uses today's fee and a fake member so you can check the layout — never touches real
          invoice numbers or the database, before or after numbering is set up.
        </p>
      </div>

      <div class="card">
        <p class="form-hint" style="margin:0 0 8px;">4. Send that test invoice to yourself</p>
        <button class="btn btn-outline btn-sm" disabled>Send test invoice <span class="admin-soon">Soon</span></button>
        <p class="form-hint" style="margin:8px 0 0;">Also waiting on email sending — for now, download the sample above and check it yourself.</p>
      </div>
    </div>
  `;
}

// A term's actual start/end dates are real-world facts (whatever the school term calendar says
// that year) — nothing here can derive them from just "Term 2, 2027", so they're still two plain
// date fields. What this saves is typing "Term 2 2027" as free text and hoping it matches the
// "Term N YYYY" shape every other screen's parseTermLabel() regex expects.
function AddTermInlineForm({ onCreated, onCancel }) {
  const [num, setNum] = useState('1');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    if (!startsOn || !endsOn) { setError('Enter both a start and end date.'); return; }
    if (endsOn < startsOn) { setError('End date needs to be after the start date.'); return; }
    setBusy(true); setError(null);
    const { data, error: err } = await createTerm({ name: `Term ${num} ${year}`, startsOn, endsOn });
    setBusy(false);
    if (err) { setError(err.message); return; }
    if (!data) { setError("That didn't save — reload and try again."); return; }
    onCreated(data);
  };

  return html`
    <div class="card" style="margin:2px 0 4px;background:var(--bg);box-shadow:none;">
      <p style="margin:0 0 10px;font-weight:700;">Add a term</p>
      <div class="form-row">
        <label style="flex:0 0 110px;">
          Term
          <select value=${num} onChange=${(e) => setNum(e.target.value)}>
            ${['1', '2', '3', '4'].map((n) => html`<option key=${n} value=${n}>Term ${n}</option>`)}
          </select>
        </label>
        <label style="flex:0 0 90px;">
          Year
          <input type="number" step="1" value=${year} onInput=${(e) => setYear(e.target.value)} />
        </label>
      </div>
      <label>
        Starts on
        <input type="date" value=${startsOn} onInput=${(e) => setStartsOn(e.target.value)} />
      </label>
      <label>
        Ends on
        <input type="date" value=${endsOn} onInput=${(e) => setEndsOn(e.target.value)} />
      </label>
      ${error ? html`<p class="absence-error">${error}</p>` : null}
      <div class="form-actions">
        <button class="btn btn-primary btn-sm" disabled=${busy} onClick=${save}>
          ${busy ? 'Adding…' : `Add Term ${num} ${year}`}
        </button>
        <button class="btn-quiet" disabled=${busy} onClick=${onCancel}>Cancel</button>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Create term invoices — Setup step. Fee is shown, not edited here (edit it from Invoices home
// first) — one place to change the fee, not two.
// ---------------------------------------------------------------------------
function CreateRunSetup({ terms, settings, onBack, onContinue }) {
  // A term just created here hasn't necessarily arrived back through useTerms()'s realtime
  // subscription yet (there's always a round trip) — held locally and merged in so the dropdown
  // and the auto-select below don't have to wait on that.
  const [justAdded, setJustAdded] = useState([]);
  const allTerms = useMemo(() => {
    const byId = new Map(terms.map((t) => [t.id, t]));
    for (const t of justAdded) if (!byId.has(t.id)) byId.set(t.id, t);
    return [...byId.values()];
  }, [terms, justAdded]);
  const sortedTerms = useMemo(() => [...allTerms].sort((a, b) => b.starts_on.localeCompare(a.starts_on)), [allTerms]);
  const [termId, setTermId] = useState(sortedTerms[0]?.id || '');
  const [addingTerm, setAddingTerm] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(todayStr());
  const [dueDate, setDueDate] = useState(addDays(todayStr(), 7));
  // Due date defaults to invoice date + 7 days and follows it automatically — until the admin
  // actually edits the due date field directly, at which point it's theirs and stops following
  // (2026-10-01, Nina: this run's grace period isn't always the standard 7 days).
  const [dueDateTouched, setDueDateTouched] = useState(false);

  const changeInvoiceDate = (v) => {
    setInvoiceDate(v);
    if (!dueDateTouched) setDueDate(addDays(v, 7));
  };
  const changeDueDate = (v) => { setDueDate(v); setDueDateTouched(true); };

  return html`
    <div class="tab-content">
      <${AdminHeadInvoices} title="Create term invoices" onBack=${onBack} />
      <div class="card form-card">
        <label>
          Term
          <select value=${termId} onChange=${(e) => setTermId(e.target.value)}>
            ${sortedTerms.map((t) => html`<option key=${t.id} value=${t.id}>${t.name}</option>`)}
          </select>
        </label>
        ${addingTerm
          ? html`<${AddTermInlineForm}
              onCreated=${(term) => { setJustAdded((prev) => [...prev, term]); setTermId(term.id); setAddingTerm(false); }}
              onCancel=${() => setAddingTerm(false)} />`
          : html`<button type="button" class="btn-quiet" style="align-self:flex-start;" onClick=${() => setAddingTerm(true)}>+ Add a term</button>`}
        <label>
          Invoice date
          <input type="date" value=${invoiceDate} onInput=${(e) => changeInvoiceDate(e.target.value)} />
        </label>
        <label>
          Due date
          <input type="date" value=${dueDate} onInput=${(e) => changeDueDate(e.target.value)} />
        </label>
        <p class="form-hint" style="margin:0;">
          ${dueDateTouched ? 'Set manually for this run.' : 'Defaults to invoice date + 7 days — edit it above if this run needs a different grace period.'}
        </p>
        <p class="form-hint" style="margin:0;">Fee: <strong>${formatCents(settings?.fee_cents ?? 0)}</strong> per member</p>
        <div class="form-actions">
          <button class="btn btn-primary" disabled=${!termId}
            onClick=${() => onContinue({ termId, invoiceDate, dueDate, feeCents: settings?.fee_cents ?? 0 })}>
            Continue
          </button>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Create term invoices — Preview step. The safety net: every active member preselected, anyone
// already invoiced this term automatically excluded (submitting them would fail the whole batch —
// see unique(term_id, profile_id) in 0015), and a clear count before anything is written.
// ---------------------------------------------------------------------------
function CreateRunPreview({ draft, directory, terms, onBack, onGenerated }) {
  const term = terms.find((t) => t.id === draft.termId);
  const members = useMemo(() => Object.values(directory).sort((a, b) => a.display_name.localeCompare(b.display_name)), [directory]);
  const [alreadyInvoiced, setAlreadyInvoiced] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchInvoicedProfileIdsForTerm(draft.termId).then(({ data }) => {
      if (cancelled) return;
      const already = new Set(data || []);
      setAlreadyInvoiced(already);
      setSelected(new Set(members.filter((m) => !already.has(m.id)).map((m) => m.id)));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.termId]);

  if (!selected) return html`<div class="tab-content"><${AdminHeadInvoices} title="Preview" onBack=${onBack} /><${LoadingState} label="Checking existing invoices…" /></div>`;

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const generate = async () => {
    setBusy(true); setError(null);
    const { data, error: err } = await createInvoiceRun({
      termId: draft.termId, invoiceDate: draft.invoiceDate, dueDate: draft.dueDate,
      feeCents: draft.feeCents, profileIds: [...selected],
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onGenerated(data);
  };

  return html`
    <div class="tab-content">
      <${AdminHeadInvoices} title="Preview" onBack=${onBack} />
      <div class="card" style="margin-bottom:14px;">
        <p style="margin:0 0 6px;font-weight:700;">${term?.name}</p>
        <p class="form-hint" style="margin:0;">Invoice date: ${formatInvoiceDate(draft.invoiceDate)}</p>
        <p class="form-hint" style="margin:0;">Due date: ${formatInvoiceDate(draft.dueDate)}</p>
        <p class="form-hint" style="margin:0;">Fee: ${formatCents(draft.feeCents)} per member</p>
      </div>

      ${alreadyInvoiced.size > 0 ? html`
        <p class="absence-error" style="margin:0 0 14px;">
          ${alreadyInvoiced.size} member${alreadyInvoiced.size === 1 ? '' : 's'} already ${alreadyInvoiced.size === 1 ? 'has' : 'have'}
          an invoice for ${term?.name} and ${alreadyInvoiced.size === 1 ? 'is' : 'are'} excluded automatically below.
        </p>
      ` : null}

      <p class="eyebrow eyebrow-tight">${selected.size} of ${members.length} members selected</p>
      <div class="rep-song-list" style="margin-bottom:16px;">
        ${members.map((m) => {
          const already = alreadyInvoiced.has(m.id);
          return html`
            <label key=${m.id} class="rep-song-row" style=${{ opacity: already ? 0.55 : 1, cursor: already ? 'default' : 'pointer' }}>
              <input type="checkbox" checked=${already ? false : selected.has(m.id)} disabled=${already}
                onChange=${() => toggle(m.id)} style="margin-right:10px;" />
              <span class="rep-song-title">${m.display_name}</span>
              ${already ? html`<span class="form-hint">Already invoiced</span>` : null}
            </label>
          `;
        })}
      </div>

      ${error ? html`<p class="absence-error">${error}</p>` : null}
      <button class="btn btn-primary" style="width:100%;" disabled=${busy || selected.size === 0} onClick=${generate}>
        ${busy ? 'Generating…' : `Generate ${selected.size} invoice${selected.size === 1 ? '' : 's'}`}
      </button>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Run created — the landing screen right after generate(), replacing what used to be an automatic
// ZIP download + straight-into-run-detail. Nina's mockup (2026-10-01): make emailing everyone the
// obvious next step rather than something only reachable by opening the run and finding it. Every
// invoice here always has an email (profiles.google_email is NOT NULL — see 0001/0015), so unlike
// the mockup this never needs a "N members have no email address" callout.
// ---------------------------------------------------------------------------
function RunCreated({ run, invoices, term, onEmail, onDownload, onDone }) {
  const [downloading, setDownloading] = useState(false);
  const totalCents = invoices.reduce((sum, i) => sum + i.amount_cents, 0);
  const first = invoices[0]?.invoice_number;
  const last = invoices[invoices.length - 1]?.invoice_number;

  const download = async () => { setDownloading(true); await onDownload(); setDownloading(false); };

  return html`
    <div class="tab-content">
      <div class="state-block" style="padding-top:20px;">
        <div class="run-success-icon"><${IconCheckCircle} size=${32} /></div>
        <p class="state-title" style="font-size:18px;">${invoices.length} invoice${invoices.length === 1 ? '' : 's'} created!</p>
        ${first ? html`<p class="state-body">
          Invoice #${first}${last !== first ? `–#${last}` : ''} · Total ${formatCents(totalCents)}
        </p>` : null}
      </div>

      <div class="fee-card card" style="margin:16px 0 20px;cursor:default;">
        <span class="fee-icon" aria-hidden="true">✉️</span>
        <div class="fee-body">
          <p style="margin:0;font-weight:700;">${invoices.length} ready to email</p>
          <p class="form-hint" style="margin:2px 0 0;">Every member here has an email address on file.</p>
        </div>
      </div>

      <p class="eyebrow eyebrow-tight">Check a PDF before sending</p>
      <div class="rep-song-list" style="margin-bottom:20px;">
        ${invoices.map((inv) => html`
          <div key=${inv.id} class="rep-song-row" style="cursor:default;">
            <span class="rep-song-title">#${inv.invoice_number} — ${inv.member_name}</span>
            <button class="btn-quiet" onClick=${() => viewInvoicePdf(inv, term)}>View PDF</button>
          </div>
        `)}
      </div>

      <button class="btn btn-primary" style="width:100%;margin-bottom:10px;" onClick=${onEmail}>
        Email invoices to ${invoices.length} member${invoices.length === 1 ? '' : 's'}
      </button>
      <button class="btn btn-outline" style="width:100%;margin-bottom:10px;" disabled=${downloading} onClick=${download}>
        ${downloading ? 'Preparing ZIP…' : 'Download all PDFs'}
      </button>
      <button class="btn-quiet" style="width:100%;" onClick=${onDone}>Done</button>
    </div>
  `;
}

const EMAIL_STATUS_LABEL = { pending: 'Pending', sending: 'Sending…', sent: 'Sent', failed: 'Not sent' };

// ---------------------------------------------------------------------------
// Bulk-email wizard — compose once, personalised per recipient only by swapping "[First name]"
// (Nina's mockup shows that literal token in the editable text), then send one at a time so
// progress is real rather than a fake animated bar. Reachable both right after generating a run
// (RunCreated above) and from a past run's own detail screen (RunDetail's "Email invoices to N
// members" button) — same component either way, since "send/resend to everyone in this run" is
// the same operation in both cases.
// ---------------------------------------------------------------------------
function EmailRunWizard({ run, invoices, term, onDone, onInvoiceUpdated }) {
  const termLabel = term ? parseTermLabel(term) : { number: '?', year: new Date(run.invoice_date).getFullYear() };
  const defaultSubject = `Sonario invoice — Term ${termLabel.number} ${termLabel.year}`;
  const defaultMessage = `Hi [First name],\n\nHere's your Sonario invoice for Term ${termLabel.number} ${termLabel.year} — ${formatCents(run.fee_cents)}, due ${formatInvoiceDate(run.due_date)}.\n\nYour invoice PDF is attached.\n\nThanks,\nSonario`;

  const [step, setStep] = useState('compose'); // compose | confirm | sending | results
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [statuses, setStatuses] = useState(() => Object.fromEntries(invoices.map((i) => [i.id, { status: 'pending' }])));
  const [sentSoFar, setSentSoFar] = useState(0);
  const [sendTotal, setSendTotal] = useState(invoices.length);

  const firstNameOf = (inv) => (inv.member_name || '').trim().split(/\s+/)[0] || 'there';
  const personalize = (tmpl, inv) => tmpl.replace(/\[First name\]/g, firstNameOf(inv));

  const sendOne = async (inv) => {
    setStatuses((prev) => ({ ...prev, [inv.id]: { status: 'sending' } }));
    try {
      const pdfBytes = await buildInvoicePdfBytes({
        invoiceNumberLabel: String(inv.invoice_number),
        memberName: inv.member_name,
        memberEmail: inv.member_email,
        invoiceDateStr: formatInvoiceDate(inv.invoice_date),
        dueDateStr: formatInvoiceDate(inv.due_date),
        amountCents: inv.amount_cents,
        termLabel,
      });
      const { data, error: err } = await sendInvoiceEmail({
        invoiceId: inv.id,
        toEmail: inv.member_email,
        subject,
        message: personalize(message, inv),
        pdfBase64: bytesToBase64(pdfBytes),
        pdfFilename: invoiceFilename(inv),
      });
      if (err || data?.error) {
        setStatuses((prev) => ({ ...prev, [inv.id]: { status: 'failed', error: err?.message || data?.error } }));
        return;
      }
      setStatuses((prev) => ({ ...prev, [inv.id]: { status: 'sent' } }));
      if (data?.invoice) onInvoiceUpdated(data.invoice);
    } catch (err) {
      setStatuses((prev) => ({ ...prev, [inv.id]: { status: 'failed', error: String(err?.message ?? err) } }));
    }
  };

  // Sequential, not Promise.all — denomailer opens one SMTP connection per function call, and this
  // also gives the progress bar a real, honest count rather than everything finishing at once.
  const runSend = async (list) => {
    setSendTotal(list.length);
    setSentSoFar(0);
    setStep('sending');
    for (const inv of list) {
      await sendOne(inv);
      setSentSoFar((n) => n + 1);
    }
    setStep('results');
  };

  if (step === 'compose') {
    return html`
      <div class="tab-content">
        <${AdminHeadInvoices} title="Send invoices" onBack=${onDone} />
        <p class="form-hint" style="margin:0 0 12px;">Each member will receive their individual invoice PDF.</p>
        <div class="card form-card">
          <p style="margin:0;"><strong>${invoices.length}</strong> recipient${invoices.length === 1 ? '' : 's'}</p>
          <label>
            Subject
            <input type="text" value=${subject} onInput=${(e) => setSubject(e.target.value)} />
          </label>
          <label>
            Message
            <textarea rows="8" style="font-family:inherit;" value=${message}
              onInput=${(e) => setMessage(e.target.value)}></textarea>
          </label>
          <p class="form-hint" style="margin:0;">
            Each email is personalised — [First name] is swapped for the member's own first name.
          </p>
        </div>
        <button class="btn btn-primary" style="width:100%;margin-top:16px;" disabled=${invoices.length === 0}
          onClick=${() => setStep('confirm')}>
          Review and send
        </button>
      </div>
    `;
  }

  if (step === 'confirm') {
    return html`
      <div class="tab-content">
        <${AdminHeadInvoices} title="Confirm send" onBack=${() => setStep('compose')} />
        <div class="state-block" style="padding-top:20px;">
          <div class="run-success-icon" style="background:var(--purple-light);color:var(--purple);">
            <${IconSend} size=${26} />
          </div>
          <p class="state-title" style="font-size:18px;">
            Send ${invoices.length} invoice email${invoices.length === 1 ? '' : 's'}?
          </p>
          <p class="state-body">
            Each member will receive their individual invoice PDF. Emails are sent immediately — this may take a few moments.
          </p>
        </div>
        <button class="btn btn-primary" style="width:100%;margin-bottom:10px;" onClick=${() => runSend(invoices)}>Send now</button>
        <button class="btn-quiet" style="width:100%;" onClick=${() => setStep('compose')}>Cancel</button>
      </div>
    `;
  }

  if (step === 'sending') {
    const pct = sendTotal ? Math.round((sentSoFar / sendTotal) * 100) : 0;
    return html`
      <div class="tab-content">
        <div class="detail-head"><h2 class="admin-head-title">Sending invoices</h2></div>
        <p style="margin:0 0 8px;font-weight:700;">Sending ${sentSoFar} of ${sendTotal}…</p>
        <div class="progress-track" style="margin-bottom:18px;"><div class="progress-fill" style=${`width:${pct}%`}></div></div>
        <div class="rep-song-list">
          ${invoices.map((inv) => html`
            <div key=${inv.id} class="rep-song-row" style="cursor:default;">
              <span class="rep-song-title">${inv.member_name}</span>
              <span class="form-hint">${EMAIL_STATUS_LABEL[statuses[inv.id]?.status] || ''}</span>
            </div>
          `)}
        </div>
      </div>
    `;
  }

  // results
  const failed = invoices.filter((inv) => statuses[inv.id]?.status === 'failed');
  const sentOk = invoices.length - failed.length;
  return html`
    <div class="tab-content">
      <${AdminHeadInvoices} title="Send results" onBack=${onDone} />
      <div class="state-block" style="padding-top:20px;">
        <div class="run-success-icon" style=${failed.length ? 'background:var(--butter-bg);color:var(--butter);' : ''}>
          <${IconCheckCircle} size=${32} />
        </div>
        <p class="state-title" style="font-size:18px;">${failed.length ? 'Invoices sent' : 'Invoices sent!'}</p>
        <p class="state-body">${sentOk} of ${invoices.length} email${invoices.length === 1 ? '' : 's'} sent successfully.</p>
      </div>

      ${failed.length > 0 ? html`
        <div class="card" style="margin-bottom:16px;background:var(--error-bg);box-shadow:none;">
          <p style="margin:0 0 8px;font-weight:700;">Couldn't be sent</p>
          ${failed.map((inv) => html`
            <p key=${inv.id} class="form-hint" style="margin:0 0 4px;">
              ${inv.member_name} — ${statuses[inv.id]?.error || 'Unknown error'}
            </p>
          `)}
        </div>
        <button class="btn btn-outline" style="width:100%;margin-bottom:10px;" onClick=${() => runSend(failed)}>
          Try again (${failed.length})
        </button>
      ` : null}
      <button class="btn btn-primary" style="width:100%;" onClick=${onDone}>Done</button>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// A past run's detail: every invoice in it, a repeatable Download PDFs button (regenerates fresh
// from stored data every time, so a failed browser download never means "go create another run" —
// see 0015's header on why nothing here needs the PDF bytes to have been stored anywhere), and a
// way into each invoice's own Change due date action.
// ---------------------------------------------------------------------------
function RunDetail({ run, invoices, term, onInvoiceUpdated, onEmailAll, onBack }) {
  const [openInvoiceId, setOpenInvoiceId] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    await downloadRunPdfs(invoices || [], term);
    setDownloading(false);
  };

  const openInvoice = openInvoiceId ? (invoices || []).find((i) => i.id === openInvoiceId) : null;
  if (openInvoice) {
    return html`<${InvoiceDetail} invoice=${openInvoice} terms=${term ? [term] : []} onBack=${() => setOpenInvoiceId(null)}
      onSaved=${(updated) => { onInvoiceUpdated(updated); setOpenInvoiceId(null); }} />`;
  }

  return html`
    <div class="tab-content">
      <${AdminHeadInvoices} title=${term?.name || 'Invoice run'} onBack=${onBack} />
      <div class="card" style="margin-bottom:14px;">
        <p class="form-hint" style="margin:0;">Invoice date: ${formatInvoiceDate(run.invoice_date)}</p>
        <p class="form-hint" style="margin:0;">Standard due date: ${formatInvoiceDate(run.due_date)}</p>
        <p class="form-hint" style="margin:0;">Fee: ${formatCents(run.fee_cents)}</p>
      </div>

      <button class="btn btn-primary" style="width:100%;margin-bottom:10px;" disabled=${!invoices || invoices.length === 0}
        onClick=${onEmailAll}>
        Email invoices to ${invoices ? invoices.length : 0} member${invoices?.length === 1 ? '' : 's'}
      </button>
      <button class="btn btn-outline" style="width:100%;margin-bottom:16px;" disabled=${downloading || !invoices}
        onClick=${download}>
        ${downloading ? 'Preparing ZIP…' : `Download PDFs${invoices ? ` (${invoices.length})` : ''}`}
      </button>

      ${!invoices
        ? html`<${LoadingState} label="Loading invoices…" />`
        : html`<div class="rep-song-list">
            ${invoices.map((inv) => html`
              <button key=${inv.id} class="rep-song-row" onClick=${() => setOpenInvoiceId(inv.id)}>
                <span class="rep-song-title">#${inv.invoice_number} — ${inv.member_name}</span>
                ${STATUS_LABEL[inv.status]
                  ? html`<span class="event-type-badge ${STATUS_BADGE_CLASS[inv.status]}">${STATUS_LABEL[inv.status]}</span>`
                  : html`<span class="form-hint">Due ${formatInvoiceDate(inv.due_date)}</span>`}
                <${IconChevron} size=${16} />
              </button>
            `)}
          </div>`}
    </div>
  `;
}

function InvoiceDetail({ invoice, terms, onBack, onSaved }) {
  const [editingDue, setEditingDue] = useState(false);
  const [dueDate, setDueDate] = useState(invoice.due_date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmingWaive, setConfirmingWaive] = useState(false);

  // --- Send invoice email ---------------------------------------------------------------
  const term = terms?.find((t) => t.id === invoice.term_id);
  const termLabel = term ? parseTermLabel(term) : { number: '?', year: new Date(invoice.invoice_date).getFullYear() };
  const firstName = (invoice.member_name || '').trim().split(/\s+/)[0] || 'there';
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailMessage, setEmailMessage] = useState(
    `Hi ${firstName},\n\nHere's your invoice for Term ${termLabel.number} ${termLabel.year} — ${formatCents(invoice.amount_cents)}, due ${formatInvoiceDate(invoice.due_date)}.\n\nThanks,\nSonario`,
  );
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState(null);
  const [emailSentJustNow, setEmailSentJustNow] = useState(false);

  const sendEmail = async () => {
    setEmailBusy(true); setEmailError(null);
    try {
      const pdfBytes = await buildInvoicePdfBytes({
        invoiceNumberLabel: String(invoice.invoice_number),
        memberName: invoice.member_name,
        memberEmail: invoice.member_email,
        invoiceDateStr: formatInvoiceDate(invoice.invoice_date),
        dueDateStr: formatInvoiceDate(invoice.due_date),
        amountCents: invoice.amount_cents,
        termLabel,
      });
      const { data, error: err } = await sendInvoiceEmail({
        invoiceId: invoice.id,
        toEmail: invoice.member_email,
        subject: `Sonario invoice — Term ${termLabel.number} ${termLabel.year}`,
        message: emailMessage,
        pdfBase64: bytesToBase64(pdfBytes),
        pdfFilename: invoiceFilename(invoice),
      });
      setEmailBusy(false);
      if (err) { setEmailError(err.message || 'Failed to send'); return; }
      if (data?.error) { setEmailError(data.error); return; }
      setSendingEmail(false);
      setEmailSentJustNow(true);
      if (data?.invoice) onSaved(data.invoice);
    } catch (err) {
      setEmailBusy(false);
      setEmailError(String(err?.message ?? err));
    }
  };

  const saveDueDate = async () => {
    setBusy(true); setError(null);
    const { data, error: err } = await updateInvoiceDueDate(invoice.id, dueDate);
    setBusy(false);
    if (err) { setError(err.message); return; }
    if (!data) { setError("That didn't save — reload and try again."); return; }
    onSaved(data);
  };

  // Every status action shares this shape: call the RPC, show its own error message on failure
  // (each one already reads like a sentence, e.g. "Invoice not found or not currently due."),
  // otherwise hand the fresh row straight up.
  const runAction = (fn) => async () => {
    setBusy(true); setError(null);
    const { data, error: err } = await fn(invoice.id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSaved(data);
  };
  const doConfirm = runAction(confirmInvoicePayment);
  const doReject = runAction(rejectInvoicePayment);
  const doMarkPaid = runAction(markInvoicePaid);
  const doHold = runAction(holdInvoice);
  const doResume = runAction(resumeInvoice);
  const doWaive = async () => { await runAction(waiveInvoice)(); setConfirmingWaive(false); };

  return html`
    <div class="tab-content">
      <${AdminHeadInvoices} title=${`Invoice #${invoice.invoice_number}`} onBack=${onBack} />
      <div class="card form-card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
          <div>
            <p style="margin:0;font-weight:700;">${invoice.member_name}</p>
            <p class="form-hint" style="margin:0;">${invoice.member_email}</p>
          </div>
          ${STATUS_LABEL[invoice.status]
            ? html`<span class="event-type-badge ${STATUS_BADGE_CLASS[invoice.status]}">${STATUS_LABEL[invoice.status]}</span>`
            : null}
        </div>
        <p class="form-hint" style="margin:10px 0 0;">Invoice date: ${formatInvoiceDate(invoice.invoice_date)}</p>
        <p class="form-hint" style="margin:0;">Amount: ${formatCents(invoice.amount_cents)}</p>

        ${editingDue ? html`
          <label>
            Due date
            <input type="date" value=${dueDate} onInput=${(e) => setDueDate(e.target.value)} />
          </label>
          <div class="form-actions">
            <button class="btn btn-primary btn-sm" disabled=${busy} onClick=${saveDueDate}>${busy ? 'Saving…' : 'Save due date'}</button>
            <button class="btn-quiet" disabled=${busy} onClick=${() => { setEditingDue(false); setDueDate(invoice.due_date); }}>Cancel</button>
          </div>
        ` : html`
          <p style="margin:0;">Due date: <strong>${formatInvoiceDate(invoice.due_date)}</strong></p>
          ${invoice.due_date_updated_at ? html`
            <p class="form-hint" style="margin:0;">Changed ${formatInvoiceDate(invoice.due_date_updated_at.slice(0, 10))}</p>
          ` : null}
          <button class="btn btn-outline btn-sm" disabled=${busy || invoice.status === 'paid' || invoice.status === 'waived'}
            onClick=${() => setEditingDue(true)}>Change due date</button>
        `}
      </div>

      <div class="card" style="margin-top:16px;">
        ${sendingEmail ? html`
          <p style="margin:0 0 8px;font-weight:700;">Send invoice email</p>
          <p class="form-hint" style="margin:0 0 10px;">To ${invoice.member_email}, from the Sonario Gmail.</p>
          <label>
            Message
            <textarea rows="7" style="font-family:inherit;" value=${emailMessage}
              onInput=${(e) => setEmailMessage(e.target.value)}></textarea>
          </label>
          ${emailError ? html`<p class="absence-error" style="margin:8px 0 0;">${emailError}</p>` : null}
          <div class="form-actions" style="margin-top:10px;">
            <button class="btn btn-primary btn-sm" disabled=${emailBusy} onClick=${sendEmail}>
              ${emailBusy ? 'Sending…' : 'Send email'}
            </button>
            <button class="btn-quiet" disabled=${emailBusy} onClick=${() => { setSendingEmail(false); setEmailError(null); }}>Cancel</button>
          </div>
        ` : html`
          <p style="margin:0 0 4px;font-weight:700;">Invoice email</p>
          ${invoice.email_sent_at
            ? html`<p class="form-hint" style="margin:0 0 10px;">Last sent ${formatInvoiceDate(invoice.email_sent_at.slice(0, 10))}.</p>`
            : html`<p class="form-hint" style="margin:0 0 10px;">Not sent yet.</p>`}
          ${emailSentJustNow ? html`<p class="form-saved" style="margin:0 0 10px;">Sent ✓</p>` : null}
          <button class="btn btn-outline btn-sm" onClick=${() => setSendingEmail(true)}>
            ${invoice.email_sent_at ? 'Send again' : 'Send invoice email'}
          </button>
        `}
      </div>

      ${error ? html`<p class="absence-error">${error}</p>` : null}

      ${invoice.status === 'payment_reported' ? html`
        <div class="card" style="margin-top:16px;">
          <p style="margin:0 0 4px;font-weight:700;">
            ${invoice.member_name} reported this paid
            ${invoice.payment_reported_at ? ` on ${formatInvoiceDate(invoice.payment_reported_at.slice(0, 10))}` : ''}.
          </p>
          <p class="form-hint" style="margin:0 0 12px;">Confirm once you can see the funds have actually arrived.</p>
          <div class="form-actions">
            <button class="btn btn-primary btn-sm" disabled=${busy} onClick=${doConfirm}>Confirm payment</button>
            <button class="btn-quiet" disabled=${busy} onClick=${doReject}>Not received</button>
          </div>
        </div>
      ` : null}

      ${invoice.status === 'due' ? html`
        <div class="card" style="margin-top:16px;">
          <p style="margin:0 0 12px;font-weight:700;">More actions</p>
          <div class="form-actions" style="flex-wrap:wrap;">
            <button class="btn btn-outline btn-sm" disabled=${busy} onClick=${doMarkPaid}>Mark as paid</button>
            <button class="btn btn-outline btn-sm" disabled=${busy} onClick=${doHold}>Put on hold</button>
            <button class="btn-quiet" disabled=${busy} onClick=${() => setConfirmingWaive(true)}>Waive invoice</button>
          </div>
        </div>
      ` : null}

      ${invoice.status === 'on_hold' ? html`
        <div class="card" style="margin-top:16px;background:var(--bg);box-shadow:none;">
          <p style="margin:0 0 4px;font-weight:700;">Automatic reminders are paused.</p>
          <p class="form-hint" style="margin:0 0 12px;">Use this for an open-ended arrangement or payment plan.</p>
          <div class="form-actions">
            <button class="btn btn-primary btn-sm" disabled=${busy} onClick=${doResume}>Resume reminders</button>
            <button class="btn-quiet" disabled=${busy} onClick=${() => setConfirmingWaive(true)}>Waive invoice</button>
          </div>
        </div>
      ` : null}

      ${invoice.status === 'paid' ? html`
        <div class="card" style="margin-top:16px;background:var(--green-bg);box-shadow:none;">
          <p style="margin:0;font-weight:700;color:var(--green);">
            Paid${invoice.payment_confirmed_at ? ` · confirmed ${formatInvoiceDate(invoice.payment_confirmed_at.slice(0, 10))}` : ''}
          </p>
        </div>
      ` : null}

      ${invoice.status === 'waived' ? html`
        <div class="card" style="margin-top:16px;background:var(--bg);box-shadow:none;">
          <p style="margin:0;font-weight:700;">Waived — no payment required.</p>
        </div>
      ` : null}

      ${confirmingWaive ? html`
        <div class="card" style="background:var(--purple-light);box-shadow:none;margin-top:16px;">
          <p style="margin:0 0 12px;">
            Waive this invoice? No payment will be required and reminders stop. This can't be undone
            here — reversing a waived invoice would need a separate correction later.
          </p>
          <div class="form-actions">
            <button class="btn btn-primary btn-sm" disabled=${busy} onClick=${doWaive}>${busy ? 'Saving…' : 'Yes, waive it'}</button>
            <button class="btn-quiet" disabled=${busy} onClick=${() => setConfirmingWaive(false)}>Cancel</button>
          </div>
        </div>
      ` : null}
    </div>
  `;
}
