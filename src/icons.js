// Inline SVG icons (16x16, currentColor) — no emoji, no icon font.
const wrap = (inner, filled = true) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ` +
  (filled
    ? `fill="currentColor">`
    : `fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">`) +
  inner + '</svg>';

// Brand marks keep their native 24x24 viewBox. Paths from simple-icons (CC0).
const brand = (inner) =>
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">' +
  inner + '</svg>';

export const icons = {
  play: wrap('<path d="M5 3.5a.5.5 0 0 1 .77-.42l7 4.5a.5.5 0 0 1 0 .84l-7 4.5A.5.5 0 0 1 5 12.5v-9Z"/>'),
  pause: wrap('<rect x="3.5" y="3" width="3" height="10" rx="1"/><rect x="9.5" y="3" width="3" height="10" rx="1"/>'),
  check: wrap('<path d="M3.5 8.5l3 3 6-7"/>', false),
  sun: wrap(
    '<circle cx="8" cy="8" r="3" fill="currentColor" stroke="none"/>' +
    '<path d="M8 1.2v1.8M8 13v1.8M1.2 8H3M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M12.8 3.2l-1.3 1.3M4.5 11.5l-1.3 1.3"/>',
    false),
  moon: wrap('<path d="M13.8 9.6A6.3 6.3 0 1 1 6.4 2.2a5.1 5.1 0 0 0 7.4 7.4Z"/>'),
  // Auto theme: half-filled circle (follows the system scheme).
  autoTheme: wrap(
    '<circle cx="8" cy="8" r="5.5"/>' +
    '<path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" stroke="none"/>',
    false),
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
  target: wrap(
    '<circle cx="7.2" cy="8.8" r="5.1"/><circle cx="7.2" cy="8.8" r="2.2"/>' +
    '<path d="m9 7 4.8-4.8M10.8 2.2h3v3"/>',
    false),
  flame: wrap('<path d="M8 1.4c2.2 2.3 3.5 4.3 3.5 6.7a3.5 3.5 0 1 1-7 0c0-1.2.5-2.3 1.2-3.1-.1.9.4 1.7 1.1 1.8C6 5.5 6.6 3.3 8 1.4Z"/>'),
  sparkle: wrap(
    '<path d="m8 1.6 1.1 3.3L12.4 6 9.1 7.1 8 10.4 6.9 7.1 3.6 6l3.3-1.1L8 1.6Z"/>' +
    '<path d="m12.6 9.5.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5Z"/>'),
  // Race: a checkered-ish flag for "race this run".
  race: wrap(
    '<path d="M3.5 14V2.2"/>' +
    '<path d="M3.5 2.5h9l-1.8 2.9 1.8 2.9h-9Z" fill="currentColor" stroke="none"/>',
    false),
  up: wrap('<path d="M8 4.2 13 11H3l5-6.8Z"/>'),
  down: wrap('<path d="M8 11.8 3 5h10l-5 6.8Z"/>'),
  left: wrap('<path d="M4.2 8 11 3v10L4.2 8Z"/>'),
  right: wrap('<path d="M11.8 8 5 13V3l6.8 5Z"/>'),
  x: brand('<path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/>'),
  bluesky: brand('<path d="M5.202 2.857C7.954 4.922 10.913 9.11 12 11.358c1.087-2.247 4.046-6.436 6.798-8.501C20.783 1.366 24 .213 24 3.883c0 .732-.42 6.156-.667 7.037-.856 3.061-3.978 3.842-6.755 3.37 4.854.826 6.089 3.562 3.422 6.299-5.065 5.196-7.28-1.304-7.847-2.97-.104-.305-.152-.448-.153-.327 0-.121-.05.022-.153.327-.568 1.666-2.782 8.166-7.847 2.97-2.667-2.737-1.432-5.473 3.422-6.3-2.777.473-5.899-.308-6.755-3.369C.42 10.04 0 4.615 0 3.883c0-3.67 3.217-2.517 5.202-1.026"/>'),
  threads: brand('<path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z"/>'),
};

// Achievement badge icons. Same 16x16 / currentColor system as above — the CSS
// sizes them up inside the badge. Default is stroked; filled glyphs opt in per
// element with fill="currentColor" stroke="none".
const achWrap = (inner) =>
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  inner + '</svg>';

const solid = (d) => `<path fill="currentColor" stroke="none" d="${d}"/>`;

export const achIcons = {
  // First Bite — a pac-man-style wedge (eating).
  firstBite: achWrap(solid('M8 8 13.6 5.4A6 6 0 1 0 13.6 10.6Z')),
  // Regular — repeat / play-again arrows.
  regular: achWrap('<path d="M3.6 8a4.5 4.5 0 0 1 7.7-3.2"/><path d="M11.5 2.3v2.7H8.8"/>' +
    '<path d="M12.4 8a4.5 4.5 0 0 1-7.7 3.2"/><path d="M4.5 13.7V11h2.7"/>'),
  // Committed — trophy.
  committed: achWrap('<path fill="currentColor" stroke="none" d="M4.6 2.5h6.8V6a3.4 3.4 0 0 1-6.8 0V2.5Z"/>' +
    '<path d="M4.6 3.6H3.2A1.4 1.4 0 0 0 3.2 6.4h1.2"/><path d="M11.4 3.6h1.4a1.4 1.4 0 0 1 0 2.8h-1.2"/>' +
    '<path fill="currentColor" stroke="none" d="M7.25 9h1.5v2.1h-1.5z"/>' +
    '<path fill="currentColor" stroke="none" d="M5 12h6a.6.6 0 0 1 .6.6v.9H4.4v-.9A.6.6 0 0 1 5 12Z"/>'),
  // Century — medal with a star.
  century: achWrap('<path d="M6 2.3 4.7 5.3M10 2.3l1.3 3"/><circle cx="8" cy="10" r="3.9"/>' +
    solid('m8 7.7.85 1.75 1.9.2-1.42 1.3.4 1.9L8 12.05 6.27 13l.4-1.9L5.25 9.8l1.9-.2L8 7.7Z')),
  // On Fire — flame.
  onFire: achWrap(solid('M8 1.4c2.2 2.3 3.5 4.3 3.5 6.7a3.5 3.5 0 1 1-7 0c0-1.2.5-2.3 1.2-3.1-.1.9.4 1.7 1.1 1.8C6 5.5 6.6 3.3 8 1.4Z')),
  // Combo Chain — lightning bolt.
  comboChain: achWrap(solid('M9 1.4 3.8 8.7c-.25.35 0 .8.45.8H7l-1 5.3c-.1.55.6.85.95.4l5.35-7.9c.25-.35 0-.8-.45-.8H8.75l1-4.2c.12-.55-.55-.85-.9-.4Z')),
  // Unbroken — two interlocking chain links.
  unbroken: achWrap('<rect x="2.3" y="5.6" width="7.3" height="4.8" rx="2.4"/><rect x="6.4" y="5.6" width="7.3" height="4.8" rx="2.4"/>'),
  // Full Year — a filled 3x3 contribution grid.
  fullYear: achWrap('<g fill="currentColor" stroke="none">' +
    '<rect x="2" y="2" width="3.3" height="3.3" rx=".7"/><rect x="6.35" y="2" width="3.3" height="3.3" rx=".7"/><rect x="10.7" y="2" width="3.3" height="3.3" rx=".7"/>' +
    '<rect x="2" y="6.35" width="3.3" height="3.3" rx=".7"/><rect x="6.35" y="6.35" width="3.3" height="3.3" rx=".7"/><rect x="10.7" y="6.35" width="3.3" height="3.3" rx=".7"/>' +
    '<rect x="2" y="10.7" width="3.3" height="3.3" rx=".7"/><rect x="6.35" y="10.7" width="3.3" height="3.3" rx=".7"/><rect x="10.7" y="10.7" width="3.3" height="3.3" rx=".7"/></g>'),
  // Daily Devotee — calendar with a check.
  dailyDevotee: achWrap('<rect x="2.5" y="3.2" width="11" height="10.3" rx="1.5"/><path d="M2.5 6.2h11"/>' +
    '<path d="M5.3 1.9v2.3M10.7 1.9v2.3"/><path d="m5.9 9.7 1.5 1.6 3-3.3"/>'),
  // Rule Bender — a die (chance / variants).
  ruleBender: achWrap('<rect x="2.5" y="2.5" width="11" height="11" rx="2.6"/><g fill="currentColor" stroke="none">' +
    '<circle cx="5.6" cy="5.6" r="1"/><circle cx="10.4" cy="5.6" r="1"/><circle cx="8" cy="8" r="1"/>' +
    '<circle cx="5.6" cy="10.4" r="1"/><circle cx="10.4" cy="10.4" r="1"/></g>'),
  // Gold Rush — a coin with a sparkle (golden commits).
  goldRush: achWrap('<circle cx="8" cy="8" r="5.6"/>' +
    solid('m8 4.6.95 2.05 2.25.25-1.65 1.55.45 2.2L8 9.55l-2 1.1.45-2.2L4.8 6.9l2.25-.25L8 4.6Z')),
};
