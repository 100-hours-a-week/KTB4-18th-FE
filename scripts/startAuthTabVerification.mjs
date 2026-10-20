import { createServer } from 'vite';
import { randomUUID } from 'node:crypto';

// Protocol fixture only: exercises the actual App and APIs without production credentials.
// Real BCrypt, Hazelcast, queue admission, TLS and CSRF middleware require backend verification.
const sessions = new Map();
const ticket = { status: 'READY', loginOutcome: null, usersAhead: 0, nextPollSeconds: 10 };
const cookie = (req, key) =>
  req.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${key}=`))
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
          if (path.endsWith('/token/csrf'))
            return reply(200, 'csrf token issued', { csrf_token: 'fixture-csrf' });
          if (path.endsWith('/login-queue/tickets/current')) {
            if (req.method === 'DELETE') {
              res.setHeader('Set-Cookie', 'MEO_QUEUE_V2=; Max-Age=0; Path=/api/v1/auth');
              return reply(204);
            }
            return cookie(req, 'MEO_QUEUE_V2')
              ? reply(200, 'queue status', ticket)
              : reply(404, 'TICKET_UNKNOWN');
          }
          if (path.endsWith('/login-queue/tickets') && req.method === 'POST') {
            res.setHeader(
              'Set-Cookie',
              `MEO_QUEUE_V2=${randomUUID()}; HttpOnly; SameSite=Lax; Path=/api/v1/auth`,
            );
            return reply(201, 'queue created', ticket);
          }
          if (path === '/api/v1/auth/login') {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const { email, password } = JSON.parse(Buffer.concat(chunks).toString());
            if (
              !['first@example.test', 'second@example.test'].includes(email) ||
              password !== 'test-password-123!'
            )
              return reply(401, 'invalid credentials');
            const previous = sessions.get(cookie(req, 'refresh_token'));
            if (previous) previous.active = false;
            const session = {
              sid: randomUUID(),
              userId: email.startsWith('first') ? 1 : 2,
              active: true,
            };
            sessions.set(session.sid, session);
            res.setHeader(
              'Set-Cookie',
              `refresh_token=${session.sid}; HttpOnly; SameSite=Lax; Path=/api/v1/auth`,
            );
            return reply(200, 'login success', { access_token: jwt(session), expires_in: 3600 });
          }
          if (path.endsWith('/token/refresh') || path === '/api/v1/auth/logout') {
            if (req.headers['x-csrf-token'] !== 'fixture-csrf')
              return reply(403, 'csrf validation failed');
            const session = sessions.get(cookie(req, 'refresh_token'));
            if (path.endsWith('/token/refresh')) {
              if (!req.headers['x-refresh-operation-id']) return reply(409, 'INVALID_OPERATION_ID');
              return session?.active
                ? reply(200, 'token refreshed', { access_token: jwt(session), expires_in: 3600 })
                : reply(401, 'invalid refresh token');
            }
            if (session) session.active = false;
            res.setHeader(
              'Set-Cookie',
              'refresh_token=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/api/v1/auth',
            );
            return reply(204);
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
