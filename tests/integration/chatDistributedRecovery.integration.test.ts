// @vitest-environment node
import { createServer, request as upstreamRequest } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, expect, it, vi } from 'vitest';
import { Client } from '@stomp/stompjs';
import type { ChatParticipationState } from '../../src/features/chat-entry/services/chatParticipation';

const bridge = vi.hoisted(() => ({
  path: process.env.CHAT_DISTRIBUTED_FE_CONFIG ?? '',
  token: '',
  location: '',
  region: 0,
}));
vi.mock('../../src/features/auth-login/api/authSession', async (original) => {
  const auth = await original<typeof import('../../src/features/auth-login/api/authSession')>();
  const send = (url: RequestInfo | URL, init: RequestInit, token = bridge.token) => {
    if (token !== bridge.token) throw new auth.AuthRequestError(401);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };
  return {
    ...auth,
    getAccessToken: () => bridge.token,
    shouldRefreshAccessToken: () => false,
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
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.skipIf(!bridge.path)(
  '실제 Core·두 Chat에서 반대 Task 접속·1013·503·같은 view 복원과 ACK 유실 정리',
  async () => {
    const config = JSON.parse(readFileSync(bridge.path, 'utf8')) as {
      taskA: string;
      taskB: string;
      token: string;
      location: string;
      region: number;
      evidence: string;
    };
    for (const address of [config.taskA, config.taskB]) {
      const url = new URL(address);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
        throw Error('isolated loopback only');
    }
    Object.assign(bridge, config);
    const events = new EventTarget();
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:5174' },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    let destination = config.taskB;
    let shouldDrop = false;
    let dropped = false;
    let failRecovery = false;
    let joins = 0;
    const socketTasks: string[] = [];
    const responseCodes: number[] = [];
    const sockets = new Set<import('node:stream').Duplex>();
    const requests = new Set<import('node:http').ClientRequest>();
    const proxy = createServer((incoming, outgoing) => {
      if (incoming.method === 'POST' && incoming.url?.endsWith('/members')) joins += 1;
      if (failRecovery && incoming.url?.includes('/messages?')) {
        failRecovery = false;
        outgoing.writeHead(503, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        outgoing.end(JSON.stringify({ message: 'chat service unavailable', data: null }));
        return;
      }
      const request = upstreamRequest(
        config.taskA + incoming.url,
        {
          method: incoming.method,
          headers: { ...incoming.headers, origin: 'http://localhost:5174' },
        },
        (response) => {
          responseCodes.push(response.statusCode!);
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
      incoming.pipe(request);
    });
    proxy.on('upgrade', (incoming, client, head) => {
      sockets.add(client);
      socketTasks.push(destination);
      const headers = { ...incoming.headers, origin: 'http://localhost:5174' };
      // This fault injector inspects uncompressed fixture frames, not browser message contents.
      delete headers['sec-websocket-extensions'];
      const request = upstreamRequest(destination + incoming.url, { headers });
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
        let held = Buffer.alloc(0);
        server.on('data', (chunk: Buffer) => {
          if (!shouldDrop) {
            client.write(chunk);
            return;
          }
          held = Buffer.concat([held, chunk]);
          if (held.length > 16_384) throw Error('fixture frame bound exceeded');
          if (held.includes(Buffer.from('CHAT_ACK'))) {
            dropped = true;
            shouldDrop = false;
            failRecovery = true;
            destination = config.taskA;
            // Server close frame 1013; drop both ACK and broadcast before switching the next socket to Task A.
            client.end(Buffer.from([0x88, 0x02, 0x03, 0xf5]));
            server.destroy();
          }
        });
        client.on('data', (chunk) => {
          if (!server.destroyed) server.write(chunk);
        });
        server.on('error', () => client.destroy());
        client.on('error', () => server.destroy());
        server.on('close', () => {
          sockets.delete(server);
          client.end();
        });
        client.on('close', () => {
          sockets.delete(client);
          server.destroy();
        });
      });
      request.on('error', () => client.destroy());
      request.end();
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const address = proxy.address() as import('node:net').AddressInfo;
    vi.stubEnv('VITE_API_BASE_URL', `http://127.0.0.1:${address.port}`);
    const { ChatParticipation } =
      await import('../../src/features/chat-entry/services/chatParticipation');
    const states: ChatParticipationState[] = [];
    const instances: Client[] = [];
    const activate = Client.prototype.activate;
    vi.spyOn(Client.prototype, 'activate').mockImplementation(function (this: Client) {
      if (!instances.includes(this)) instances.push(this);
      activate.call(this);
    });
    const participation = new ChatParticipation((state) => states.push(state));
    const wait = async (condition: () => boolean) => {
      const deadline = Date.now() + 20_000;
      while (!condition()) {
        if (Date.now() > deadline)
          throw Error(
            `state deadline: ${states.at(-1)?.status}; dropped=${dropped}; HTTP=${responseCodes.join(',')}; ${states.at(-1)?.message}`,
          );
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    try {
      await participation.start();
      await wait(() => ['ready', 'recovery-failed'].includes(states.at(-1)?.status ?? ''));
      const startup503Retried = states.at(-1)?.status === 'recovery-failed';
      if (startup503Retried) {
        // A cold Core HTTP verifier may return a real temporary 503. Exercise the explicit UI retry once.
        expect(responseCodes).toContain(503);
        participation.retryRecovery();
      }
      await wait(() => states.at(-1)?.status === 'ready');
      const membership = states.at(-1)!.activeRoom!.membership;
      expect(socketTasks[0]).toBe(config.taskB);
      shouldDrop = true;
      expect(participation.send('씨발')).toBe(true);
      const id = states.at(-1)!.pendingMessages![0].clientMessageId;
      await wait(() => states.at(-1)?.status === 'recovery-failed');
      expect(dropped).toBe(true);
      expect(states.some((state) => state.status === 'reconnecting')).toBe(true);
      expect(states.at(-1)?.activeRoom?.membership).toEqual(membership);
      expect(states.at(-1)?.pendingMessages?.[0]).toMatchObject({
        clientMessageId: id,
        status: 'uncertain',
      });
      expect(participation.send('blocked')).toBe(false);
      expect(bridge.token).toBe(config.token);
      participation.retryRecovery();
      await wait(() => states.at(-1)?.status === 'ready');
      expect(joins).toBe(1);
      expect(socketTasks.slice(1).every((task) => task === config.taskA)).toBe(true);
      expect(instances[0].connectHeaders).toMatchObject({
        view_session_id: membership.viewSessionId,
        membership_id: String(membership.membershipId),
      });
      const saved = states.at(-1)!.messages!.filter((message) => message.clientMessageId === id);
      expect(saved).toHaveLength(1);
      expect(saved[0].content).toBe('**');
      expect(states.at(-1)?.pendingMessages).toEqual([]);
      writeFileSync(
        config.evidence,
        JSON.stringify({
          crossTaskRestAndWs: true,
          close1013: true,
          recovery503Paused: true,
          sameMembershipAndView: true,
          joins,
          maskedHistoryConfirmedAckLoss: true,
          messageCount: saved.length,
          tokenPreserved: true,
          startup503Retried,
        }),
      );
    } finally {
      await participation.stop().catch(() => undefined);
      instances.forEach((client) => {
        void client.deactivate({ force: true });
      });
      requests.forEach((request) => request.destroy());
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  },
  60_000,
);
