import { defineConfig } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

// Match vite.config.js: overridable ports so e2e can run even when another
// checkout of the project already holds the defaults.
const WEB_PORT = Number(process.env.SNAKE_WEB_PORT) || 5173;
const API_PORT = Number(process.env.SNAKE_API_PORT) || 3001;

// Give the API server an isolated database so e2e never reads or writes the
// developer's real dev DB (server/data.sqlite) and every run starts with a
// clean leaderboard — otherwise accumulated tied scores make ranking-dependent
// assertions flaky. A fresh file per run locally; CI's /tmp is already ephemeral.
const E2E_DB = process.env.CI
  ? '/tmp/snake-e2e.sqlite'
  : path.join(os.tmpdir(), `snake-e2e-${Date.now()}.sqlite`);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
  },
  webServer: [
    {
      command: 'npm run dev:web',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      env: {
        SNAKE_WEB_PORT: String(WEB_PORT),
        SNAKE_API_PORT: String(API_PORT),
      },
    },
    {
      command: 'npm run dev:api',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: String(API_PORT),
        SNAKE_DB: E2E_DB,
        // Serve a deterministic synthetic contribution calendar so graph-mode
        // e2e never depends on GitHub (see fetchContributionDays).
        SNAKE_FAKE_CONTRIBS: '1',
      },
    },
  ],
});
