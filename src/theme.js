// Dark and light palettes matching GitHub's contribution graph colors.
export const THEMES = {
  dark: {
    name: 'dark',
    bg: '#0d1117',
    surface: '#161b22',
    borderSubtle: '#30363d',
    text: '#e6edf3',
    textMuted: '#8b949e',
    empty: '#161b22',
    emptyBorder: 'rgba(255,255,255,0.04)',
    levels: ['#0e4429', '#006d32', '#26a641', '#39d353'],
    food: '#39d353',
    foodGlow: 'rgba(57, 211, 83, 0.35)',
    gold: '#e3b341',
    goldGlow: 'rgba(227, 179, 65, 0.45)',
    head: '#39d353',
    eyes: '#0d1117',
    eyeWhite: '#f0f6fc',
    blush: '#f778ba',
    tongue: '#ff7b72',
    death: '#da3633',
    deathDark: '#8b2c2a',
    accent: '#39d353',
  },
  light: {
    name: 'light',
    bg: '#ffffff',
    surface: '#f6f8fa',
    borderSubtle: '#d0d7de',
    text: '#1f2328',
    textMuted: '#57606a',
    empty: '#ebedf0',
    emptyBorder: 'rgba(27,31,36,0.06)',
    levels: ['#9be9a8', '#40c463', '#30a14e', '#216e39'],
    food: '#216e39',
    foodGlow: 'rgba(33, 110, 57, 0.3)',
    gold: '#bf8700',
    goldGlow: 'rgba(191, 135, 0, 0.35)',
    head: '#216e39',
    eyes: '#1f2328',
    eyeWhite: '#ffffff',
    blush: '#bf3989',
    tongue: '#cf222e',
    death: '#cf222e',
    deathDark: '#a40e26',
    accent: '#1a7f37',
  },
};

// Colorblind palette: blue ramp for growth, orange for danger — mirrors
// GitHub's own colorblind contribution-graph option (red/green safe).
const BLUE = {
  dark: {
    levels: ['#0c2d6b', '#1158c7', '#388bfd', '#79c0ff'],
    food: '#79c0ff',
    foodGlow: 'rgba(121, 192, 255, 0.35)',
    head: '#79c0ff',
    death: '#db6d28',
    deathDark: '#8a4413',
    accent: '#79c0ff',
  },
  light: {
    levels: ['#b6e3ff', '#54aeff', '#0969da', '#0a3069'],
    food: '#0a3069',
    foodGlow: 'rgba(9, 105, 218, 0.3)',
    head: '#0a3069',
    death: '#bc4c00',
    deathDark: '#8a3a00',
    accent: '#0969da',
  },
};

const STORAGE_KEY = 'gh-snake-theme';
const PALETTE_KEY = 'gh-snake-palette';

// The stored *setting* is 'auto' | 'dark' | 'light'; 'auto' follows the
// system scheme (and index.html's pre-paint script treats any non-explicit
// value the same way, so first paint always matches).
export function loadThemeSetting() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'dark' || saved === 'light' ? saved : 'auto';
}

export function resolveThemeName(setting) {
  if (setting === 'dark' || setting === 'light') return setting;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function loadPalette() {
  return localStorage.getItem(PALETTE_KEY) === 'blue' ? 'blue' : 'green';
}

export function applyTheme(setting, palette = 'green') {
  const base = THEMES[resolveThemeName(setting)] || THEMES.dark;
  const t = palette === 'blue' ? { ...base, ...BLUE[base.name] } : base;
  localStorage.setItem(PALETTE_KEY, palette);
  const root = document.documentElement;
  root.style.setProperty('--bg', t.bg);
  root.style.setProperty('--surface', t.surface);
  root.style.setProperty('--border', t.borderSubtle);
  root.style.setProperty('--text', t.text);
  root.style.setProperty('--text-muted', t.textMuted);
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--share-bonus', t.gold);
  root.style.setProperty('--level-0', t.empty);
  root.style.setProperty('--level-1', t.levels[0]);
  root.style.setProperty('--level-2', t.levels[1]);
  root.style.setProperty('--level-3', t.levels[2]);
  root.style.setProperty('--level-4', t.levels[3]);
  root.dataset.theme = t.name;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', t.bg);
  localStorage.setItem(STORAGE_KEY, setting === 'auto' ? 'auto' : t.name);
  return t;
}
