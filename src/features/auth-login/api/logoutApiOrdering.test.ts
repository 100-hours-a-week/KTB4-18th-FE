import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./authSession', () => ({
  clearAccessToken: vi.fn(),
  getAccessToken: vi.fn(() => 'access-token'),
  getCsrfToken: vi.fn().mockResolvedValue('csrf-token'),
  runAuthTransition: vi.fn(async (action: () => Promise<void>) => action()),
}));
vi.mock('./authFlow', () => ({
  authFlowHeaders: vi.fn(
    async () =>
      new Headers({
        'X-Auth-Flow-Id': '123e4567-e89b-42d3-a456-426614174000',
        'X-Auth-Flow-Epoch': '8',
      }),
  ),
  reconcileAuthFlow: vi.fn().mockImplementation(async () => {
    const intent = JSON.parse(
      window.localStorage.getItem('meomuneum:pending-logout-operation') ?? 'null',
    );
    return {
      flowId: '123e4567-e89b-42d3-a456-426614174000',
      flowEpoch: 9,
      revision: 12,
      lifecycle: 'ANONYMOUS',
      authenticated: false,
      lastLogoutReceipt: {
        operationId: intent?.operationId,
        committed: true,
        flowEpoch: 9,
        revision: 12,
      },
    };
  }),
}));

import { clearAccessToken } from './authSession';
import { reconcileAuthFlow } from './authFlow';
import { logout } from './logoutApi';
import {
  committedLogoutResponse,
  currentAnonymousLogoutFlow,
  resetLogoutApiTestState,
} from './logoutApiTestSupport';

beforeEach(resetLogoutApiTestState);

describe('logout', () => {
  it('clears the token before reconciling so the shared epoch becomes signed out', async () => {
    const order: string[] = [];
    vi.mocked(clearAccessToken).mockImplementation(() => order.push('clear-token'));
    let reads = 0;
    vi.mocked(reconcileAuthFlow).mockImplementation(async () => {
      order.push('reconcile-flow');
      reads += 1;
      if (reads === 1) {
        return {
          flowId: '123e4567-e89b-42d3-a456-426614174000',
          flowEpoch: 8,
          revision: 11,
          lifecycle: 'AUTHENTICATED',
          authenticated: true,
          lastLogoutReceipt: null,
        };
      }
      const intent = JSON.parse(
        window.localStorage.getItem('meomuneum:pending-logout-operation') ?? 'null',
      );
      return {
        flowId: '123e4567-e89b-42d3-a456-426614174000',
        flowEpoch: 9,
        revision: 12,
        lifecycle: 'ANONYMOUS',
        authenticated: false,
        lastLogoutReceipt: {
          operationId: intent?.operationId,
          committed: true,
          flowEpoch: 9,
          revision: 12,
        },
      };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => committedLogoutResponse()),
    );

    await logout();

    expect(order).toEqual(['reconcile-flow', 'reconcile-flow', 'clear-token']);
  });

  it('replaces a logout operation saved for an older flow epoch', async () => {
    const previousOperationId = '123e4567-e89b-42d3-a456-426614174099';
    let flowReads = 0;
    vi.mocked(reconcileAuthFlow).mockImplementation(async () => {
      flowReads += 1;
      return flowReads === 1
        ? {
            flowId: '123e4567-e89b-42d3-a456-426614174000',
            flowEpoch: 8,
            revision: 11,
            lifecycle: 'AUTHENTICATED',
            authenticated: true,
            lastLogoutReceipt: null,
          }
        : currentAnonymousLogoutFlow();
    });
    window.localStorage.setItem(
      'meomuneum:pending-logout-operation',
      JSON.stringify({
        flowId: '123e4567-e89b-42d3-a456-426614174000',
        flowEpoch: 7,
        operationId: previousOperationId,
      }),
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/api/v1/auth/logout');
      expect(init?.method).toBe('POST');
      return committedLogoutResponse();
    });
    vi.stubGlobal('fetch', fetcher);

    await logout();

    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get('X-Auth-Flow-Epoch')).toBe('8');
    expect(headers.get('Idempotency-Key')).not.toBe(previousOperationId);
    expect(clearAccessToken).toHaveBeenCalledOnce();
  });
});
