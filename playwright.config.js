import { defineConfig } from '@playwright/test';

// Match vite.config.js: overridable ports so e2e can run even when another
// checkout of the project already holds the defaults.
const WEB_PORT = Number(process.env.SNAKE_WEB_PORT) || 5173;
const API_PORT = Number(process.env.SNAKE_API_PORT) || 3001;

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
        SNAKE_DB: process.env.CI ? '/tmp/snake-e2e.sqlite' : '',
      },
    },
  ],
});
