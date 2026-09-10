import { html, useState, useEffect, useRef } from './lib.js';
import { IconHome, IconCalendar, IconNote2, IconMore, IconCrown } from './icons.js';

// Reusable states so every tab handles loading/empty/error the same way, rather than each
// screen inventing its own copy and layout.
export function LoadingState({ label = 'Loading…' }) {
  return html`
    <div class="state-block">
      <div class="spinner"></div>
      <p class="state-body">${label}</p>
    </div>
  `;
}

export function EmptyState({ title, body, action = null }) {
  return html`
    <div class="state-block">
      <p class="state-title">${title}</p>
      ${body ? html`<p class="state-body">${body}</p>` : null}
      ${action}
    </div>
  `;
}

export function ErrorState({ title = 'Something went wrong', body, onRetry }) {
  return html`
    <div class="state-block state-error">
      <p class="state-title">${title}</p>
      ${body ? html`<p class="state-body">${body}</p>` : null}
      ${onRetry ? html`<button class="btn btn-outline" onClick=${onRetry}>Try again</button>` : null}
    </div>
  `;
}

// LOCKED ORDER — see DESIGN-RULES.md. Home, Calendar, Repertoire, Admin, More.
// Repertoire is in the nav even though its screen isn't built, because the nav is locked and a
// visible "not built yet" is more honest than a tab that silently isn't there. Admin stays
// super-only, so a member sees four of the five.
const TABS = [
  { key: 'home', label: 'Home', Icon: IconHome },
  { key: 'calendar', label: 'Calendar', Icon: IconCalendar },
  { key: 'repertoire', label: 'Repertoire', Icon: IconNote2 },
  { key: 'admin', label: 'Admin', Icon: IconCrown, superOnly: true },
  { key: 'more', label: 'More', Icon: IconMore },
];

export function useActiveTab(initial = 'home') {
  return useState(initial);
}

// Hiding the tab is presentation only — the Admin screen's contents are protected by RLS, not by
// whether a button was rendered.
export function BottomNav({ active, onChange, canManage = false }) {
  const tabs = TABS.filter((t) => !t.superOnly || canManage);
  return html`
    <nav class="bottom-nav" aria-label="Primary">
      ${tabs.map((t) => html`
        <button
          key=${t.key}
          type="button"
          class="bottom-nav-btn ${active === t.key ? 'active' : ''}"
          aria-current=${active === t.key ? 'page' : 'false'}
          onClick=${() => onChange(t.key)}
        >
          <${t.Icon} active=${active === t.key} />
          <span class="bottom-nav-label">${t.label}</span>
        </button>
      `)}
    </nav>
  `;
}


// ---------------------------------------------------------------------------
// Bottom sheet. Nina's Figma opens an event as a sheet over whatever screen you were on, rather
// than as a screen that replaces it — which is the better model here: you're glancing at one
// rehearsal, not navigating away from your term.
//
// Deliberately NOT <dialog>. Its ::backdrop can't be styled consistently across the mobile
// browsers this PWA actually runs in, and showModal() fights the service worker's cached shell on
// iOS in ways that aren't worth debugging for a panel this simple.
//
// Three things a sheet has to get right, all of which are easy to leave out:
//  - the page behind must not scroll while it's open (otherwise a scroll gesture that starts on
//    the backdrop drags the screen underneath),
//  - Escape and a backdrop tap both close it,
//  - focus moves into it, so a keyboard or screen-reader user isn't left behind on the page.
// ---------------------------------------------------------------------------
export function Sheet({ label, onClose, children }) {
  const panel = useRef(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return html`
    <div class="sheet-backdrop" onClick=${onClose}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label=${label}
        tabindex="-1" ref=${panel}
        onClick=${(e) => e.stopPropagation()}>
        <div class="sheet-grip" aria-hidden="true"><span></span></div>
        <button class="sheet-close" aria-label="Close" onClick=${onClose}>×</button>
        <div class="sheet-body">${children}</div>
      </div>
    </div>
  `;
}
