import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const Ajv = require('ajv');
const backend = resolve(process.env.CHAT_BACKEND_DIR || '../meomuneum-backend');
const output = resolve(
  process.env.CHAT_MUSIC_CONTRACT_OUTPUT ||
    'node_modules/.tmp/chat-music-release-verification/contracts.json',
);
const schema = JSON.parse(
  await readFile(resolve(backend, 'api/chat-music-events.schema.json'), 'utf8'),
);
const validate = new Ajv({ allErrors: true }).compile(schema);
const parserCode = ts.transpileModule(
  await readFile('src/features/chat-entry/music/chatMusicTypes.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
const parser = await import(
  'data:text/javascript;base64,' + Buffer.from(parserCode).toString('base64')
);
let references = 0;
async function checkReferences(value, file) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string') {
    const [relative, fragment] = value.$ref.split('#');
    const target = resolve(dirname(file), relative || file);
    if (!target.startsWith(resolve(backend, 'api') + '/'))
      throw Error('Unexpected external contract reference');
    let data = JSON.parse(await readFile(target, 'utf8'));
    for (const key of (fragment || '').split('/').slice(1))
      data = data?.[key.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (data === undefined) throw Error(`Unresolved contract reference in ${file}`);
    references++;
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) for (const item of child) await checkReferences(item, file);
    else if (child && typeof child === 'object') await checkReferences(child, file);
  }
}
for (const name of ['chat-music-queue.openapi.json', 'chat-music-playback.openapi.json']) {
  const file = resolve(backend, 'api', name);
  await checkReferences(JSON.parse(await readFile(file, 'utf8')), file);
}
const wire = JSON.parse(
  await readFile(
    'node_modules/.tmp/chat-music-release-verification/browser/wire-examples.json',
    'utf8',
  ),
);
if (!wire.musicEvents.length || !wire.queues.length)
  throw Error('Real-server wire examples required');
const kinds = new Set();
for (const event of wire.musicEvents) {
  if (!validate(event) || !parser.parseMusicEvent(event))
    throw Error('Real STOMP event failed schema/parser validation');
  kinds.add(event.type);
}
for (const queue of wire.queues)
  if (!parser.parseMusicQueue(queue.data)) throw Error('Real queue failed FE runtime validation');
for (const kind of ['QUEUE_UPDATED', 'PLAYBACK_UPDATED'])
  if (!kinds.has(kind)) throw Error('Missing event kind ' + kind);
const sample = structuredClone(wire.musicEvents[0]);
const invalid = [
  { ...sample, data: { ...sample.data, epoch: 0 } },
  { ...sample, data: { ...sample.data, version: Number.MAX_SAFE_INTEGER + 1 } },
  { ...sample, data: { ...sample.data, playback: { ...sample.data.playback, state: 'BOGUS' } } },
];
for (const value of invalid)
  if (parser.parseMusicEvent(value)) throw Error('Malformed wire data accepted');
const result = {
  passed: true,
  openapiReferences: references,
  stompExamples: wire.musicEvents.length,
  queueExamples: wire.queues.length,
  eventKinds: [...kinds],
  malformedRejected: invalid.length,
  validation:
    'AJV event schema + actual FE parsers + local OpenAPI reference existence (not complete OpenAPI metaschema)',
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result) + '\n');
