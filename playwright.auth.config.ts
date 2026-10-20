import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const output = resolve(
  'node_modules/.tmp/auth-tab-session',
  process.env.AUTH_TAB_RUN_ID ?? `run-${Date.now()}`,
);
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'authTabSession.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 10000 },
  outputDir: resolve(output, 'artifacts'),
  reporter: [['list'], ['json', { outputFile: resolve(output, 'results.json') }]],
  webServer: {
    command: 'node scripts/startAuthTabVerification.mjs',
    url: 'http://127.0.0.1:5176/login',
    reuseExistingServer: false,
  },
  use: {
    baseURL: 'http://127.0.0.1:5176',
    channel: 'chrome',
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chrome-desktop', use: { viewport: { width: 1280, height: 900 } } },
    {
      name: 'chrome-mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
