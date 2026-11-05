import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import base from './playwright.direct-auth.config';
export default defineConfig({
  ...base,
  testMatch: 'directAuthContinuity.spec.ts',
  grep: /.*/,
  outputDir: resolve('node_modules/.tmp/direct-auth-continuity/artifacts'),
  use: { ...base.use, actionTimeout: 10000 },
});
