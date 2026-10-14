import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
const config = JSON.parse(await readFile('tests/fixtures/chatRecovery.local.json', 'utf8'));
const url = new URL(config.url);
if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:')
  throw Error('Only an isolated loopback server is allowed');
process.env.VITE_API_BASE_URL = config.url;
process.env.VITE_API_PROXY_TARGET = config.url;
const server = await createServer({
  server: { host: '127.0.0.1', port: 5175, strictPort: true, hmr: false },
});
await server.listen();
server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
