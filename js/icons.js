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

// The detail sheet's meta lines: a clock beside the time, an external-link mark on the location
// (it opens a map, which leaves the app, and a link that leaves should say so).
export const IconClock = ({ size }) => svg(html`
  <circle cx="12" cy="12" r="8.5" />
  <path d="M12 7.5V12l2.5 1.5" />
`, { size });

export const IconExternal = ({ size }) => svg(html`
  <path d="M14 4h6v6" />
  <path d="M20 4l-8 8" />
  <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
`, { size });

// Repertoire (Stage 3): Sonario Classics' star, and the mic for Concert Playlists. No separate
// waveform icon for semester collections — IconNote2 (already in the nav) is reused there rather
// than adding a fourth icon for one card, a deliberate simplification from the Figma's own art.
export const IconStar = ({ size }) => svg(html`
  <path d="M12 3.5l2.6 5.4 5.9.6-4.4 4 1.2 5.9L12 16.6l-5.3 2.8 1.2-5.9-4.4-4 5.9-.6L12 3.5Z" />
`, { size, fill: 'currentColor', stroke: false });

export const IconMic = ({ size }) => svg(html`
  <rect x="9" y="3" width="6" height="11" rx="3" />
  <path d="M5 11a7 7 0 0 0 14 0" />
  <path d="M12 18v3M9 21h6" />
`, { size });

// Recordings (Stage 6): a filled play triangle for each row, and a simple upload arrow for the
// "Choose an audio file" control.
export const IconPlay = ({ size }) => svg(html`
  <path d="M7 4.5v15l13-7.5-13-7.5Z" />
`, { size, fill: 'currentColor', stroke: false });

export const IconUpload = ({ size }) => svg(html`
  <path d="M12 16V4M7 9l5-5 5 5" />
  <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
`, { size });

// Repertoire search (Stage 2 of the Song Detail redesign): replaces the header's upload shortcut.
export const IconSearch = ({ size }) => svg(html`
  <circle cx="10.5" cy="10.5" r="6.5" />
  <path d="M20 20l-5-5" />
`, { size });

// Practice Mode player (Stage 2): filled, matching IconPlay's convention.
export const IconPause = ({ size }) => svg(html`
  <rect x="6" y="4" width="4" height="16" rx="1" />
  <rect x="14" y="4" width="4" height="16" rx="1" />
`, { size, fill: 'currentColor', stroke: false });

export const IconSkipBack = ({ size }) => svg(html`
  <path d="M18 5v14l-11-7 11-7Z" />
  <rect x="5" y="5" width="2" height="14" rx="0.5" />
`, { size, fill: 'currentColor', stroke: false });

export const IconSkipForward = ({ size }) => svg(html`
  <path d="M6 5v14l11-7-11-7Z" />
  <rect x="17" y="5" width="2" height="14" rx="0.5" />
`, { size, fill: 'currentColor', stroke: false });

// Lyrics tab (Song Detail): locked/unlocked for the release status row and the Release button,
// a lightbulb for the "Tip" callout.
export const IconLock = ({ size }) => svg(html`
  <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" />
  <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
`, { size });

export const IconLockOpen = ({ size }) => svg(html`
  <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" />
  <path d="M8 10.5V7.5a4 4 0 0 1 7.3-2.3" />
`, { size });

export const IconBulb = ({ size }) => svg(html`
  <path d="M9.5 18h5M10.2 21h3.6" />
  <path d="M12 3a6 6 0 0 0-3.4 10.9c.5.35.8.9.8 1.5v.1h5.2v-.1c0-.6.3-1.15.8-1.5A6 6 0 0 0 12 3Z" />
`, { size });

// Invoicing (migration 0015): a receipt with a torn bottom edge and a dollar sign, distinct from
// IconAdmin/IconCheckSquare already used by other Admin sections.
export const IconInvoice = ({ size }) => svg(html`
  <path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V3Z" />
  <path d="M9 8h6M9 12h6M9 16h3" />
`, { size });

// Practice Mode player, shuffle/repeat toggles (crossed-arrows / looping-arrows convention).
export const IconShuffle = ({ size }) => svg(html`
  <path d="M17 3h4v4" /><path d="M21 3l-7 7" />
  <path d="M3 17l6-6" /><path d="M3 7l4 0" /><path d="M3 7l6 6" />
  <path d="M21 21l-6-6" /><path d="M17 21h4v-4" />
`, { size });

export const IconRepeat = ({ size }) => svg(html`
  <path d="M17 2l4 4-4 4" /><path d="M3 12V10a4 4 0 0 1 4-4h14" />
  <path d="M7 22l-4-4 4-4" /><path d="M21 12v2a4 4 0 0 1-4 4H3" />
`, { size });

// Repertoire's super-only "Add song" entry point.
export const IconPlus = ({ size }) => svg(html`
  <path d="M12 5v14M5 12h14" />
`, { size });

// Admin > Notifications' "Send notification" button.
export const IconSend = ({ size }) => svg(html`
  <path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7Z" />
`, { size });

// Admin > Attendance home: single member (vs IconUsers' two-person icon) and a plain list.
export const IconUser = ({ size }) => svg(html`
  <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
`, { size });

export const IconList = ({ size }) => svg(html`
  <path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" />
`, { size });

// Invoice Email Setup wizard's step-badge icons.
export const IconMail = ({ size }) => svg(html`
  <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" />
`, { size });

export const IconKey = ({ size }) => svg(html`
  <circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M14 9l2 2" />
`, { size });

// The real Sonario wordmark, vectorised from assets/sonario-logo.svg (Jo's file — same source as
// the raster assets/sonario-wordmark.png the invoice PDF already uses). Inlined rather than an
// <img>, because every place that currently approximates it with styled text sits on a coloured
// background (purple header, etc.) — an <img> of the PNG would carry its own white backing and
// show as a box, where this fills with `currentColor` and follows whatever text colour the
// surrounding element already sets, same as every icon above. 2026-10-01, replacing the
// Big-Shoulders-Display text approximation (see DESIGN-RULES.md and invoices.js's own header on
// why that approximation existed in the first place).
const WORDMARK_VIEWBOX_W = 354.1;
const WORDMARK_VIEWBOX_H = 173.4;
export const SonarioWordmark = ({ height = 26 }) => html`
  <svg height=${height} width=${height * (WORDMARK_VIEWBOX_W / WORDMARK_VIEWBOX_H)}
    viewBox="0 0 ${WORDMARK_VIEWBOX_W} ${WORDMARK_VIEWBOX_H}" fill="currentColor" role="img" aria-label="Sonario">
    <rect x="274.2" y="5.1" width="18.5" height="163.1" />
    <polygon points="132.6 82 145.5 168.3 161.9 168.3 161.9 5.1 146.5 5.1 146.5 91.4 133.6 5.1 117.2 5.1 117.2 168.3 132.6 168.3 132.6 82" />
    <path d="M184.7,136.7h10.2l3.1,31.6h15.5L197.6,5.1h-15.4l-15.9,163.1h15.5l3.1-31.6h0ZM189.9,82l3.3,36.2h-6.6l3.3-36.2Z" />
    <path d="M247.1,168.3h18.5v-63.7c0-6.9-2.3-13.1-5.9-17.9,3.7-4.8,5.9-11.1,5.9-17.9v-36.4c0-15-10.7-27.2-23.9-27.2h-23.9v163.1h18.5v-72.3s5.8,0,6,0c2.4.5,4.8,4.1,4.8,8.7v63.7h0ZM242.3,77.4c-.2,0-6,0-6,0V23.6h5.4c2.5,0,5.4,3.7,5.4,8.7v36.4c0,4.6-2.4,8.2-4.8,8.7" />
    <path d="M334.7,5.1c-2.9-1.5-6.2-2.3-9.6-2.3s-6.6.8-9.6,2.3c-8.4,4.2-14.3,13.8-14.3,24.9v113.3c0,11.1,5.9,20.7,14.3,24.9,2.9,1.5,6.2,2.3,9.6,2.3s6.6-.8,9.6-2.3c8.4-4.2,14.3-13.8,14.3-24.9V30c0-11.1-5.9-20.7-14.3-24.9M330.5,143.4c0,5-2.8,8.7-5.4,8.7s-5.4-3.7-5.4-8.7V30c0-5,2.8-8.7,5.4-8.7s5.4,3.7,5.4,8.7v113.3h0Z" />
    <path d="M94.2,5.1c-2.9-1.5-6.2-2.3-9.6-2.3s-6.7.8-9.6,2.3c-8.4,4.2-14.3,13.8-14.3,24.9v113.3c0,11.1,5.9,20.7,14.3,24.9,2.9,1.5,6.2,2.3,9.6,2.3s6.7-.8,9.6-2.3c8.4-4.2,14.3-13.8,14.3-24.9V30c0-11.1-5.9-20.7-14.3-24.9M90,143.4c0,5-2.8,8.7-5.4,8.7s-5.4-3.7-5.4-8.7V30c0-5,2.8-8.7,5.4-8.7s5.4,3.7,5.4,8.7v113.3h0Z" />
    <path d="M38.6,5.1c-2.9-1.5-6.2-2.3-9.6-2.3s-6.6.8-9.6,2.3c-8.4,4.2-14.3,13.8-14.3,24.9,0,16.3,7,36.2,12.6,52.3.9,2.6,1.8,5.1,2.5,7.3.8,2.3,1.7,4.9,2.6,7.5,4.9,14,11.5,33.1,11.5,46.2s-2.8,8.7-5.4,8.7-5.4-3.7-5.4-8.7v-25.1H5.1v25.1c0,11.1,5.9,20.7,14.3,24.9,2.9,1.5,6.2,2.3,9.6,2.3s6.6-.8,9.6-2.3c8.4-4.2,14.3-13.8,14.3-24.9,0-16.3-7-36.2-12.6-52.3-.9-2.6-1.8-5.1-2.5-7.3-.8-2.3-1.7-4.9-2.6-7.5-4.9-14-11.5-33.1-11.5-46.2s2.8-8.7,5.4-8.7,5.4,3.7,5.4,8.7v25.1h18.5v-25.1c0-11.1-5.9-20.7-14.3-24.9" />
  </svg>
`;
