import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

if (process.env.VITE_API_BASE_URL && process.env.VITE_API_BASE_URL !== 'http://127.0.0.1:18089')
  throw new Error('Direct auth tests require the isolated local backend');

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'directAuthSession.spec.ts',
  grep: process.env.AUTH_E2E_REFRESH_VERIFIED === 'true' ? /verified restore/ : /real local direct/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 10000 },
  outputDir: resolve('node_modules/.tmp/direct-auth/artifacts'),
  reporter: [['list']],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5178 --strictPort',
    env: {
      VITE_AUTH_DIRECT_V2_ENABLED: 'true',
      VITE_AUTH_DIRECT_V2_REFRESH_VERIFIED:
        process.env.AUTH_E2E_REFRESH_VERIFIED === 'true' ? 'true' : 'false',
      VITE_API_BASE_URL: 'http://127.0.0.1:18089',
    },
    url: 'http://127.0.0.1:5178/login',
    reuseExistingServer: false,
  },
  use: {
    baseURL: 'http://127.0.0.1:5178',
    channel: 'chrome',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'direct-auth-local', use: { viewport: { width: 1280, height: 900 } } }],
});
