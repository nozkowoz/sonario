import { html, useState } from './lib.js';
import { IconHome, IconCalendar, IconMore } from './icons.js';

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

// Three tabs, not the mockup's four: Repertoire has no screen behind it yet (Checkpoints 6-8), and
// a nav item that leads nowhere is worse than one that isn't there. Add it when it has content.
const TABS = [
  { key: 'home', label: 'Home', Icon: IconHome },
  { key: 'calendar', label: 'Calendar', Icon: IconCalendar },
  { key: 'more', label: 'More', Icon: IconMore },
];

export function useActiveTab(initial = 'home') {
  return useState(initial);
}

export function BottomNav({ active, onChange }) {
  return html`
    <nav class="bottom-nav" aria-label="Primary">
      ${TABS.map((t) => html`
        <button
          key=${t.key}
          type="button"
          class="bottom-nav-btn ${active === t.key ? 'active' : ''}"
          aria-current=${active === t.key ? 'page' : 'false'}
          onClick=${() => onChange(t.key)}
        >
          <${t.Icon} />
          <span class="bottom-nav-label">${t.label}</span>
        </button>
      `)}
    </nav>
  `;
}
