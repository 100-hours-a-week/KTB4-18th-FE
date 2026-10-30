import { vi } from 'vitest';

import { getAccessToken, getCsrfToken, runAuthTransition } from './authSession';
import { reconcileAuthFlow } from './authFlow';

export function currentAnonymousLogoutFlow() {
  const intent = JSON.parse(
    window.localStorage.getItem('meomuneum:pending-logout-operation') ?? 'null',
  );
  if (!intent) {
    return {
      flowId: '123e4567-e89b-42d3-a456-426614174000',
      flowEpoch: 8,
      revision: 11,
      lifecycle: 'AUTHENTICATED' as const,
      authenticated: true,
      lastLogoutReceipt: null,
    };
  }
  return {
    flowId: '123e4567-e89b-42d3-a456-426614174000',
    flowEpoch: intent.flowEpoch + 1,
    revision: 12,
    lifecycle: 'ANONYMOUS' as const,
    authenticated: false,
    lastLogoutReceipt: {
      operationId: intent.operationId,
      committed: true as const,
      flowEpoch: intent.flowEpoch + 1,
      revision: 12,
    },
  };
}

export function committedLogoutResponse(): Response {
  return new Response(
    JSON.stringify({
      message: 'logout committed',
      data: {
        logoutReceipt: {
          operationId: JSON.parse(
            window.localStorage.getItem('meomuneum:pending-logout-operation') ?? 'null',
          )?.operationId,
          committed: true,
          flowEpoch:
            (JSON.parse(window.localStorage.getItem('meomuneum:pending-logout-operation') ?? 'null')
              ?.flowEpoch ?? 8) + 1,
          revision: 12,
        },
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Flow-Id': '123e4567-e89b-42d3-a456-426614174000',
        'X-Auth-Flow-Epoch': String(
          (JSON.parse(window.localStorage.getItem('meomuneum:pending-logout-operation') ?? 'null')
            ?.flowEpoch ?? 8) + 1,
        ),
      },
    },
  );
}

export function resetLogoutApiTestState() {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(getAccessToken).mockReturnValue('access-token');
  vi.mocked(getCsrfToken).mockReset().mockResolvedValue('csrf-token');
  vi.mocked(runAuthTransition).mockImplementation(async (action) => action());
  vi.mocked(reconcileAuthFlow).mockImplementation(async () => currentAnonymousLogoutFlow());
}
