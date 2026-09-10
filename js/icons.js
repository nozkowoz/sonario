import { html } from './lib.js';

// Inline SVG rather than an icon font or a CDN sprite: there are only a handful, they inherit
// `currentColor` so they follow the surrounding text state (active nav item, muted meta line),
// and it keeps the zero-dependency, zero-build promise the rest of the app is built on.
const svg = (children, { size = 22, fill = 'none', stroke = true } = {}) => html`
  <svg width=${size} height=${size} viewBox="0 0 24 24" fill=${fill} aria-hidden="true"
    stroke=${stroke ? 'currentColor' : 'none'} stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round">${children}</svg>
`;

// Nav icons take `active` and switch between outline and filled, per the icon sheet's
// unselected/selected pair. Done in SVG rather than as the sheet's PNG exports: one definition
// covers both states, it scales, and it inherits the active colour from `currentColor`.
export const IconHome = ({ size, active }) => (active
  ? svg(html`
      <path d="M3 10.9 12 3.2l9 7.7v9.1a1 1 0 0 1-1 1h-5.2v-5.6H9.2V21H4a1 1 0 0 1-1-1v-9.1Z"
        fill="currentColor" stroke="none" />
    `, { size })
  : svg(html`
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5" />
    `, { size }));

export const IconCalendar = ({ size, active }) => (active
  ? svg(html`
      <path d="M3.5 9.5h17V18a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V9.5Z"
        fill="currentColor" stroke="none" />
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M8.5 3v4M15.5 3v4" />
    `, { size })
  : svg(html`
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8.5 3v4M15.5 3v4" />
    `, { size }));

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

// "Notice / Alert" on the icon sheet is a megaphone rather than a warning symbol — which reads
// better anyway: an organiser's note about tonight is an announcement, not a hazard.
export const IconMegaphone = ({ size }) => svg(html`
  <path d="M4 10.5v3a1.5 1.5 0 0 0 1.5 1.5H7l9.5 4V5L7 9H5.5A1.5 1.5 0 0 0 4 10.5Z"
    fill="currentColor" stroke="none" />
  <path d="M19 9.5a3.2 3.2 0 0 1 0 5M7 15v3.5a1.5 1.5 0 0 0 3 0V16" />
`, { size });

// Sliders rather than a shield: this tab is where an organiser adjusts things, not a security
// boundary — the boundary is RLS, and no icon can convey that.
export const IconAdmin = ({ size }) => svg(html`
  <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
  <circle cx="16" cy="7" r="2.2" />
  <circle cx="8" cy="17" r="2.2" />
`, { size });

// Admin's crown, outline when unselected and filled when selected like the other nav icons.
export const IconCrown = ({ size, active }) => (active
  ? svg(html`
      <path d="M4 18h16l1.2-9-5.2 3.4L12 5.5l-4 6.9L2.8 9 4 18Z" fill="currentColor" stroke="none" />
    `, { size })
  : svg(html`
      <path d="M4.6 17.5h14.8l1.4-9.4-5.6 3.6L12 4.8 8.8 11.7 3.2 8.1l1.4 9.4Z" />
    `, { size }));

export const IconChevron = ({ size }) => svg(html`<path d="M9 5l7 7-7 7" />`, { size });

// Repertoire — music note, outline/filled like the rest of the nav set.
export const IconNote2 = ({ size, active }) => (active
  ? svg(html`
      <path d="M9 18V6.6l9-1.8V16" fill="none" />
      <ellipse cx="6.6" cy="18" rx="2.6" ry="2.2" fill="currentColor" stroke="none" />
      <ellipse cx="15.6" cy="16" rx="2.6" ry="2.2" fill="currentColor" stroke="none" />
    `, { size })
  : svg(html`
      <path d="M9 18V6.6l9-1.8V16" />
      <ellipse cx="6.6" cy="18" rx="2.6" ry="2.2" />
      <ellipse cx="15.6" cy="16" rx="2.6" ry="2.2" />
    `, { size }));

export const IconBell = ({ size }) => svg(html`
  <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10Z" />
  <path d="M10 19a2 2 0 0 0 4 0" />
`, { size });

export const IconCheckSquare = ({ size }) => svg(html`
  <rect x="4" y="4" width="16" height="16" rx="4" fill="currentColor" stroke="none" />
  <path d="M8 12.3l2.7 2.7L16 9.7" stroke="#fff" stroke-width="2.1" />
`, { size });

// From Nina's Figma icon export (IcCheck.svg): a solid disc with a white tick cut through it,
// used by the "You're expected" / "You're here" status pill. The disc carries the colour, so it
// sets its own green rather than inheriting currentColor — the pill's text is a darker green
// (#15803D) than the mark (#16A34A) and the two must not be collapsed into one.
export const IconCheckCircle = ({ size = 18 }) => html`
  <svg width=${size} height=${size} viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <circle cx="9" cy="9" r="7.5" fill="currentColor" />
    <path d="M5.6 9.2l2.4 2.3 4.4-4.6" stroke="#fff" stroke-width="1.65"
      stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

// Filled counterpart to IconPin, from IcPin.svg. The hero's location line runs at 13px on purple,
// where an outlined 11px pin disappears — a solid glyph holds at that size.
export const IconPinFilled = ({ size = 11 }) => html`
  <svg width=${size} height=${size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
    <path d="M6 0.9a3.7 3.7 0 0 0-3.7 3.7c0 2.7 3.7 6.5 3.7 6.5s3.7-3.8 3.7-6.5A3.7 3.7 0 0 0 6 0.9Zm0 5.1a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Z" />
  </svg>
`;

// "You're away" / "You can't make it" on a list row. Deliberately NOT IconCancel (a circle with
// an X): on a row that already uses a coral tint and a struck-through title to mean "this event is
// cancelled", an X next to a perfectly healthy concert reads as the event being off rather than
// as the member being absent. A minus reads as excluded-or-excused, which is what it means.
export const IconMinusCircle = ({ size = 16 }) => svg(html`
  <circle cx="12" cy="12" r="8.5" />
  <path d="M8.5 12h7" />
`, { size });
