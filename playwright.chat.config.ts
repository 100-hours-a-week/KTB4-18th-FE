import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

if (!process.env.CHAT_TAB_E2E_URL)
  throw Error('Use npm run verify:chat:tab-e2e to start an isolated server');
const channel = process.env.CHAT_E2E_BROWSER_CHANNEL ?? 'chrome';
const output = process.env.CHAT_TAB_E2E_OUTPUT_DIR ?? './node_modules/.tmp/chat-tab-leave-e2e';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch:
    process.env.CHAT_E2E_SUITE === 'device' ? 'chatDeviceHistory.spec.ts' : 'chatTabLeave.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 10000 },
  outputDir: resolve(output, 'browser-artifacts'),
  reporter: [['list'], ['json', { outputFile: resolve(output, 'results.json') }]],
  use: {
    baseURL: process.env.CHAT_TAB_E2E_URL,
    channel: channel === 'bundled' ? undefined : channel,
    geolocation: { latitude: 37.3595704, longitude: 127.105399, accuracy: 10 },
    permissions: ['geolocation'],
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chrome-desktop', use: { viewport: { width: 1280, height: 900 } } },
    {
      name: 'chrome-mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
