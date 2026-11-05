import { createServer } from 'vite';
import { randomUUID } from 'node:crypto';

// Protocol fixture only: exercises the actual App and APIs without production credentials.
// Real BCrypt, Hazelcast, queue admission, TLS and CSRF middleware require backend verification.
const sessions = new Map();
const flows = new Map();
const tickets = new Map();
const cookie = (req, key) =>
  req.headers.cookie
    ?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${key}=`))
    ?.slice(key.length + 1);
const jwt = (session) =>
  [
    'test',
    Buffer.from(
      JSON.stringify({
        sub: String(session.userId),
        sid: session.sid,
        exp: Math.floor(Date.now() / 1000) + 3600,
        jti: randomUUID(),
      }),
    ).toString('base64url'),
    'test',
  ].join('.');
const bearer = (req) => {
  try {
    return sessions.get(
      JSON.parse(Buffer.from(req.headers.authorization.split('.')[1], 'base64url').toString()).sid,
    );
  } catch {
    return undefined;
  }
};
const getFlow = (req, res, create = true) => {
  const flowCookie = cookie(req, 'MEO_AUTH_FLOW');
  let flow = flowCookie ? flows.get(flowCookie) : undefined;
  if (!flow && create) {
    const value = randomUUID();
    flow = {
      cookie: value,
      flowId: randomUUID(),
      flowEpoch: 1,
      revision: 1,
      lifecycle: 'ANONYMOUS',
      sessionSid: null,
      ticketId: null,
      logoutReceipt: null,
      authenticated: false,
    };
    flows.set(value, flow);
    res.setHeader(
      'Set-Cookie',
      `MEO_AUTH_FLOW=${value}; HttpOnly; SameSite=Lax; Path=/api/v1/auth`,
    );
  }
  return flow;
};
const setTuple = (res, flow) => {
  res.setHeader('X-Auth-Flow-Id', flow.flowId);
  res.setHeader('X-Auth-Flow-Epoch', String(flow.flowEpoch));
  res.setHeader('X-Auth-Flow-Revision', String(flow.revision));
};
const hasTuple = (req, flow) =>
  req.headers['x-auth-flow-id'] === flow.flowId &&
  Number(req.headers['x-auth-flow-epoch']) === flow.flowEpoch;
const expireCookie = (key) => `${key}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/api/v1/auth`;
process.env.VITE_API_BASE_URL = '';
process.env.VITE_LOCAL_MOCK_LOGIN = 'false';
const server = await createServer({
  server: { host: '127.0.0.1', port: 5176, strictPort: true, hmr: false },
  plugins: [
    {
      name: 'auth-tab-protocol-fixture',
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          const path = new URL(req.url, 'http://127.0.0.1').pathname;
          if (!path.startsWith('/api/')) return next();
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          const reply = (status, message, data = null) => {
            res.statusCode = status;
            res.end(status === 204 ? undefined : JSON.stringify({ message, data }));
          };
          if (path === '/api/v1/auth/flow' && req.method === 'GET') {
            const flow = getFlow(req, res);
            if (flow.authenticated) {
              const session = sessions.get(flow.sessionSid);
              if (!session?.active) {
                flow.flowEpoch += 1;
                flow.revision += 1;
                flow.lifecycle = 'ANONYMOUS';
                flow.sessionSid = null;
                flow.authenticated = false;
              } else {
                res.setHeader('Set-Cookie', [
                  `MEO_AUTH_FLOW=${flow.cookie}; HttpOnly; SameSite=Lax; Path=/api/v1/auth`,
                  `refresh_token=${session.sid}; HttpOnly; SameSite=Lax; Path=/api/v1/auth`,
                ]);
              }
            }
            setTuple(res, flow);
            if (!flow.authenticated) {
              res.setHeader('Set-Cookie', [
                `MEO_AUTH_FLOW=${flow.cookie}; HttpOnly; SameSite=Lax; Path=/api/v1/auth`,
                expireCookie('refresh_token'),
                expireCookie('MEO_QUEUE_V2'),
              ]);
            }
            return reply(200, 'auth flow', {
              flowId: flow.flowId,
              flowEpoch: flow.flowEpoch,
              revision: flow.revision,
              lifecycle: flow.lifecycle,
              authenticated: flow.authenticated,
              currentTicket: flow.ticketId
                ? { ticketId: flow.ticketId, status: 'READY', flowRevision: flow.revision }
                : null,
              pendingOperations: [],
              lastLogoutReceipt: flow.logoutReceipt,
              lastRefreshReceipt: null,
              lastQueueCancelReceipt: null,
              rebootstrapReason: 'EXISTING',
            });
          }
          if (path.endsWith('/token/csrf'))
            return reply(200, 'csrf token issued', { csrf_token: 'fixture-csrf' });

          const currentRoute =
            path === '/api/v1/auth/login-queue/current' ||
            path === '/api/v1/auth/login-queue/tickets/current';
          if (currentRoute) {
            const flow = getFlow(req, res, false);
            if (!flow || !hasTuple(req, flow)) return reply(409, 'AUTH_FLOW_EPOCH_STALE');
            setTuple(res, flow);
            if (req.method === 'DELETE') {
              if (req.headers['x-csrf-token'] !== 'fixture-csrf')
                return reply(403, 'csrf validation failed');
              const currentTag = `"${flow.flowId}:${flow.revision}"`;
              if (req.headers['if-match'] !== currentTag)
                return reply(412, 'AUTH_FLOW_REVISION_STALE');
              if (flow.ticketId) tickets.delete(flow.ticketId);
              flow.ticketId = null;
              flow.lifecycle = flow.authenticated ? 'AUTHENTICATED' : 'ANONYMOUS';
              flow.revision += 1;
              setTuple(res, flow);
              res.setHeader('ETag', `"${flow.flowId}:${flow.revision}"`);
              res.setHeader('Set-Cookie', expireCookie('MEO_QUEUE_V2'));
              return reply(204);
            }
            res.setHeader('ETag', `"${flow.flowId}:${flow.revision}"`);
            const ticket = flow.ticketId ? tickets.get(flow.ticketId) : undefined;
            if (!ticket || cookie(req, 'MEO_QUEUE_V2') !== ticket.cookie)
              return reply(404, 'TICKET_UNKNOWN');
            return reply(200, 'queue status', ticket.data);
          }
          if (path === '/api/v1/auth/login-queue/tickets' && req.method === 'POST') {
            const flow = getFlow(req, res, false);
            if (!flow || !hasTuple(req, flow)) return reply(409, 'AUTH_FLOW_EPOCH_STALE');
            setTuple(res, flow);
            if (flow.ticketId) {
              const existing = tickets.get(flow.ticketId);
              return existing
                ? reply(200, 'login queue ticket', existing.data)
                : reply(503, 'AUTH_STATE_UNAVAILABLE');
            }
            const id = randomUUID();
            const queueCookie = randomUUID();
            const ticket = {
              cookie: queueCookie,
              data: { status: 'READY', loginOutcome: null, usersAhead: 0, nextPollSeconds: 10 },
            };
            tickets.set(id, ticket);
            flow.ticketId = id;
            flow.lifecycle = 'QUEUED';
            flow.revision += 1;
            setTuple(res, flow);
            res.setHeader('ETag', `"${flow.flowId}:${flow.revision}"`);
            res.setHeader(
              'Set-Cookie',
              `MEO_QUEUE_V2=${queueCookie}; HttpOnly; SameSite=Lax; Path=/api/v1/auth`,
            );
            return reply(200, 'login queue ticket', ticket.data);
          }
          if (path === '/api/v1/auth/login') {
            const flow = getFlow(req, res, false);
            if (!flow || !hasTuple(req, flow)) return reply(409, 'AUTH_FLOW_EPOCH_STALE');
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const { email, password } = JSON.parse(Buffer.concat(chunks).toString());
            if (
              !['first@example.test', 'second@example.test'].includes(email) ||
              password !== 'test-password-123!'
            )
              return reply(401, 'invalid credentials');
            const session = {
              sid: randomUUID(),
              userId: email.startsWith('first') ? 1 : 2,
              active: true,
            };
            if (flow.sessionSid) {
              const previous = sessions.get(flow.sessionSid);
              if (previous) previous.active = false;
            }
            sessions.set(session.sid, session);
            flow.flowEpoch += 1;
            flow.revision += 1;
            flow.lifecycle = 'AUTHENTICATED';
            flow.sessionSid = session.sid;
            flow.ticketId = null;
            flow.authenticated = true;
            setTuple(res, flow);
            res.setHeader('Set-Cookie', [
              `refresh_token=${session.sid}; HttpOnly; SameSite=Lax; Path=/api/v1/auth`,
              `MEO_AUTH_FLOW=${flow.cookie}; HttpOnly; SameSite=Lax; Path=/api/v1/auth`,
            ]);
            return reply(200, 'login success', { access_token: jwt(session), expires_in: 3600 });
          }
          if (path === '/api/v1/auth/login/recovery' && req.method === 'POST') {
            const flow = getFlow(req, res, false);
            const session = flow?.sessionSid ? sessions.get(flow.sessionSid) : undefined;
            if (!flow || !hasTuple(req, flow) || !session?.active)
              return reply(409, 'AUTH_SESSION_INVALID');
            setTuple(res, flow);
            res.setHeader(
              'Set-Cookie',
              `refresh_token=${session.sid}; HttpOnly; SameSite=Lax; Path=/api/v1/auth`,
            );
            return reply(200, 'login recovered', { access_token: jwt(session), expires_in: 3600 });
          }
          if (path.endsWith('/token/refresh') || path === '/api/v1/auth/logout') {
            if (req.headers['x-csrf-token'] !== 'fixture-csrf')
              return reply(403, 'csrf validation failed');
            const flow = getFlow(req, res, false);
            const session = sessions.get(cookie(req, 'refresh_token'));
            if (path.endsWith('/token/refresh')) {
              if (!flow || !hasTuple(req, flow)) return reply(409, 'AUTH_FLOW_EPOCH_STALE');
              if (!req.headers['x-refresh-operation-id']) return reply(409, 'INVALID_OPERATION_ID');
              if (!session?.active || session.sid !== flow.sessionSid)
                return reply(401, 'invalid refresh token');
              flow.revision += 1;
              setTuple(res, flow);
              res.setHeader(
                'Set-Cookie',
                `refresh_token=${session.sid}; HttpOnly; SameSite=Lax; Path=/api/v1/auth`,
              );
              return reply(200, 'token refreshed', {
                access_token: jwt(session),
                expires_in: 3600,
              });
            }
            const operationId = req.headers['idempotency-key'];
            if (!operationId) return reply(409, 'INVALID_OPERATION_ID');
            if (!flow || req.headers['x-auth-flow-id'] !== flow.flowId)
              return reply(409, 'AUTH_FLOW_ID_MISMATCH');
            if (flow.logoutReceipt?.operationId === operationId) {
              setTuple(res, flow);
              return reply(200, 'logout committed', { logoutReceipt: flow.logoutReceipt });
            }
            if (!hasTuple(req, flow)) return reply(409, 'AUTH_FLOW_EPOCH_STALE');
            if (session && session.sid === flow.sessionSid) session.active = false;
            flow.flowEpoch += 1;
            flow.revision += 1;
            flow.lifecycle = 'ANONYMOUS';
            flow.sessionSid = null;
            flow.ticketId = null;
            flow.authenticated = false;
            flow.logoutReceipt = {
              operationId,
              committed: true,
              flowEpoch: flow.flowEpoch,
              revision: flow.revision,
            };
            setTuple(res, flow);
            res.setHeader('Set-Cookie', [
              `MEO_AUTH_FLOW=${flow.cookie}; HttpOnly; SameSite=Lax; Path=/api/v1/auth`,
              expireCookie('refresh_token'),
              expireCookie('MEO_QUEUE_V2'),
            ]);
            return reply(200, 'logout committed', { logoutReceipt: flow.logoutReceipt });
          }
          const owner = bearer(req);
          if (!owner?.active) return reply(401, 'unauthorized');
          if (path === '/api/v1/users/me')
            return reply(200, 'user retrieved', {
              user_id: owner.userId,
              email: owner.userId === 1 ? 'first@example.test' : 'second@example.test',
              nickname: owner.userId === 1 ? '첫 번째 계정' : '두 번째 계정',
              birth_year: 2000,
              gender: 'FEMALE',
              profile_image_url: null,
              created_at: '2026-01-01T00:00:00Z',
            });
          if (path.endsWith('/settings'))
            return reply(200, 'settings', {
              map_visibility: 'PRIVATE',
              is_unrecorded_dot_recommendation_enabled: true,
            });
          return reply(200, 'fixture empty', { items: [], next_cursor: null, has_next: false });
        });
      },
    },
  ],
});
await server.listen();
const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
