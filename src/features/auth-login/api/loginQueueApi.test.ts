import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCsrfToken, runAuthTransition, setAccessToken } from './authSession';
import { isLogoutCleanupPending, resetLogoutCleanupGateForTests } from './logoutCleanupGate';

vi.mock('./authSession', () => ({
  assertAuthEpochReadable: vi.fn(),
  getCsrfToken: vi.fn(),
  runAuthTransition: vi.fn(),
  setAccessToken: vi.fn(),
}));
vi.mock('./authCapabilities', () => ({ probeAuthCapabilities: () => ({ supported: true }) }));

import {
  getLoginOperationId,
  getLoginQueueGeneration,
  QueueRequestError,
  submitQueuedLogin,
  cancelLoginQueue,
  reconcileLoginQueueStatus,
  retireAmbiguousLoginOperation,
  startOrResumeLoginQueue,
  parseQueueRetryAfter,
  recoverQueuedLogin,
  calculateQueueCreateRetryDelayMs,
  calculateQueueStatusRetryDelayMs,
  getLoginQueueStatus,
  resetLoginQueueAfterLogout,
} from './loginQueueApi';

function ticket(status: 'READY' | 'CONSUMED') {
  return {
    message: 'ok',
    data: {
      status,
      loginOutcome: status === 'CONSUMED' ? 'INVALID_CREDENTIALS' : null,
      usersAhead: 0,
      nextPollSeconds: 10,
    },
  };
}

function installSerializedQueueLockManager() {
  type PendingRequest = {
    callback: (lock: object | null) => unknown;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  };
  let lockHeld = false;
  const pending: PendingRequest[] = [];
  const runNext = () => {
    if (lockHeld) return;
    const request = pending.shift();
    if (!request) return;
    lockHeld = true;
    Promise.resolve()
      .then(() => request.callback({}))
      .then(request.resolve, request.reject)
      .finally(() => {
        lockHeld = false;
        runNext();
      });
  };
  const request = (_name: string, options: unknown, callback: (lock: object | null) => unknown) =>
    new Promise((resolve, reject) => {
      if ((options as { ifAvailable?: boolean }).ifAvailable && lockHeld) {
        Promise.resolve()
          .then(() => callback(null))
          .then(resolve, reject);
        return;
      }
      pending.push({ callback, resolve, reject });
      runNext();
    });

  vi.stubGlobal(
    'navigator',
    Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
      locks: { request },
    }),
  );
  return { isLockHeld: () => lockHeld };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetLogoutCleanupGateForTests();
  vi.clearAllMocks();
  vi.mocked(setAccessToken).mockReset();
  vi.useRealTimers();
});

describe('queue create retry policy', () => {
  it('uses a ten-second floor, Retry-After, and bounded jitter for status recovery retries', () => {
    expect(calculateQueueStatusRetryDelayMs(1, null, 0)).toBe(10_000);
    expect(calculateQueueStatusRetryDelayMs(1, null, 0.5)).toBe(12_500);
    expect(calculateQueueStatusRetryDelayMs(2, 45, 0.5)).toBe(50_000);
    expect(calculateQueueStatusRetryDelayMs(10, null, 0.999)).toBeLessThanOrEqual(40_000);
  });

  it('parses integer seconds and HTTP dates while rejecting invalid and negative values', () => {
    const now = Date.parse('2026-10-14T00:00:00Z');

    expect(parseQueueRetryAfter('12', now)).toBe(12);
    expect(parseQueueRetryAfter('Wed, 14 Oct 2026 00:00:12 GMT', now)).toBe(12);
    expect(parseQueueRetryAfter('Wed, 14 Oct 2026 00:00:00 GMT', now)).toBe(0);
    expect(parseQueueRetryAfter('-1', now)).toBeNull();
    expect(parseQueueRetryAfter('1.5', now)).toBeNull();
    expect(parseQueueRetryAfter('not a date', now)).toBeNull();
  });

  it('uses the five-second floor and full jitter widths of 5, 10, and 20 seconds', () => {
    expect(calculateQueueCreateRetryDelayMs(1, 3, 0)).toBe(5_000);
    expect(calculateQueueCreateRetryDelayMs(1, 5, 0.999)).toBeLessThan(10_000);
    expect(calculateQueueCreateRetryDelayMs(1, 120, 0.5)).toBe(122_500);
    expect(calculateQueueCreateRetryDelayMs(2, null, 0)).toBe(5_000);
    expect(calculateQueueCreateRetryDelayMs(2, null, 0.999)).toBeLessThan(15_000);
    expect(calculateQueueCreateRetryDelayMs(3, null, 0)).toBe(5_000);
    expect(calculateQueueCreateRetryDelayMs(3, null, 0.999)).toBeLessThan(25_000);
    expect(calculateQueueCreateRetryDelayMs(4, null, 0.999)).toBeLessThan(45_000);
    expect(calculateQueueCreateRetryDelayMs(5, null, 0.999)).toBeLessThan(65_000);
    expect(calculateQueueCreateRetryDelayMs(6, null, 0.999)).toBeLessThan(65_000);
  });

  it.each(['equal', 'longer', 'shorter'] as const)(
    'honors a retry wait that is %s than the remaining deadline',
    async (caseName) => {
      vi.useFakeTimers();
      const now = Date.now();
      const generation = getLoginQueueGeneration();
      const deadlineAt = now + 10_000;
      localStorage.setItem(
        'meomuneum:queue-create-idempotency',
        JSON.stringify({
          id: 'persisted-key',
          createdAt: now,
          deadlineAt,
          generation,
          status: 'ACTIVE',
          retryCount: 0,
          lastAttemptAt: now,
          nextAttemptAt:
            caseName === 'equal'
              ? deadlineAt
              : caseName === 'longer'
                ? deadlineAt + 1
                : now + 5_000,
          retryAfterMs: caseName === 'shorter' ? 5_000 : 10_000,
        }),
      );
      vi.stubGlobal(
        'navigator',
        Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
          locks: {
            request: async (
              _name: string,
              _options: unknown,
              callback: (lock: object) => unknown,
            ) => callback({}),
          },
        }),
      );
      const requests: Array<[string, RequestInit | undefined]> = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL, init?: RequestInit) => {
          requests.push([String(input), init]);
          return new Response(null, { status: 404 });
        }),
      );

      const pending =
        caseName === 'shorter'
          ? expect(startOrResumeLoginQueue()).rejects.toMatchObject({ status: 404 })
          : expect(startOrResumeLoginQueue()).rejects.toMatchObject({
              code: 'CREATE_DEADLINE_EXCEEDED',
            });
      await vi.runAllTimersAsync();
      await pending;

      expect(requests.some(([, init]) => init?.method === 'POST')).toBe(caseName === 'shorter');
    },
  );

  it('shares the retry count and idempotency key when two tabs resume the same marker', async () => {
    vi.useFakeTimers();
    let lockHeld = false;
    const lockRequest = async (
      _name: string,
      _options: unknown,
      callback: (lock: object | null) => unknown,
    ) => {
      if (lockHeld) return callback(null);
      lockHeld = true;
      try {
        return await callback({});
      } finally {
        lockHeld = false;
      }
    };
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: { request: lockRequest },
      }),
    );
    const createKeys: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/login-queue/tickets/current'))
          return new Response(null, { status: 404 });
        if (url.endsWith('/login-queue/tickets') && init?.method === 'POST') {
          createKeys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
          return Response.json({ code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const first = startOrResumeLoginQueue();
    const second = startOrResumeLoginQueue();
    const failures = Promise.all([
      expect(first).rejects.toMatchObject({ code: 'CREATE_RETRIES_EXHAUSTED' }),
      expect(second).rejects.toMatchObject({ code: 'CREATE_RETRIES_EXHAUSTED' }),
    ]);
    await vi.runAllTimersAsync();
    await failures;

    const marker = JSON.parse(localStorage.getItem('meomuneum:queue-create-idempotency') ?? '{}');
    expect(createKeys).toHaveLength(4);
    expect(new Set(createKeys).size).toBe(1);
    expect(marker.retryCount).toBe(3);
  });
});

describe('login queue response contract', () => {
  it('checks current status before creating and retries rate-limited status checks at most three times', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    let statusRequests = 0;
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.endsWith('/current')) {
          statusRequests += 1;
          return statusRequests < 3
            ? Response.json({ code: 'RATE_LIMITED' }, { status: 429 })
            : new Response(null, { status: 404 });
        }
        if (url.endsWith('/tickets') && init?.method === 'POST') {
          return Response.json({
            message: 'created',
            data: { status: 'WAITING', loginOutcome: null, usersAhead: 0, nextPollSeconds: 10 },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const pending = startOrResumeLoginQueue();
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ ticket: { status: 'WAITING' } });

    expect(statusRequests).toBe(3);
    expect(requests.at(-1)).toMatch(/^POST .*\/tickets$/);
  });

  it('pauses on a Retry-After beyond the reconciliation window without creating a ticket', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      requestedUrls.push(String(input));
      return Response.json(
        { code: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': '120' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(startOrResumeLoginQueue()).rejects.toMatchObject({
      code: 'QUEUE_STATUS_RETRY_PAUSED',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestedUrls[0]).toContain('/tickets/current');
  });

  it('reuses an ambiguous create key when no current ticket exists', async () => {
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    const generation = getLoginQueueGeneration();
    vi.mocked(getCsrfToken).mockResolvedValue('csrf-token');
    const run = async (cancelTarget: 'IDEMPOTENCY_KEY' | 'CURRENT_TICKET') => {
      const originalKey = `original-${cancelTarget}`;
      localStorage.setItem(
        'meomuneum:queue-create-idempotency',
        JSON.stringify({
          id: originalKey,
          createdAt: Date.now(),
          generation,
          status: 'CANCEL_REQUESTED',
          cancelTarget,
          retryCount: 3,
          lastAttemptAt: Date.now(),
        }),
      );
      let createKey: string | null = null;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith('/current')) return new Response(null, { status: 404 });
          createKey = new Headers(init?.headers).get('Idempotency-Key');
          return Response.json({
            message: 'created',
            data: { status: 'WAITING', loginOutcome: null, usersAhead: 0, nextPollSeconds: 10 },
          });
        }),
      );
      await startOrResumeLoginQueue();
      return { originalKey, createKey };
    };

    const ambiguous = await run('IDEMPOTENCY_KEY');
    const known = await run('CURRENT_TICKET');
    expect(ambiguous.createKey).toBe(ambiguous.originalKey);
    expect(known.createKey).not.toBe(known.originalKey);
  });

  it('persists the live-ticket cancel target before DELETE and uses a fresh key after ambiguous cancellation', async () => {
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.mocked(getCsrfToken).mockResolvedValue('csrf-token');
    const originalKey = 'cancelled-live-ticket-key';
    localStorage.setItem(
      'meomuneum:queue-create-idempotency',
      JSON.stringify({
        id: originalKey,
        createdAt: Date.now(),
        generation: getLoginQueueGeneration(),
        status: 'CANCEL_REQUESTED',
        cancelTarget: 'IDEMPOTENCY_KEY',
      }),
    );
    const requests: string[] = [];
    let currentReads = 0;
    let replacementKey: string | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.endsWith('/current')) {
          if (init?.method === 'DELETE') {
            expect(
              JSON.parse(localStorage.getItem('meomuneum:queue-create-idempotency') ?? '{}'),
            ).toMatchObject({ cancelTarget: 'CURRENT_TICKET' });
            return Response.json({ code: 'CANCEL_OUTCOME_UNKNOWN' }, { status: 503 });
          }
          currentReads += 1;
          return currentReads === 1
            ? Response.json(ticket('READY'))
            : new Response(null, { status: 404 });
        }
        replacementKey = new Headers(init?.headers).get('Idempotency-Key');
        return Response.json({
          message: 'created',
          data: { status: 'WAITING', loginOutcome: null, usersAhead: 0, nextPollSeconds: 10 },
        });
      }),
    );

    await expect(startOrResumeLoginQueue()).rejects.toMatchObject({ status: 503 });
    expect(
      JSON.parse(localStorage.getItem('meomuneum:queue-create-idempotency') ?? '{}'),
    ).toMatchObject({ cancelTarget: 'CURRENT_TICKET' });
    await expect(startOrResumeLoginQueue()).resolves.toMatchObject({
      ticket: { status: 'WAITING' },
    });

    expect(requests.map((request) => request.split(' ')[0])).toEqual([
      'GET',
      'DELETE',
      'GET',
      'POST',
    ]);
    expect(replacementKey).toBeTruthy();
    expect(replacementKey).not.toBe(originalKey);
  });

  it('deletes the server ticket before resetting local queue state and clearing the gate', async () => {
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.mocked(getCsrfToken).mockResolvedValue('csrf-token');
    const now = Date.now();
    localStorage.setItem(
      'meomuneum:queue-create-idempotency',
      JSON.stringify({
        id: 'ambiguous-key',
        createdAt: now,
        deadlineAt: now + 60_000,
        generation: getLoginQueueGeneration(),
        status: 'CANCEL_REQUESTED',
        cancelTarget: 'IDEMPOTENCY_KEY',
        retryCount: 2,
        nextAttemptAt: now + 10_000,
        retryAfterMs: 10_000,
        lastFailureKind: 'TRANSIENT',
      }),
    );
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await resetLoginQueueAfterLogout();

    const reset = JSON.parse(localStorage.getItem('meomuneum:queue-logout-reset') ?? '{}');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'DELETE',
      credentials: 'include',
      headers: { 'X-CSRF-TOKEN': 'csrf-token' },
    });
    expect(localStorage.getItem('meomuneum:queue-create-idempotency')).toBeNull();
    expect(reset.generation).toBe(getLoginQueueGeneration());
    expect(reset.eventId).toBeTruthy();
    expect(localStorage.getItem('meomuneum:queue-login-operation')).toBeNull();
    expect(isLogoutCleanupPending()).toBe(false);
  });

  it('sends the logout DELETE even when the browser has no local queue markers', async () => {
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.mocked(getCsrfToken).mockResolvedValue('csrf-token');
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await resetLoginQueueAfterLogout();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/auth/login-queue/tickets/current');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE', credentials: 'include' });
    expect(localStorage.getItem('meomuneum:queue-create-idempotency')).toBeNull();
    expect(localStorage.getItem('meomuneum:queue-login-operation')).toBeNull();
  });

  it('resolves an ambiguous create with the same key without calling an unsupported by-key route', async () => {
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.mocked(getCsrfToken).mockResolvedValue('csrf-token');
    localStorage.setItem(
      'meomuneum:queue-create-idempotency',
      JSON.stringify({
        id: 'cancel-unknown',
        createdAt: Date.now(),
        generation: getLoginQueueGeneration(),
        status: 'CANCEL_REQUESTED',
        cancelTarget: 'IDEMPOTENCY_KEY',
      }),
    );
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        requests.push(`${init?.method ?? 'GET'} ${String(input)}`);
        if (String(input).endsWith('/current')) return new Response(null, { status: 404 });
        if (init?.method === 'POST')
          return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
        throw new Error(`Unexpected request: ${String(input)}`);
      }),
    );

    await expect(startOrResumeLoginQueue()).rejects.toMatchObject({ status: 400 });

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatch(/^POST .*\/tickets$/);
    expect(
      JSON.parse(localStorage.getItem('meomuneum:queue-create-idempotency') ?? '{}'),
    ).toMatchObject({
      id: 'cancel-unknown',
      status: 'ACTIVE',
    });
  });

  it.each(['WAITING', 'READY', 'VERIFYING', 'RETRYABLE', 'CANCELLED', 'EXPIRED'] as const)(
    'accepts %s with an explicit null outcome',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json({ message: 'status', data: { status, loginOutcome: null } }),
        ),
      );
      await expect(getLoginQueueStatus()).resolves.toMatchObject({ status, loginOutcome: null });
    },
  );

  it.each(['SUCCESS', 'INVALID_CREDENTIALS'] as const)(
    'accepts CONSUMED with %s',
    async (loginOutcome) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json({ message: 'status', data: { status: 'CONSUMED', loginOutcome } }),
        ),
      );
      await expect(getLoginQueueStatus()).resolves.toMatchObject({
        status: 'CONSUMED',
        loginOutcome,
      });
    },
  );

  it.each([
    { status: 'WAITING' },
    { status: 'CONSUMED', loginOutcome: null },
    { status: 'WAITING', loginOutcome: 'SUCCESS' },
    { status: 'CANCELLED', loginOutcome: 'INVALID_CREDENTIALS' },
    { status: 'CONSUMED', loginOutcome: 'UNKNOWN' },
    { status: 'UNKNOWN', loginOutcome: null },
  ])('rejects malformed state/outcome pair %#', async (data) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ message: 'status', data })),
    );
    await expect(getLoginQueueStatus()).rejects.toMatchObject({ status: 500 });
  });

  it.each(['CANCELLED', 'EXPIRED'] as const)(
    'starts a fresh ticket instead of resuming a %s ticket',
    async (terminalStatus) => {
      vi.stubGlobal(
        'navigator',
        Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
          locks: {
            request: async (
              _name: string,
              _options: unknown,
              callback: (lock: object) => unknown,
            ) => callback({}),
          },
        }),
      );
      const requests: Array<{ url: string; method?: string }> = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          requests.push({ url, method: init?.method });
          if (url.endsWith('/current'))
            return Response.json({
              message: 'status',
              data: { status: terminalStatus, loginOutcome: null },
            });
          return Response.json({
            message: 'created',
            data: { status: 'WAITING', loginOutcome: null, usersAhead: 0, nextPollSeconds: 10 },
          });
        }),
      );

      await expect(startOrResumeLoginQueue()).resolves.toMatchObject({
        ticket: { status: 'WAITING' },
      });
      expect(requests).toEqual([
        expect.objectContaining({ url: expect.stringMatching(/\/current$/) }),
        expect.objectContaining({ url: expect.stringMatching(/\/tickets$/), method: 'POST' }),
      ]);
    },
  );

  it('replaces the stale create idempotency key after an HTTP 410 expiry', async () => {
    const generation = getLoginQueueGeneration();
    localStorage.setItem(
      'meomuneum:queue-create-idempotency',
      JSON.stringify({
        id: 'expired-create-key',
        createdAt: Date.now(),
        generation,
        status: 'ACTIVE',
        retryCount: 1,
      }),
    );
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    let createKey: string | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/current'))
          return Response.json({ message: 'TICKET_EXPIRED' }, { status: 410 });
        createKey = new Headers(init?.headers).get('Idempotency-Key');
        return Response.json({
          message: 'created',
          data: { status: 'WAITING', loginOutcome: null, usersAhead: 0, nextPollSeconds: 10 },
        });
      }),
    );

    await expect(startOrResumeLoginQueue()).resolves.toMatchObject({
      ticket: { status: 'WAITING' },
    });
    expect(createKey).toBeTruthy();
    expect(createKey).not.toBe('expired-create-key');
  });

  it('preserves a stale create marker when a direct status poll receives HTTP 410', async () => {
    localStorage.setItem(
      'meomuneum:queue-create-idempotency',
      JSON.stringify({ id: 'expired-poll-key', createdAt: Date.now(), status: 'ACTIVE' }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ message: 'TICKET_EXPIRED' }, { status: 410 })),
    );

    await expect(getLoginQueueStatus()).rejects.toMatchObject({
      status: 410,
      code: 'TICKET_EXPIRED',
    });
    expect(JSON.parse(localStorage.getItem('meomuneum:queue-create-idempotency') ?? '{}').id).toBe(
      'expired-poll-key',
    );
  });

  it.each(['CANCELLED', 'EXPIRED'] as const)(
    'clears a stale create marker when a direct status poll returns %s',
    async (status) => {
      localStorage.setItem(
        'meomuneum:queue-create-idempotency',
        JSON.stringify({ id: 'stale-poll-key', createdAt: Date.now(), status: 'ACTIVE' }),
      );
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json({ message: 'terminal', data: { status, loginOutcome: null } }),
        ),
      );

      await expect(getLoginQueueStatus()).resolves.toMatchObject({ status, loginOutcome: null });
      expect(localStorage.getItem('meomuneum:queue-create-idempotency')).toBeNull();
    },
  );

  it('does not let a stale terminal status response clear a newer create marker', async () => {
    const generation = getLoginQueueGeneration();
    localStorage.setItem(
      'meomuneum:queue-create-idempotency',
      JSON.stringify({ id: 'old-key', createdAt: Date.now(), generation, status: 'ACTIVE' }),
    );
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    const statusRequest = getLoginQueueStatus();
    localStorage.setItem(
      'meomuneum:queue-create-idempotency',
      JSON.stringify({ id: 'new-key', createdAt: Date.now(), generation, status: 'ACTIVE' }),
    );
    resolveFetch(Response.json({ data: { status: 'CANCELLED', loginOutcome: null } }));
    await statusRequest;

    expect(JSON.parse(localStorage.getItem('meomuneum:queue-create-idempotency') ?? '{}').id).toBe(
      'new-key',
    );
  });
});

describe('login operation markers', () => {
  it('does not publish cancel intent when Web Locks are unavailable', async () => {
    const originalNavigator = globalThis.navigator;
    const originalBroadcastChannel = globalThis.BroadcastChannel;
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: undefined,
      }),
    );
    vi.stubGlobal('BroadcastChannel', undefined);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    try {
      await expect(cancelLoginQueue()).rejects.toMatchObject({
        code: 'AUTH_CAPABILITY_UNAVAILABLE',
      });
      expect(setItem).not.toHaveBeenCalledWith(
        expect.stringContaining('meomuneum:queue-signal:'),
        expect.any(String),
      );
    } finally {
      setItem.mockRestore();
      vi.stubGlobal('navigator', originalNavigator);
      vi.stubGlobal('BroadcastChannel', originalBroadcastChannel);
    }
  });

  it('bounds repeated Web Lock contention and does not create a ticket after the deadline', async () => {
    vi.useFakeTimers();
    const request = vi.fn(
      async (_name: string, _options: unknown, callback: (lock: null) => unknown) => callback(null),
    );
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: { request },
      }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = expect(startOrResumeLoginQueue()).rejects.toMatchObject({
      code: 'QUEUE_LOCK_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await result;

    expect(request).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses one operation ID within a ticket attempt and rotates it for a successor ticket', async () => {
    let status: 'READY' | 'CONSUMED' = 'CONSUMED';
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/login-queue/tickets/current')) {
          return Response.json(ticket(status));
        }
        if (url.endsWith('/login-queue/tickets') && init?.method === 'POST') {
          status = 'READY';
          return Response.json(ticket(status));
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    await startOrResumeLoginQueue();
    const firstAttemptId = getLoginOperationId();
    expect(getLoginOperationId()).toBe(firstAttemptId);

    status = 'CONSUMED';
    await startOrResumeLoginQueue();
    expect(getLoginOperationId()).not.toBe(firstAttemptId);
  });

  it('keeps the same create key through automatic long Retry-After retries', async () => {
    vi.useFakeTimers();
    const keys: string[] = [];
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/login-queue/tickets/current'))
          return new Response(null, { status: 404 });
        if (url.endsWith('/login-queue/tickets') && init?.method === 'POST') {
          keys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
          return Response.json(
            { code: 'QUEUE_FULL', message: 'full' },
            { status: 503, headers: { 'Retry-After': '120' } },
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const pending = expect(startOrResumeLoginQueue()).rejects.toMatchObject({
      code: 'CREATE_RETRIES_EXHAUSTED',
    });
    await vi.runAllTimersAsync();
    await pending;

    const marker = JSON.parse(localStorage.getItem('meomuneum:queue-create-idempotency') ?? '{}');
    expect(keys).toHaveLength(4);
    expect(keys[0]).toBeTruthy();
    expect(new Set(keys).size).toBe(1);
    expect(marker.retryCount).toBe(3);
  });

  it('reconciles OPERATION_IN_PROGRESS with the cookie-bound current ticket', async () => {
    let currentChecks = 0;
    const createKeys: string[] = [];
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/login-queue/tickets/current')) {
          currentChecks += 1;
          return currentChecks === 1
            ? new Response(null, { status: 404 })
            : Response.json(ticket('READY'));
        }
        if (url.endsWith('/login-queue/tickets') && init?.method === 'POST') {
          createKeys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
          return Response.json(
            { code: 'OPERATION_IN_PROGRESS' },
            { status: 409, headers: { 'Retry-After': '3' } },
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const generationBeforeRecovery = getLoginQueueGeneration();
    const result = await startOrResumeLoginQueue();

    expect(result.ticket.status).toBe('READY');
    expect(result.queueGeneration).toBe(getLoginQueueGeneration());
    expect(result.queueGeneration).not.toBe(generationBeforeRecovery);
    expect(createKeys).toHaveLength(1);
  });

  it('does not retry permanent 409 create conflicts', async () => {
    vi.useFakeTimers();
    let createCount = 0;
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/login-queue/tickets/current'))
          return new Response(null, { status: 404 });
        if (url.endsWith('/login-queue/tickets') && init?.method === 'POST') {
          createCount += 1;
          return Response.json({ code: 'IDEMPOTENCY_KEY_CONFLICT' }, { status: 409 });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    await expect(startOrResumeLoginQueue()).rejects.toMatchObject({
      status: 409,
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    });
    expect(createCount).toBe(1);
  });

  it('caps automatic transport retries at three with one persisted idempotency key', async () => {
    vi.useFakeTimers();
    const createKeys: string[] = [];
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/login-queue/tickets/current'))
          return new Response(null, { status: 404 });
        if (url.endsWith('/login-queue/tickets') && init?.method === 'POST') {
          createKeys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
          return Response.json({ code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const request = startOrResumeLoginQueue();
    const failure = expect(request).rejects.toMatchObject({ status: 503 });
    await vi.runAllTimersAsync();
    await failure;
    const marker = JSON.parse(localStorage.getItem('meomuneum:queue-create-idempotency') ?? '{}');

    expect(createKeys).toHaveLength(4);
    expect(new Set(createKeys).size).toBe(1);
    expect(marker.retryCount).toBe(3);
  });

  it('keeps waiting through repeated capacity responses with the same key until a slot opens', async () => {
    vi.useFakeTimers();
    const createKeys: string[] = [];
    const recordedCapacityWaits: number[] = [];
    let createCount = 0;
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/login-queue/tickets/current'))
          return new Response(null, { status: 404 });
        if (url.endsWith('/login-queue/tickets') && init?.method === 'POST') {
          createKeys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
          const marker = JSON.parse(
            localStorage.getItem('meomuneum:queue-create-idempotency') ?? '{}',
          );
          recordedCapacityWaits.push(marker.capacityWaitCount ?? 0);
          createCount += 1;
          if (createCount <= 4) return Response.json({ message: 'QUEUE_FULL' }, { status: 429 });
          return Response.json(ticket('READY'));
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const generationBeforeCreate = getLoginQueueGeneration();
    const pending = startOrResumeLoginQueue();
    await vi.runAllTimersAsync();
    const created = await pending;
    expect(created.ticket.status).toBe('READY');
    expect(created.queueGeneration).toBe(getLoginQueueGeneration());
    expect(created.queueGeneration).not.toBe(generationBeforeCreate);

    expect(createCount).toBe(5);
    expect(new Set(createKeys).size).toBe(1);
    expect(recordedCapacityWaits).toEqual([0, 1, 2, 3, 4]);
    expect(localStorage.getItem('meomuneum:queue-create-idempotency')).toBeNull();
  });

  it('releases the cross-tab lock while waiting for queue capacity', async () => {
    vi.useFakeTimers();
    let held = false;
    let lockWasAvailableDuringWait = false;
    const locks = {
      request: async (
        _name: string,
        _options: { ifAvailable?: boolean },
        callback: (lock: object | null) => unknown,
      ) => {
        if (held) return callback(null);
        held = true;
        try {
          return await callback({});
        } finally {
          held = false;
        }
      },
    };
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, { locks }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/login-queue/tickets/current'))
          return new Response(null, { status: 404 });
        if (url.endsWith('/login-queue/tickets') && init?.method === 'POST') {
          window.setTimeout(() => {
            lockWasAvailableDuringWait = !held;
          }, 1);
          return Response.json({ message: 'QUEUE_FULL' }, { status: 429 });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const pending = expect(startOrResumeLoginQueue()).rejects.toMatchObject({
      code: 'CREATE_DEADLINE_EXCEEDED',
    });
    await vi.runAllTimersAsync();
    await pending;

    expect(lockWasAvailableDuringWait).toBe(true);
  });

  it('rejects a create response body larger than 64 KiB as an ambiguous same-key operation', async () => {
    vi.useFakeTimers();
    const keys: string[] = [];
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/login-queue/tickets/current'))
          return new Response(null, { status: 404 });
        if (url.endsWith('/login-queue/tickets') && init?.method === 'POST') {
          keys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
          return Response.json({
            data: { status: 'READY', loginOutcome: null, padding: 'x'.repeat(70_000) },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const failure = expect(startOrResumeLoginQueue()).rejects.toMatchObject({
      code: 'CREATE_RETRIES_EXHAUSTED',
    });
    await vi.runAllTimersAsync();
    await failure;

    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(1);
  });

  it('does not POST when browser storage cannot persist the idempotency marker', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const requests: Array<[string, RequestInit | undefined]> = [];
    const fetchSpy = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push([String(input), init]);
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );

    try {
      await expect(startOrResumeLoginQueue()).rejects.toBeInstanceOf(QueueRequestError);
      expect(requests.some(([, init]) => init?.method === 'POST')).toBe(false);
    } finally {
      setItem.mockRestore();
    }
  });

  it('reconciles an exhausted operation using only GET and retires its marker after a ticket is found', async () => {
    const generation = getLoginQueueGeneration();
    localStorage.setItem(
      'meomuneum:queue-create-idempotency',
      JSON.stringify({
        id: 'same-key',
        createdAt: Date.now(),
        generation,
        status: 'ACTIVE',
        retryCount: 3,
      }),
    );
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    const requests: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        requests.push([String(input), init]);
        return Response.json(ticket('READY'));
      }),
    );

    const result = await reconcileLoginQueueStatus();
    expect(result).toMatchObject({ ticket: { status: 'READY' } });
    expect(result.queueGeneration).toBe(getLoginQueueGeneration());

    expect(requests).toHaveLength(1);
    expect(requests[0][1]?.method).toBeUndefined();
    expect(localStorage.getItem('meomuneum:queue-create-idempotency')).toBeNull();
  });

  it('returns the new generation when reconciliation retires a create marker', async () => {
    const generation = getLoginQueueGeneration();
    localStorage.setItem(
      'meomuneum:queue-create-idempotency',
      JSON.stringify({
        id: 'reconcile-marker',
        createdAt: Date.now(),
        generation,
        status: 'ACTIVE',
        retryCount: 1,
      }),
    );
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(ticket('READY'))),
    );

    const result = await reconcileLoginQueueStatus();

    expect(result.ticket.status).toBe('READY');
    expect(result.queueGeneration).toBe(getLoginQueueGeneration());
    expect(result.queueGeneration).not.toBe(generation);
    expect(localStorage.getItem('meomuneum:queue-create-idempotency')).toBeNull();
  });

  it('rejects a reconciliation ticket when its generation changes during the status request', async () => {
    vi.mocked(runAuthTransition).mockImplementation(async (action) => action());
    const lock = installSerializedQueueLockManager();
    let resolveResponse!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveResponse = resolve;
          }),
      ),
    );

    const reconciliation = reconcileLoginQueueStatus();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(lock.isLockHeld()).toBe(true);
    localStorage.setItem('meomuneum:queue-generation', 'successor-generation');
    resolveResponse(Response.json(ticket('READY')));

    await expect(reconciliation).rejects.toMatchObject({
      status: 409,
      code: 'QUEUE_TICKET_REPLACED',
    });
  });

  it('retires an unresolved create marker when the locked current-ticket check finds its ticket', async () => {
    const generation = getLoginQueueGeneration();
    localStorage.setItem(
      'meomuneum:queue-create-idempotency',
      JSON.stringify({
        id: 'old-key',
        createdAt: Date.now(),
        generation,
        status: 'ACTIVE',
        retryCount: 1,
      }),
    );
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(ticket('READY'))),
    );

    const result = await startOrResumeLoginQueue();

    expect(result.ticket.status).toBe('READY');
    expect(result.queueGeneration).toBe(getLoginQueueGeneration());
    expect(result.queueGeneration).not.toBe(generation);
    expect(localStorage.getItem('meomuneum:queue-create-idempotency')).toBeNull();
  });

  it('returns the validated generation when it reuses a current ticket without changing it', async () => {
    const generation = getLoginQueueGeneration();
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(ticket('READY'))),
    );

    const result = await startOrResumeLoginQueue();

    expect(result).toEqual({
      ticket: expect.objectContaining({ status: 'READY' }),
      queueGeneration: generation,
    });
    expect(getLoginQueueGeneration()).toBe(generation);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('creates and reuses a login operation ID only after acquiring the shared queue lock', async () => {
    vi.mocked(runAuthTransition).mockImplementation(async (action) => action());
    const generation = getLoginQueueGeneration();
    const operationIds: string[] = [];
    const markerBeforeLock: Array<string | null> = [];
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (
            _name: string,
            _options: unknown,
            callback: (lock: object) => unknown,
          ) => {
            markerBeforeLock.push(localStorage.getItem('meomuneum:queue-login-operation'));
            return callback({});
          },
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        operationIds.push(new Headers(init?.headers).get('X-Login-Operation-Id') ?? '');
        return operationIds.length === 1
          ? Response.json(
              { message: 'temporarily unavailable' },
              { status: 503, headers: { 'Retry-After': '45' } },
            )
          : Response.json({
              message: 'login success',
              data: { access_token: 'token', expires_in: 60 },
            });
      }),
    );

    await expect(
      submitQueuedLogin({ email: 'user@example.com', password: 'secret' }, generation),
    ).rejects.toMatchObject({ status: 503, retryAfterSeconds: 45 });
    await submitQueuedLogin({ email: 'user@example.com', password: 'secret' }, generation);

    expect(markerBeforeLock).toEqual([null, expect.any(String)]);
    expect(operationIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(operationIds[1]).toBe(operationIds[0]);
  });

  it('does not store a successful login token after another tab replaces its queue generation', async () => {
    vi.mocked(runAuthTransition).mockImplementation(async (action) => action());
    const generation = getLoginQueueGeneration();
    let resolveLoginResponse!: (response: Response) => void;
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveLoginResponse = resolve;
          }),
      ),
    );

    const submission = submitQueuedLogin(
      { email: 'user@example.com', password: 'secret' },
      generation,
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    localStorage.setItem('meomuneum:queue-generation', 'successor-generation');
    resolveLoginResponse(
      Response.json({
        message: 'login success',
        data: { access_token: 'stale-token', expires_in: 60 },
      }),
    );

    await expect(submission).rejects.toMatchObject({
      status: 409,
      code: 'QUEUE_TICKET_REPLACED',
    });
    expect(setAccessToken).not.toHaveBeenCalled();
  });

  it('stores a successful token under the queue lock before a waiting retirement rotates generation', async () => {
    vi.mocked(runAuthTransition).mockImplementation(async (action) => action());
    const lock = installSerializedQueueLockManager();
    const generation = getLoginQueueGeneration();
    let resolveLoginResponse!: (response: Response) => void;
    let retirementCompleted = false;
    vi.mocked(setAccessToken).mockImplementation(() => {
      expect(lock.isLockHeld()).toBe(true);
      expect(retirementCompleted).toBe(false);
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveLoginResponse = resolve;
          }),
      ),
    );

    const submission = submitQueuedLogin(
      { email: 'user@example.com', password: 'secret' },
      generation,
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const retirement = retireAmbiguousLoginOperation().then(() => {
      retirementCompleted = true;
    });

    expect(getLoginQueueGeneration()).toBe(generation);
    resolveLoginResponse(
      Response.json({
        message: 'login success',
        data: { access_token: 'fresh-token', expires_in: 60 },
      }),
    );
    await expect(submission).resolves.toMatchObject({ message: 'login success' });
    await retirement;

    expect(retirementCompleted).toBe(true);
    expect(getLoginQueueGeneration()).not.toBe(generation);
    expect(setAccessToken).toHaveBeenCalledOnce();
    expect(setAccessToken).toHaveBeenCalledWith('fresh-token');
  });

  it('rejects a login without storing its token when retirement rotates generation first', async () => {
    vi.mocked(runAuthTransition).mockImplementation(async (action) => action());
    installSerializedQueueLockManager();
    const generation = getLoginQueueGeneration();
    vi.stubGlobal('fetch', vi.fn());

    await retireAmbiguousLoginOperation();

    expect(getLoginQueueGeneration()).not.toBe(generation);
    await expect(
      submitQueuedLogin({ email: 'user@example.com', password: 'secret' }, generation),
    ).rejects.toMatchObject({ status: 409, code: 'QUEUE_TICKET_REPLACED' });
    expect(fetch).not.toHaveBeenCalled();
    expect(setAccessToken).not.toHaveBeenCalled();
  });

  it('keeps a valid diagnostic correlation ID from queue status and sends it on login only', async () => {
    vi.mocked(runAuthTransition).mockImplementation(async (action) => action());
    const corrId = '0123456789abcdef0123456789abcdef';
    const requests: Headers[] = [];
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        requests.push(new Headers(init?.headers));
        if (requests.length === 1) {
          return Response.json({
            message: 'login queue status',
            data: {
              status: 'READY',
              loginOutcome: null,
              usersAhead: 0,
              nextPollSeconds: 10,
              diagnosticCorrId: corrId,
            },
          });
        }
        return Response.json({
          message: 'login success',
          data: { access_token: 'access', expires_in: 60 },
        });
      }),
    );

    await expect(getLoginQueueStatus()).resolves.toMatchObject({ diagnosticCorrId: corrId });
    await submitQueuedLogin(
      { email: 'user@example.com', password: 'secret' },
      getLoginQueueGeneration(),
      corrId,
    );

    expect(requests[0].has('X-Auth-Queue-Correlation')).toBe(false);
    expect(requests[1].get('X-Auth-Queue-Correlation')).toBe(corrId);
  });

  it('advances the shared generation inside the lock after invalid credentials', async () => {
    vi.mocked(runAuthTransition).mockImplementation(async (action) => action());
    const generation = getLoginQueueGeneration();
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ message: 'invalid' }, { status: 401 })),
    );

    await expect(
      submitQueuedLogin({ email: 'user@example.com', password: 'wrong' }, generation),
    ).rejects.toMatchObject({ status: 401, queueGeneration: expect.any(String) });

    expect(getLoginQueueGeneration()).not.toBe(generation);
  });

  it('does not start recovery after the generation changes while acquiring CSRF', async () => {
    let resolveCsrf!: (csrf: string) => void;
    vi.mocked(getCsrfToken).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCsrf = resolve;
      }),
    );
    const generation = getLoginQueueGeneration();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const recovery = recoverQueuedLogin(undefined, generation);
    localStorage.setItem('meomuneum:queue-generation', 'successor-generation');
    resolveCsrf('csrf-token');

    await expect(recovery).rejects.toMatchObject({
      status: 409,
      code: 'QUEUE_TICKET_REPLACED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setAccessToken).not.toHaveBeenCalled();
  });

  it('stores a successful recovery token while holding the queue flow lock', async () => {
    vi.mocked(runAuthTransition).mockImplementation(async (action) => action());
    vi.mocked(getCsrfToken).mockResolvedValue('csrf-token');
    const lock = installSerializedQueueLockManager();
    const generation = getLoginQueueGeneration();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          message: 'login recovered',
          data: { access_token: 'recovered-token', expires_in: 60 },
        }),
      ),
    );
    vi.mocked(setAccessToken).mockImplementation(() => {
      expect(lock.isLockHeld()).toBe(true);
    });

    await expect(recoverQueuedLogin(undefined, generation)).resolves.toMatchObject({
      message: 'login recovered',
    });

    expect(setAccessToken).toHaveBeenCalledExactlyOnceWith('recovered-token');
  });

  it('does not persist a recovery token when the generation changes during the response', async () => {
    vi.mocked(runAuthTransition).mockImplementation(async (action) => action());
    vi.mocked(getCsrfToken).mockResolvedValue('csrf-token');
    const lock = installSerializedQueueLockManager();
    const generation = getLoginQueueGeneration();
    let resolveResponse!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveResponse = resolve;
          }),
      ),
    );

    const recovery = recoverQueuedLogin(undefined, generation);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(lock.isLockHeld()).toBe(true);
    localStorage.setItem('meomuneum:queue-generation', 'successor-generation');
    resolveResponse(
      Response.json({
        message: 'login recovered',
        data: { access_token: 'stale-recovery-token', expires_in: 60 },
      }),
    );

    await expect(recovery).rejects.toMatchObject({
      status: 409,
      code: 'QUEUE_TICKET_REPLACED',
    });
    expect(setAccessToken).not.toHaveBeenCalled();
  });

  it('does not persist a recovery token after its owning login intent becomes stale', async () => {
    vi.mocked(runAuthTransition).mockImplementation(async (action) => action());
    vi.mocked(getCsrfToken).mockResolvedValue('csrf-token');
    installSerializedQueueLockManager();
    const generation = getLoginQueueGeneration();
    let resolveResponse!: (response: Response) => void;
    let isCurrent = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveResponse = resolve;
          }),
      ),
    );

    const recovery = recoverQueuedLogin(undefined, generation, () => isCurrent);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    isCurrent = false;
    resolveResponse(
      Response.json({
        message: 'login recovered',
        data: { access_token: 'stale-recovery-token', expires_in: 60 },
      }),
    );

    await expect(recovery).rejects.toMatchObject({
      status: 409,
      code: 'QUEUE_TICKET_REPLACED',
    });
    expect(setAccessToken).not.toHaveBeenCalled();
  });

  it('does not call an unavailable by-key cancellation route for an ambiguous create', async () => {
    vi.useFakeTimers();
    const key = 'persisted-ambiguous-key';
    const generation = getLoginQueueGeneration();
    localStorage.setItem(
      'meomuneum:queue-create-idempotency',
      JSON.stringify({
        id: key,
        createdAt: Date.now(),
        generation,
        status: 'ACTIVE',
        retryCount: 1,
      }),
    );
    const lockObservations: string[] = [];
    const requests: string[] = [];
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (
            _name: string,
            _options: unknown,
            callback: (lock: object) => unknown,
          ) => {
            lockObservations.push(
              JSON.parse(localStorage.getItem('meomuneum:queue-create-idempotency') ?? '{}').status,
            );
            return callback({});
          },
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.endsWith('/login-queue/tickets/current'))
          return new Response(null, { status: 404 });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    await expect(cancelLoginQueue()).rejects.toMatchObject({
      code: 'QUEUE_CANCEL_UNCONFIRMED',
    });

    expect(lockObservations).toEqual(['ACTIVE']);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatch(/^GET .*\/current$/);
    expect(
      JSON.parse(localStorage.getItem('meomuneum:queue-create-idempotency') ?? '{}'),
    ).toMatchObject({
      id: key,
      status: 'CANCEL_REQUESTED',
      cancelTarget: 'IDEMPOTENCY_KEY',
    });
  });

  it.each([201, 202])(
    'does not confirm cancellation from HTTP %s even when the body says CANCELLED',
    async (status) => {
      const generation = getLoginQueueGeneration();
      localStorage.setItem(
        'meomuneum:queue-create-idempotency',
        JSON.stringify({
          id: 'still-unresolved',
          createdAt: Date.now(),
          generation,
          status: 'ACTIVE',
        }),
      );
      vi.mocked(getCsrfToken).mockResolvedValue('csrf-token');
      vi.stubGlobal(
        'navigator',
        Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
          locks: {
            request: async (
              _name: string,
              _options: unknown,
              callback: (lock: object) => unknown,
            ) => callback({}),
          },
        }),
      );
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL, init?: RequestInit) =>
          String(input).endsWith('/tickets/current') && init?.method !== 'DELETE'
            ? Response.json(ticket('READY'))
            : Response.json({ data: { status: 'CANCELLED' } }, { status }),
        ),
      );

      await expect(cancelLoginQueue()).rejects.toMatchObject({ status });

      const marker = JSON.parse(localStorage.getItem('meomuneum:queue-create-idempotency') ?? '{}');
      expect(marker.status).toBe('CANCEL_REQUESTED');
    },
  );

  it('does not confirm current-ticket cancellation from HTTP 201', async () => {
    vi.mocked(getCsrfToken).mockResolvedValue('csrf-token');
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        if (init?.method !== 'DELETE') return Response.json(ticket('READY'));
        const marker = JSON.parse(
          localStorage.getItem('meomuneum:queue-create-idempotency') ?? '{}',
        );
        expect(marker.cancelTarget).toBe('CURRENT_TICKET');
        return Response.json({ data: { status: 'CANCELLED' } }, { status: 201 });
      }),
    );

    await expect(cancelLoginQueue()).rejects.toMatchObject({ status: 201 });
  });

  it('confirms the backend bodyless HTTP 204 cancellation response', async () => {
    const generation = getLoginQueueGeneration();
    let generationWhenLockReleased = generation;
    localStorage.setItem(
      'meomuneum:queue-create-idempotency',
      JSON.stringify({ id: 'cancel-key', createdAt: Date.now(), generation, status: 'ACTIVE' }),
    );
    vi.mocked(getCsrfToken).mockResolvedValue('csrf-token');
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (
            _name: string,
            _options: unknown,
            callback: (lock: object) => unknown,
          ) => {
            const result = await callback({});
            generationWhenLockReleased = getLoginQueueGeneration();
            return result;
          },
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (String(input).endsWith('/tickets/current') && init?.method !== 'DELETE')
          return Response.json(ticket('READY'));
        if (init?.method === 'DELETE') return new Response(null, { status: 204 });
        throw new Error(`Unexpected request: ${String(input)}`);
      }),
    );

    await expect(cancelLoginQueue()).resolves.toBeUndefined();
    expect(localStorage.getItem('meomuneum:queue-create-idempotency')).toBeNull();
    expect(generationWhenLockReleased).not.toBe(generation);
  });

  it('keeps the login operation ID through the 15-minute ticket recovery window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T00:00:00Z'));
    const first = getLoginOperationId();

    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(getLoginOperationId()).toBe(first);

    vi.advanceTimersByTime(60_001);

    expect(getLoginOperationId()).not.toBe(first);
  });

  it('does not replace an expired persisted key or POST after its 25-minute deadline', async () => {
    const generation = getLoginQueueGeneration();
    localStorage.setItem(
      'meomuneum:queue-create-idempotency',
      JSON.stringify({
        id: 'persisted-create-key',
        createdAt: 1,
        deadlineAt: 2,
        generation,
        status: 'ACTIVE',
        retryCount: 0,
      }),
    );
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
            callback({}),
        },
      }),
    );
    const keys: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/login-queue/tickets/current'))
          return new Response(null, { status: 404 });
        if (url.endsWith('/login-queue/tickets') && init?.method === 'POST') {
          keys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
          return Response.json(ticket('READY'));
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    await expect(startOrResumeLoginQueue()).rejects.toMatchObject({
      code: 'CREATE_DEADLINE_EXCEEDED',
    });

    expect(keys).toEqual([]);
  });
});
