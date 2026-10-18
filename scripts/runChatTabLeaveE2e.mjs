import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(process.env.CHAT_E2E_BACKEND_DIR ?? resolve(root, '../meomuneum-backend'));
const fixture = resolve(root, 'tests/fixtures/chatRecovery.local.json');
const release = resolve(backend, 'build/chat-process-verification/browser-release');
const output = resolve(
  root,
  'node_modules/.tmp/chat-tab-leave-e2e',
  `run-${Date.now()}-${process.pid}`,
);
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );
if (await exists(fixture))
  throw Error('An existing browser fixture is in use; finish that verification first');
await access(resolve(backend, 'gradlew'));
await mkdir(output, { recursive: true });
const log = createWriteStream(resolve(output, 'backend.log'));
const serverProcess = spawn(
  './gradlew',
  [
    'chatProcessTest',
    '--tests',
    'com.muse.meomuneum.chat.recovery.ChatRecoveryProcessIntegrationTest.provideOptionalBrowserFixtureOnTheSameIsolatedServer',
    '--no-daemon',
  ],
  {
    cwd: backend,
    env: { ...process.env, CHAT_BROWSER_FE_DIR: root },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
serverProcess.stdout.pipe(log, { end: false });
serverProcess.stderr.pipe(log, { end: false });
let serverExited = false;
const serverExit = once(serverProcess, 'exit')
  .then(([code]) => {
    serverExited = true;
    return code;
  })
  .catch(() => {
    serverExited = true;
    return 1;
  });
let vite;
let tests;
let fixtureReady = false;
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  tests?.kill('SIGTERM');
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
process.stdout.write(`E2E evidence: ${output}\n`);
try {
  const deadline = Date.now() + 120000;
  while (!(await exists(fixture))) {
    if (interrupted) throw Error('E2E verification interrupted');
    if (serverExited)
      throw Error(
        'Isolated backend did not start; inspect node_modules/.tmp/chat-tab-leave-e2e/backend.log',
      );
    if (Date.now() > deadline) throw Error('Isolated backend fixture timed out');
    await delay(250);
  }
  fixtureReady = true;
  const config = JSON.parse(await readFile(fixture, 'utf8'));
  const target = new URL(config.url);
  if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:')
    throw Error('Only an isolated loopback backend is allowed');
  process.env.VITE_API_BASE_URL = '';
  process.env.VITE_API_PROXY_TARGET = config.url;
  vite = await createServer({
    root,
    appType: 'mpa',
    server: { host: '127.0.0.1', port: 5175, strictPort: true, hmr: false },
    plugins: [
      {
        name: 'isolated-chat-tab-fixture',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1:5175');
            if (url.pathname === '/__chat-e2e/config') {
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Cache-Control', 'no-store');
              res.end(
                JSON.stringify({
                  token:
                    url.searchParams.get('actor') === 'observer' ? config.otherToken : config.token,
                }),
              );
            } else if (url.pathname === '/chat' || url.pathname === '/') {
              const html = await readFile(
                resolve(root, 'tests/fixtures/chatTabLeave.html'),
                'utf8',
              );
              res.setHeader('Content-Type', 'text/html');
              res.end(await server.transformIndexHtml(req.url, html));
            } else next();
          });
        },
      },
    ],
  });
  await vite.listen();
  if (interrupted) throw Error('E2E verification interrupted');
  tests = spawn(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '-c',
      'playwright.chat.config.ts',
      ...process.argv.slice(2),
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        CHAT_TAB_E2E_URL: 'http://127.0.0.1:5175',
        CHAT_TAB_E2E_OUTPUT_DIR: output,
      },
    },
  );
  const [code] = await once(tests, 'exit');
  process.exitCode = code ?? 1;
} finally {
  if (tests && tests.exitCode === null) tests.kill('SIGTERM');
  await vite?.close();
  if (fixtureReady || (await exists(fixture))) {
    await writeFile(release, 'F4 browser verification finished\n');
    const code = await Promise.race([serverExit, delay(20000).then(() => null)]);
    if (code !== 0) {
      process.exitCode = 1;
      process.stderr.write('Backend fixture cleanup failed; inspect the isolated backend log\n');
    }
  }
  if (!serverExited) serverProcess.kill('SIGTERM');
  log.end();
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  if (interrupted) process.exitCode = 130;
}
