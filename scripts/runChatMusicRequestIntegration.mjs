import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(process.env.CHAT_BACKEND_DIR || join(frontend, '../meomuneum-backend'));
const suite = process.argv.includes('--release')
  ? 'chat-music-release-verification'
  : process.argv.includes('--sync')
    ? 'chat-music-sync-verification'
    : process.argv.includes('--player')
      ? 'chat-music-player-verification'
      : 'chat-music-request-verification';
const evidence = join(frontend, 'node_modules/.tmp', suite);
await mkdir(evidence, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'meomuneum-fe-music-'));
const archive = spawnSync('git', ['archive', '--format=tar', 'HEAD'], {
  cwd: backend,
  maxBuffer: 50 * 1024 * 1024,
});
if (archive.status !== 0) throw Error('Cannot archive the selected local backend HEAD');
const extract = spawnSync('tar', ['-x', '-C', root], { input: archive.stdout });
if (extract.status !== 0) throw Error('Cannot prepare the isolated backend fixture');
// Explicit verification of local BE changes without committing or including environment files.
if (process.argv.includes('--worktree')) {
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'src'], {
    cwd: backend,
    encoding: 'utf8',
  });
  if (untracked.status !== 0 || untracked.stdout.trim())
    throw Error('Commit or explicitly support untracked backend sources before this verification');
  const patch = spawnSync('git', ['diff', '--binary', 'HEAD', '--', 'src', 'build.gradle'], {
    cwd: backend,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (patch.status !== 0) throw Error('Cannot capture backend verification diff');
  if (patch.stdout.length) {
    const applied = spawnSync('git', ['apply', '--whitespace=nowarn', '-'], {
      cwd: root,
      input: patch.stdout,
    });
    if (applied.status !== 0) throw Error('Cannot apply backend verification diff');
  }
  await writeFile(
    join(evidence, 'backend-worktree.json'),
    JSON.stringify({
      trackedSourceOverlay: true,
      sha256: createHash('sha256').update(patch.stdout).digest('hex'),
    }) + '\n',
  );
}
const path = join(root, 'src/test/java/com/muse/coreauth/CoreAuthProcessTest.java');
const original = await readFile(path, 'utf8');
const anchor =
  '                musicChecks(jdbc, polling, subscribed, first, second, revokedSid, region, room);';
if (!original.includes(anchor))
  throw Error('Backend test fixture changed; update the bridge before running');
const bridge = await readFile(join(frontend, 'tests/fixtures/chatMusicBackendBridge.txt'), 'utf8');
await writeFile(path, original.replace(anchor, bridge + anchor));
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: backend, encoding: 'utf8' });
await writeFile(join(evidence, 'backend-head.txt'), head.stdout.trim());
await writeFile(join(evidence, 'harness-path.txt'), root);
const child = spawn('./gradlew', ['chatMusicEventsProcessTest', '--no-daemon'], {
  cwd: root,
  env: { ...process.env, CHAT_MUSIC_FE_DIR: frontend, CHAT_MUSIC_FE_SUITE: suite },
  stdio: 'inherit',
});
child.on('error', () => {
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
