import { html, useState } from './lib.js';

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

const TABS = [
  { key: 'home', label: 'Home' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'more', label: 'More' },
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
          <span class="bottom-nav-dot"></span>
          ${t.label}
        </button>
      `)}
    </nav>
  `;
}
