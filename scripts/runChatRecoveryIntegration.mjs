import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const path = resolve(
  process.env.CHAT_MULTI_CLIENT_CONFIG || 'tests/fixtures/chatRecovery.local.json',
);
const config = JSON.parse(await readFile(path, 'utf8'));
const url = new URL(config.url);
if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:')
  throw Error('Only an isolated loopback server is allowed');
const child = spawn(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    'tests/integration/chatMultiClient.integration.test.ts',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, CHAT_MULTI_CLIENT_CONFIG: path, VITE_API_BASE_URL: config.url },
  },
);
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
child.on('error', () => {
  process.exitCode = 1;
});
