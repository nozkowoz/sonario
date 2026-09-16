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
} from './store.js';
import { LoadingState, EmptyState } from './shell.js';
import { IconBack, IconChevron } from './icons.js';

// --- Sonario's fixed invoice details --------------------------------------------------------
// Nina, 2026-09-17: real details from the current invoices, not placeholders. The fee itself is
// the one thing expected to change over time, hence it living in invoice_settings instead of here.
const SONARIO_ABN = '64 562 823 088';
const SONARIO_EMAIL = 'sonario.au@gmail.com';

const AdminHeadInvoices = ({ title, onBack }) => html`
  <div class="detail-head">
    <button class="icon-btn" aria-label="Back" onClick=${onBack}><${IconBack} size=${20} /></button>
    <h2 class="admin-head-title">${title}</h2>
  </div>
`;

const formatCents = (cents) => `$${(cents / 100).toFixed(2)}`;
const centsFromDollarsInput = (v) => Math.round(Number(v) * 100);

const INV_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Plain "16 Sep 2026" — no weekday. Every existing date formatter in lib.js either includes one or
// is uppercase-rail-styled; an invoice wants neither, so this stays local rather than exported.
function formatInvoiceDate(dateStr) {
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
function parseTermLabel(term) {
  const m = /Term\s+(\d+)\s+(\d{4})/.exec(term?.name || '');
  if (m) return { number: m[1], year: m[2] };
  const year = term?.starts_on ? parseLocalDate(term.starts_on).getFullYear() : new Date().getFullYear();
  return { number: term?.name || '?', year };
}

const slug = (s) => String(s || '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '');
const invoiceFilename = (invoice) => `Invoice-${invoice.invoice_number}-${slug(invoice.member_name)}.pdf`;

function downloadBlob(blob, filename) {
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
// this session's transcript): looked wrong, worse than Helvetica. Staying on Helvetica Bold until
// Nina can supply an actual static "Black"/900 font file or a real logo image — swapping either in
// is a single change here (a new embedFont call, or embedPng/embedJpg + drawImage for a logo).
async function buildInvoicePdfBytes({
  invoiceNumberLabel, memberName, memberEmail, invoiceDateStr, dueDateStr, amountCents, termLabel,
  isSample = false,
}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4, in points
  const { width } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const wordmark = bold;
  const ink = rgb(0.13, 0.11, 0.18);
  const soft = rgb(0.35, 0.33, 0.44);
  const warn = rgb(0.71, 0.2, 0.18);

  let y = 780;
  const text = (t, { x = 50, size = 11, f = font, color = ink } = {}) => {
    page.drawText(t, { x, y, size, font: f, color });
  };
  const gap = (n) => { y -= n; };

  text('SONARIO', { size: 28, f: wordmark });
  gap(34);
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
  text('Account name: Sonario', { size: 10 }); gap(14);
  text('Bank: Bendigo Bank', { size: 10 }); gap(14);
  text('BSB: 633-000', { size: 10 }); gap(14);
  text('Account: 171622970', { size: 10 }); gap(14);
  text(`Reference: ${memberName}`, { size: 10 }); gap(30);

  text('Fees are invoiced at the start of each term, due within 7 days of the invoice date,', { size: 9, color: soft });
  gap(12);
  text('and are non-refundable.', { size: 9, color: soft });
  gap(40);

  text('SONARIO', { size: 13, f: wordmark, color: soft });
  gap(15);
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

// ---------------------------------------------------------------------------
// Top-level router for the whole Invoices admin section. Own internal `screen` state, same
// pattern as AdminAttendance's own memberId drill-down — not lifted into admin.js's shared view
// object, since nothing outside this section ever needs to jump straight into a sub-screen here.
// ---------------------------------------------------------------------------
export function AdminInvoices({ terms, directory, profileId, onBack }) {
  const { settings, loading: settingsLoading, setSettings } = useInvoiceSettings();
  const { invoiceRuns, loading: runsLoading, patchInvoiceRun } = useInvoiceRuns();
  const [screen, setScreen] = useState('home');
  const [draft, setDraft] = useState(null); // working state for the create-run flow
  const [activeRun, setActiveRun] = useState(null);
  const [activeRunInvoices, setActiveRunInvoices] = useState(null);

  const openRun = async (run) => {
    setActiveRun(run);
    setActiveRunInvoices(null);
    setScreen('run-detail');
    const { data } = await fetchInvoicesForRun(run.id);
    setActiveRunInvoices(data || []);
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
        await downloadRunPdfs(data || [], terms.find((t) => t.id === run.term_id));
        openRun(run);
      }} />`;
  }
  if (screen === 'run-detail' && activeRun) {
    return html`<${RunDetail} run=${activeRun} invoices=${activeRunInvoices}
      term=${terms.find((t) => t.id === activeRun.term_id)}
      onInvoiceUpdated=${(updated) => setActiveRunInvoices((prev) =>
        (prev || []).map((i) => (i.id === updated.id ? updated : i)))}
      onBack=${() => setScreen('home')} />`;
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
        <p class="form-hint" style="margin:0 0 8px;">1. Invoice email</p>
        <button class="btn btn-outline btn-sm" disabled>Send test email <span class="admin-soon">Soon</span></button>
        <p class="form-hint" style="margin:8px 0 0;">Not built yet — invoices are generated as downloadable PDFs for now.</p>
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

// ---------------------------------------------------------------------------
// Create term invoices — Setup step. Fee is shown, not edited here (edit it from Invoices home
// first) — one place to change the fee, not two.
// ---------------------------------------------------------------------------
function CreateRunSetup({ terms, settings, onBack, onContinue }) {
  const sortedTerms = useMemo(() => [...terms].sort((a, b) => b.starts_on.localeCompare(a.starts_on)), [terms]);
  const [termId, setTermId] = useState(sortedTerms[0]?.id || '');
  const [invoiceDate, setInvoiceDate] = useState(todayStr());
  const dueDate = addDays(invoiceDate, 7);

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
        <label>
          Invoice date
          <input type="date" value=${invoiceDate} onInput=${(e) => setInvoiceDate(e.target.value)} />
        </label>
        <p class="form-hint" style="margin:0;">Due date: <strong>${formatInvoiceDate(dueDate)}</strong> (invoice date + 7 days)</p>
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
// A past run's detail: every invoice in it, a repeatable Download PDFs button (regenerates fresh
// from stored data every time, so a failed browser download never means "go create another run" —
// see 0015's header on why nothing here needs the PDF bytes to have been stored anywhere), and a
// way into each invoice's own Change due date action.
// ---------------------------------------------------------------------------
function RunDetail({ run, invoices, term, onInvoiceUpdated, onBack }) {
  const [openInvoiceId, setOpenInvoiceId] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    await downloadRunPdfs(invoices || [], term);
    setDownloading(false);
  };

  const openInvoice = openInvoiceId ? (invoices || []).find((i) => i.id === openInvoiceId) : null;
  if (openInvoice) {
    return html`<${InvoiceDetail} invoice=${openInvoice} onBack=${() => setOpenInvoiceId(null)}
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

      <button class="btn btn-primary" style="width:100%;margin-bottom:16px;" disabled=${downloading || !invoices}
        onClick=${download}>
        ${downloading ? 'Preparing ZIP…' : `Download PDFs${invoices ? ` (${invoices.length})` : ''}`}
      </button>

      ${!invoices
        ? html`<${LoadingState} label="Loading invoices…" />`
        : html`<div class="rep-song-list">
            ${invoices.map((inv) => html`
              <button key=${inv.id} class="rep-song-row" onClick=${() => setOpenInvoiceId(inv.id)}>
                <span class="rep-song-title">#${inv.invoice_number} — ${inv.member_name}</span>
                <span class="form-hint">Due ${formatInvoiceDate(inv.due_date)}</span>
                <${IconChevron} size=${16} />
              </button>
            `)}
          </div>`}
    </div>
  `;
}

function InvoiceDetail({ invoice, onBack, onSaved }) {
  const [editingDue, setEditingDue] = useState(false);
  const [dueDate, setDueDate] = useState(invoice.due_date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setBusy(true); setError(null);
    const { data, error: err } = await updateInvoiceDueDate(invoice.id, dueDate);
    setBusy(false);
    if (err) { setError(err.message); return; }
    if (!data) { setError("That didn't save — reload and try again."); return; }
    onSaved(data);
  };

  return html`
    <div class="tab-content">
      <${AdminHeadInvoices} title=${`Invoice #${invoice.invoice_number}`} onBack=${onBack} />
      <div class="card form-card">
        <p style="margin:0;font-weight:700;">${invoice.member_name}</p>
        <p class="form-hint" style="margin:0;">${invoice.member_email}</p>
        <p class="form-hint" style="margin:0;">Invoice date: ${formatInvoiceDate(invoice.invoice_date)}</p>
        <p class="form-hint" style="margin:0;">Amount: ${formatCents(invoice.amount_cents)}</p>

        ${editingDue ? html`
          <label>
            Due date
            <input type="date" value=${dueDate} onInput=${(e) => setDueDate(e.target.value)} />
          </label>
          <div class="form-actions">
            <button class="btn btn-primary btn-sm" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save due date'}</button>
            <button class="btn-quiet" disabled=${busy} onClick=${() => { setEditingDue(false); setDueDate(invoice.due_date); }}>Cancel</button>
          </div>
          ${error ? html`<p class="absence-error">${error}</p>` : null}
        ` : html`
          <p style="margin:0;">Due date: <strong>${formatInvoiceDate(invoice.due_date)}</strong></p>
          ${invoice.due_date_updated_at ? html`
            <p class="form-hint" style="margin:0;">Changed ${formatInvoiceDate(invoice.due_date_updated_at.slice(0, 10))}</p>
          ` : null}
          <button class="btn btn-outline btn-sm" onClick=${() => setEditingDue(true)}>Change due date</button>
        `}
      </div>
    </div>
  `;
}
