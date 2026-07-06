import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

// Overridable so a second checkout (or CI) can run dev/e2e side by side
// without fighting over the default ports.
const WEB_PORT = Number(process.env.SNAKE_WEB_PORT) || 5173;
const API_PORT = Number(process.env.SNAKE_API_PORT) || 3001;

export default defineConfig({
  test: {
    // Playwright owns tests/e2e; keep vitest away from those specs.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
  // Relative base so the build works on GitHub Pages project sites.
  base: './',
  server: {
    port: WEB_PORT,
    proxy: {
      '/api': `http://localhost:${API_PORT}`,
      '/r': `http://localhost:${API_PORT}`,
    },
  },
  build: {
    outDir: 'dist',
  },
});
