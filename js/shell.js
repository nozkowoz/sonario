import { html, useState } from './lib.js';
import { IconHome, IconCalendar, IconMore, IconCrown } from './icons.js';

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

// Repertoire still isn't here: it has no screen behind it yet (Checkpoints 6-8), and a nav item
// that leads nowhere is worse than one that isn't there.
//
// Admin sits third with a crown, per Nina's mockup. That does shift More from third to fourth for
// a super, which an earlier pass avoided by appending Admin last — but with a handful of supers
// who each know they're a super, matching the intended design wins over that.
const TABS = [
  { key: 'home', label: 'Home', Icon: IconHome },
  { key: 'calendar', label: 'Calendar', Icon: IconCalendar },
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
