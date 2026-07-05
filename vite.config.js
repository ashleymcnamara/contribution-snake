import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright owns tests/e2e; keep vitest away from those specs.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
  // Relative base so the build works on GitHub Pages project sites.
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/r': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
  },
});
