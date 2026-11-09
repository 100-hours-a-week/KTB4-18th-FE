// @vitest-environment node
import { createServer, request as upstreamRequest } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, expect, it, vi } from 'vitest';
import type { ChatParticipationState } from '../../src/features/chat-entry/services/chatParticipation';

const bridge = vi.hoisted(() => ({
  path: process.env.CHAT_MUSIC_FE_CONFIG ?? '',
  token: '',
  region: 0,
  location: '',
}));
vi.mock('../../src/features/auth-login/api/authSession', () => {
  class FixtureAuthError extends Error {
    status: number | null;
    requestWasSent: boolean;
    constructor(status: number | null, requestWasSent = false) {
      super('synthetic auth boundary');
      this.status = status;
      this.requestWasSent = requestWasSent;
    }
  }
  const send = (input: RequestInfo | URL, init: RequestInit, token = bridge.token) =>
    fetch(input, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        Authorization: `Bearer ${token}`,
      },
    });
  return {
    getAccessToken: () => bridge.token,
    shouldRefreshAccessToken: () => false,
    refreshAccessToken: async () => bridge.token,
    ACCESS_TOKEN_CHANGED_EVENT: 'synthetic-token-change',
    AUTH_EXPIRED_EVENT: 'synthetic-auth-expired',
    AuthRequestError: FixtureAuthError,
    authenticatedFetch: send,
    authenticatedFetchWithCurrentToken: send,
  };
});
vi.mock('../../src/features/chat-entry/services/resolveCurrentChatLocation', () => ({
  resolveCurrentChatLocation: async () => ({
    region: { sigungu: { regionId: bridge.region } },
    locationResolutionToken: bridge.location,
  }),
}));
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.skipIf(!bridge.path)(
  '실제 Core·두 Chat에서 세션 고정 검색/페이지·신청·유실 재시도·이벤트·대기 곡 취소',
  async () => {
    const config = JSON.parse(readFileSync(bridge.path, 'utf8')) as {
      taskA: string;
      taskB: string;
      token: string;
      region: number;
      location: string;
      evidence: string;
    };
    for (const address of [config.taskA, config.taskB]) {
      const url = new URL(address);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
        throw Error('loopback fixture only');
    }
    Object.assign(bridge, config);
    const events = new EventTarget();
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:5174' },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    let loseNextAdd = false;
    const writes: { id: string; body: string; method: string; path: string }[] = [];
    const sockets = new Set<import('node:stream').Duplex>();
    const requests = new Set<import('node:http').ClientRequest>();
    const proxy = createServer((incoming, outgoing) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.on('end', () => {
        const body = Buffer.concat(chunks);
        if (incoming.method === 'POST' || incoming.method === 'DELETE')
          writes.push({
            id: String(incoming.headers['idempotency-key'] ?? ''),
            body: body.toString(),
            method: incoming.method,
            path: incoming.url!,
          });
        const lose =
          loseNextAdd && incoming.method === 'POST' && incoming.url?.includes('/queue-items');
        if (lose) loseNextAdd = false;
        const request = upstreamRequest(
          config.taskA + incoming.url,
          {
            method: incoming.method,
            headers: { ...incoming.headers, origin: 'http://localhost:5174' },
          },
          (response) => {
            if (lose) {
              response.resume();
              response.on('end', () => {
                outgoing.destroy();
              });
              return;
            }
            outgoing.writeHead(response.statusCode!, response.headers);
            response.pipe(outgoing);
          },
        );
        requests.add(request);
        request.on('close', () => requests.delete(request));
        request.on('error', () => {
          if (!outgoing.headersSent) outgoing.writeHead(502);
          outgoing.end();
        });
        request.end(body);
      });
    });
    proxy.on('upgrade', (incoming, client, head) => {
      sockets.add(client);
      const headers = { ...incoming.headers, origin: 'http://localhost:5174' };
      delete headers['sec-websocket-extensions'];
      const request = upstreamRequest(config.taskB + incoming.url, { headers });
      requests.add(request);
      request.on('close', () => requests.delete(request));
      request.on('upgrade', (response, server, remaining) => {
        sockets.add(server);
        client.write(
          `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\r\n')}\r\n\r\n`,
        );
        if (head.length) server.write(head);
        if (remaining.length) client.write(remaining);
        client.pipe(server);
        server.pipe(client);
        client.on('error', () => server.destroy());
        server.on('error', () => client.destroy());
        client.on('close', () => {
          sockets.delete(client);
          server.destroy();
        });
        server.on('close', () => {
          sockets.delete(server);
          client.destroy();
        });
      });
      request.on('error', () => client.destroy());
      request.end();
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    vi.stubEnv(
      'VITE_API_BASE_URL',
      `http://127.0.0.1:${(proxy.address() as import('node:net').AddressInfo).port}`,
    );
    const { ChatParticipation } =
      await import('../../src/features/chat-entry/services/chatParticipation');
    const { ChatMusicQueueController } =
      await import('../../src/features/chat-entry/music/chatMusicQueueController');
    const states: ChatParticipationState[] = [];
    let music: InstanceType<typeof ChatMusicQueueController> | undefined;
    const participation = new ChatParticipation((state) => {
      states.push(state);
      if (state.musicEvent) music?.hint(state.musicEvent);
    });
    const wait = async (condition: () => boolean) => {
      const end = Date.now() + 20_000;
      while (!condition()) {
        if (Date.now() > end)
          throw Error(`music condition timed out; status=${states.at(-1)?.status}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    try {
      await participation.start();
      await wait(() => ['ready', 'recovery-failed'].includes(states.at(-1)?.status ?? ''));
      if (states.at(-1)?.status === 'recovery-failed') {
        participation.retryRecovery();
        await wait(() => states.at(-1)?.status === 'ready');
      }
      const session = states.at(-1)!.musicSession!;
      expect(session).toBeTruthy();
      music = new ChatMusicQueueController(session);
      music.connect(session, true);
      await wait(() => !!music!.getSnapshot().queue);
      await music.search('synthetic');
      expect(music.getSnapshot().search?.items).toHaveLength(20);
      await music.search('synthetic', true);
      expect(music.getSnapshot().search?.items).toHaveLength(24);
      const tracks = music.getSnapshot().search!.items;
      music.add(tracks[0]);
      await wait(
        () => !music!.getSnapshot().isMutating && music!.getSnapshot().queue?.version === 1,
      );
      expect(music.getSnapshot().queue?.current?.musicId).toBe(tracks[0].musicId);
      await wait(() =>
        states.some((s) => s.musicEvent?.type === 'PLAYBACK_UPDATED' && s.musicEvent.version === 1),
      );
      await wait(() => !music!.getSnapshot().isCoolingDown);
      loseNextAdd = true;
      music.add(tracks[1]);
      await wait(() => !music!.getSnapshot().isMutating && !!music!.getSnapshot().pending);
      expect(music.getSnapshot().pending?.kind).toBe('add');
      music.retryMutation();
      await wait(() => !music!.getSnapshot().pending && music!.getSnapshot().queue?.version === 2);
      const adds = writes.filter((w) => w.method === 'POST' && w.path.includes('/queue-items'));
      expect(adds).toHaveLength(3);
      expect(adds[1].id).toBe(adds[2].id);
      expect(adds[1].body).toBe(adds[2].body);
      expect(music.getSnapshot().queue?.items).toHaveLength(1);
      await wait(() => !music!.getSnapshot().isCoolingDown);
      music.cancel(music.getSnapshot().queue!.items[0]);
      await wait(() => music!.getSnapshot().queue?.version === 3);
      expect(music.getSnapshot().queue?.items).toEqual([]);
      expect(
        writes.some((w) => w.method === 'DELETE' && w.path.includes('expected_version=2')),
      ).toBe(true);
      writeFileSync(
        config.evidence,
        JSON.stringify({
          realCore: true,
          twoChatProcesses: true,
          restTaskAWebsocketTaskB: true,
          pagedSearch: 24,
          addAutoStarted: true,
          lostResultOriginalUuid: true,
          queueEvent: true,
          cancelWaiting: true,
          musicVersion: music.getSnapshot().queue!.version,
        }),
      );
    } finally {
      music?.dispose();
      await participation.stop().catch(() => {});
      for (const socket of sockets) socket.destroy();
      for (const request of requests) request.destroy();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  },
  80_000,
);
