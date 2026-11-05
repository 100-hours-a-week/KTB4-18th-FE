import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(process.env.CHAT_BACKEND_DIR || join(frontend, '../meomuneum-backend'));
const evidence = join(frontend, 'node_modules/.tmp/chat-multiserver-verification');
await mkdir(evidence, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'meomuneum-fe-step9-'));
const archive = spawnSync('git', ['archive', '--format=tar', 'HEAD'], {
  cwd: backend,
  maxBuffer: 50 * 1024 * 1024,
});
if (archive.status !== 0) throw Error('Cannot archive the selected local backend HEAD');
const extract = spawnSync('tar', ['-x', '-C', root], { input: archive.stdout });
if (extract.status !== 0) throw Error('Cannot prepare the isolated backend fixture');
const path = join(root, 'src/test/java/com/muse/coreauth/CoreAuthProcessTest.java');
const original = await readFile(path, 'utf8');
const anchor =
  '            Probe first = join(PARTICIPATION ? subscribed : polling, polling, revokedSid, region, room);';
if (!original.includes(anchor))
  throw Error('Backend test fixture changed; update the bridge before running');
const bridge = await readFile(
  join(frontend, 'tests/fixtures/chatDistributedBackendBridge.txt'),
  'utf8',
);
await writeFile(path, original.replace(anchor, bridge + anchor));
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: backend, encoding: 'utf8' });
await writeFile(join(evidence, 'backend-head.txt'), head.stdout.trim());
await writeFile(join(evidence, 'harness-path.txt'), root);
const child = spawn(
  './gradlew',
  ['chatControlEventsTest', '--tests', 'com.muse.coreauth.CoreAuthProcessTest', '--no-daemon'],
  {
    cwd: root,
    env: { ...process.env, CHAT_DISTRIBUTED_FE_DIR: frontend },
    stdio: 'inherit',
  },
);
child.on('error', () => {
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
