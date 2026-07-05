// Inline SVG icons (16x16, currentColor) — no emoji, no icon font.
const wrap = (inner, filled = true) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ` +
  (filled
    ? `fill="currentColor">`
    : `fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">`) +
  inner + '</svg>';

export const icons = {
  play: wrap('<path d="M5 3.5a.5.5 0 0 1 .77-.42l7 4.5a.5.5 0 0 1 0 .84l-7 4.5A.5.5 0 0 1 5 12.5v-9Z"/>'),
  pause: wrap('<rect x="3.5" y="3" width="3" height="10" rx="1"/><rect x="9.5" y="3" width="3" height="10" rx="1"/>'),
  sun: wrap(
    '<circle cx="8" cy="8" r="3" fill="currentColor" stroke="none"/>' +
    '<path d="M8 1.2v1.8M8 13v1.8M1.2 8H3M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M12.8 3.2l-1.3 1.3M4.5 11.5l-1.3 1.3"/>',
    false),
  moon: wrap('<path d="M13.8 9.6A6.3 6.3 0 1 1 6.4 2.2a5.1 5.1 0 0 0 7.4 7.4Z"/>'),
  volumeOn: wrap(
    '<path d="M7.5 3.2v9.6L4.6 10H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h1.6l2.9-2.8Z" fill="currentColor" stroke="none"/>' +
    '<path d="M10 5.7a3.2 3.2 0 0 1 0 4.6M12 3.9a5.8 5.8 0 0 1 0 8.2"/>',
    false),
  volumeOff: wrap(
    '<path d="M7.5 3.2v9.6L4.6 10H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h1.6l2.9-2.8Z" fill="currentColor" stroke="none"/>' +
    '<path d="M10.2 6.2l3.6 3.6M13.8 6.2l-3.6 3.6"/>',
    false),
  share: wrap(
    '<path d="M8 9.5V1.8M5.4 4.2L8 1.6l2.6 2.6M3.5 8v5.2a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8"/>',
    false),
  palette: wrap(
    '<rect x="2" y="2" width="5" height="5" rx="1.5"/><rect x="9" y="2" width="5" height="5" rx="1.5" opacity="0.7"/>' +
    '<rect x="2" y="9" width="5" height="5" rx="1.5" opacity="0.45"/><rect x="9" y="9" width="5" height="5" rx="1.5" opacity="0.2"/>'),
  up: wrap('<path d="M8 4.2 13 11H3l5-6.8Z"/>'),
  down: wrap('<path d="M8 11.8 3 5h10l-5 6.8Z"/>'),
  left: wrap('<path d="M4.2 8 11 3v10L4.2 8Z"/>'),
  right: wrap('<path d="M11.8 8 5 13V3l6.8 5Z"/>'),
};
