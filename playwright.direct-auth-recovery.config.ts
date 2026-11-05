import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import base from './playwright.direct-auth.config';

const server = base.webServer;
if (!server || Array.isArray(server))
  throw new Error('Dedicated local Vite configuration required');
export default defineConfig({
  ...base,
  testMatch: 'directAuthRecovery.spec.ts',
  grep: /.*/,
  use: { ...base.use, actionTimeout: 10000 },
  outputDir: resolve('node_modules/.tmp/direct-auth-recovery/artifacts'),
  webServer: {
    ...server,
    env: {
      ...server.env,
      VITE_AUTH_DIRECT_V2_SOURCE_RECOVERY_VERIFIED:
        process.env.AUTH_E2E_SOURCE_RECOVERY_VERIFIED === 'true' ? 'true' : 'false',
      VITE_AUTH_DIRECT_V2_REBOOTSTRAP_VERIFIED:
        process.env.AUTH_E2E_REBOOTSTRAP_VERIFIED === 'true' ? 'true' : 'false',
    },
  },
});
