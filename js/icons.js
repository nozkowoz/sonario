import { html } from './lib.js';

// Inline SVG rather than an icon font or a CDN sprite: there are only a handful, they inherit
// `currentColor` so they follow the surrounding text state (active nav item, muted meta line),
// and it keeps the zero-dependency, zero-build promise the rest of the app is built on.
const svg = (children, { size = 22, fill = 'none', stroke = true } = {}) => html`
  <svg width=${size} height=${size} viewBox="0 0 24 24" fill=${fill} aria-hidden="true"
    stroke=${stroke ? 'currentColor' : 'none'} stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round">${children}</svg>
`;

export const IconHome = ({ size }) => svg(html`
  <path d="M3 10.5 12 3l9 7.5" />
  <path d="M5.5 9.5V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5" />
`, { size });

export const IconCalendar = ({ size }) => svg(html`
  <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
  <path d="M3.5 9.5h17M8.5 3v4M15.5 3v4" />
`, { size });

export const IconMore = ({ size }) => svg(html`
  <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
  <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
  <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
`, { size });

// Vertical dots — the per-event admin menu, matching the mockup's ⋮ affordance.
export const IconKebab = ({ size }) => svg(html`
  <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
  <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
  <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
`, { size });

export const IconPin = ({ size }) => svg(html`
  <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
  <circle cx="12" cy="10" r="2.5" />
`, { size });

export const IconBack = ({ size }) => svg(html`<path d="M15 5l-7 7 7 7" />`, { size });

export const IconCheck = ({ size }) => svg(html`<path d="M5 12.5l4.5 4.5L19 7.5" />`, { size });

export const IconNote = ({ size }) => svg(html`
  <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
  <path d="M8 9h8M8 13h8M8 17h5" />
`, { size });

export const IconEdit = ({ size }) => svg(html`
  <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" />
`, { size });

export const IconReschedule = ({ size }) => svg(html`
  <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
  <path d="M3.5 9.5h17M8.5 3v4M15.5 3v4M12 13v3l2 1" />
`, { size });

export const IconCancel = ({ size }) => svg(html`
  <circle cx="12" cy="12" r="8.5" />
  <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" />
`, { size });

export const IconUsers = ({ size }) => svg(html`
  <circle cx="9" cy="8.5" r="3.2" />
  <path d="M3.5 20c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2" />
  <path d="M16 5.6a3.2 3.2 0 0 1 0 6.3M17.5 14.9c2.1.5 3.5 2.3 3.5 4.4" />
`, { size });

export const IconAlert = ({ size }) => svg(html`
  <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
  <path d="M12 7.5v5.5" stroke="#fff" stroke-width="2" />
  <circle cx="12" cy="16.4" r="1.15" fill="#fff" stroke="none" />
`, { size });
