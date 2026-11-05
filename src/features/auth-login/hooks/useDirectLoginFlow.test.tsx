import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';
import { useDirectLoginFlow } from './useDirectLoginFlow';
import {
  startDirectLogin,
  resolveDirectLoginFailure,
  releaseRejectedDirectLogin,
  inspectDirectLogin,
  completeDirectLogin,
} from '../api/directAuthSessionFlow';
import { beginDirectAuthIntent } from '../api/directAuthSessionState';
import {
  clearDirectAuthOperation,
  persistDirectAuthOperation,
} from '../api/directAuthOperationStore';
import { inspectDirectRecovery } from '../api/directAuthRecovery';
import { readCurrentDirectOperation } from '../api/directAuthFlowApi';
import {
  inspectCommittedDirectLogout,
  performDirectLogout,
  releaseExpiredDirectLogout,
} from '../api/directAuthLogoutFlow';
vi.mock('../api/directAuthSessionFlow', () => ({
  startDirectLogin: vi.fn(),
  resolveDirectLoginFailure: vi.fn(),
  releaseRejectedDirectLogin: vi.fn(),
  completeDirectLogin: vi.fn(),
  inspectDirectLogin: vi.fn(),
  unresolvedDirectOperation: () =>
    ['BOOTSTRAP', 'LOGIN', 'LOGIN_RECOVERY', 'REFRESH', 'LOGOUT', 'REBOOTSTRAP', 'REFRESH_RECOVERY']
      .map((kind) => sessionStorage.getItem(`meomuneum:direct-auth-operation:${kind}`))
      .find(Boolean) ?? null,
}));
vi.mock('../api/directAuthLogoutFlow', () => ({
  inspectCommittedDirectLogout: vi.fn(),
  performDirectLogout: vi.fn(),
  releaseExpiredDirectLogout: vi.fn(),
}));
vi.mock('../api/directAuthRecovery', () => ({ inspectDirectRecovery: vi.fn() }));
vi.mock('../api/directAuthFlowApi', () => ({ readCurrentDirectOperation: vi.fn() }));
vi.mock('./useDirectLoginRecovery', () => ({
  useDirectLoginRecovery: () => ({
    inspectActions: vi.fn().mockResolvedValue(false),
    recoverSource: vi.fn(),
    rebootstrap: vi.fn(),
    canRecoverSource: false,
    canRebootstrap: false,
    isRecovering: false,
  }),
}));
const source = {
  flowId: 'f',
  startingEpoch: '1',
  operationId: 'o',
  expiresAt: Date.now() + 900000,
};
const event = {
  preventDefault: vi.fn(),
  currentTarget: { querySelector: () => null },
} as unknown as FormEvent<HTMLFormElement>;
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  beginDirectAuthIntent();
});
afterEach(() => vi.useRealTimers());
async function ready() {
  const options = { onLoginSuccess: vi.fn(), onLoginFailure: vi.fn() };
  const hook = renderHook(() => useDirectLoginFlow(options));
  act(() => {
    hook.result.current.updateEmail('a@b.com');
    hook.result.current.updatePassword('Password1!');
  });
  return { ...hook, options };
}
it('serializes double submit, erases password, and reports only verified success', async () => {
  vi.mocked(startDirectLogin).mockResolvedValue({
    operation: source,
    token: { access_token: 'memory', expires_in: '60' },
  });
  vi.mocked(completeDirectLogin).mockResolvedValue(true);
  const hook = await ready();
  await act(async () => {
    await Promise.all([
      hook.result.current.handleSubmit(event),
      hook.result.current.handleSubmit(event),
    ]);
  });
  expect(startDirectLogin).toHaveBeenCalledOnce();
  expect(completeDirectLogin).toHaveBeenCalledOnce();
  expect(hook.result.current.password).toBe('');
  expect(hook.options.onLoginSuccess).toHaveBeenCalledOnce();
});
it('submits current DOM values when browser autofill did not update React state', async () => {
  let submittedCredentials: { email: string; password: string } | undefined;
  vi.mocked(startDirectLogin).mockImplementation(async (credentials) => {
    submittedCredentials = { ...credentials };
    throw new Error();
  });
  vi.mocked(resolveDirectLoginFailure).mockResolvedValue(true);
  const hook = await ready();
  const autofillEvent = {
    preventDefault: vi.fn(),
    currentTarget: {
      querySelector: (selector: string) =>
        selector === '#email'
          ? { value: '  autofill@example.com  ' }
          : selector === '#password'
            ? { value: ' AutofillPassword1! ' }
            : null,
    },
  } as unknown as FormEvent<HTMLFormElement>;

  await act(async () => {
    await hook.result.current.handleSubmit(autofillEvent);
  });

  expect(submittedCredentials).toEqual({
    email: 'autofill@example.com',
    password: ' AutofillPassword1! ',
  });
  expect(hook.result.current.email).toBe('  autofill@example.com  ');
  expect(hook.result.current.password).toBe(' AutofillPassword1! ');
});
it('rejects empty DOM fields even when stale React state contains credentials', async () => {
  const hook = await ready();
  const emptyFormEvent = {
    preventDefault: vi.fn(),
    currentTarget: { querySelector: () => ({ value: '' }) },
  } as unknown as FormEvent<HTMLFormElement>;

  await act(async () => {
    await hook.result.current.handleSubmit(emptyFormEvent);
  });

  expect(startDirectLogin).not.toHaveBeenCalled();
  expect(hook.result.current.fieldErrors).toEqual({
    email: '이메일을 입력해 주세요.',
    password: '비밀번호를 입력해 주세요.',
  });
});
it('bounds 202 status polling at ten same-operation GET checks without any repeated POST', async () => {
  vi.useFakeTimers();
  vi.mocked(startDirectLogin).mockResolvedValue({ operation: source, token: null });
  vi.mocked(inspectDirectLogin).mockResolvedValue({ terminal: null, canonicalMatches: false });
  const hook = await ready();
  let pending!: Promise<void>;
  await act(async () => {
    pending = hook.result.current.handleSubmit(event);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
    await pending;
  });
  expect(startDirectLogin).toHaveBeenCalledOnce();
  expect(inspectDirectLogin).toHaveBeenCalledTimes(10);
  expect(inspectDirectLogin).toHaveBeenLastCalledWith(source);
  expect(completeDirectLogin).not.toHaveBeenCalled();
  expect(hook.result.current.isLocked).toBe(true);
  expect(hook.result.current.message).toContain('상태를 확인');
});
it('keeps uncertainty locked on a failed status read and never reports success', async () => {
  vi.mocked(startDirectLogin).mockRejectedValue(new Error());
  const hook = await ready();
  await act(async () => {
    await hook.result.current.handleSubmit(event);
  });
  await waitFor(() => expect(hook.result.current.isPending).toBe(false));
  expect(hook.result.current.isLocked).toBe(true);
  expect(hook.options.onLoginSuccess).not.toHaveBeenCalled();
});

it('unlocks a definite rejection while preserving editable form input', async () => {
  vi.mocked(startDirectLogin).mockRejectedValue(new Error());
  vi.mocked(resolveDirectLoginFailure).mockResolvedValue(true);
  const hook = await ready();
  await act(async () => {
    await hook.result.current.handleSubmit(event);
  });
  expect(hook.result.current.isLocked).toBe(false);
  expect(hook.result.current.password).toBe('Password1!');
  expect(hook.options.onLoginSuccess).not.toHaveBeenCalled();
});
it('unlocks a canonically rejected 202 operation and preserves its input', async () => {
  vi.useFakeTimers();
  vi.mocked(startDirectLogin).mockResolvedValue({ operation: source, token: null });
  vi.mocked(inspectDirectLogin).mockResolvedValue({
    terminal: {
      flowId: 'f',
      operationId: 'o',
      startingEpoch: '1',
      status: 'INVALID_CREDENTIALS',
      resultEpoch: '1',
      resultRevision: '2',
      reasonCode: null,
    },
    canonicalMatches: false,
    rejected: true,
  });
  vi.mocked(releaseRejectedDirectLogin).mockReturnValue(true);
  const hook = await ready();
  let pending!: Promise<void>;
  await act(async () => {
    pending = hook.result.current.handleSubmit(event);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
  });
  expect(hook.result.current.isLocked).toBe(false);
  expect(hook.result.current.password).toBe('Password1!');
  expect(startDirectLogin).toHaveBeenCalledOnce();
});

it('keeps a persisted logout locked after GET-only status inspection and retries only by explicit action', async () => {
  const logout = {
    flowId: '123e4567-e89b-42d3-a456-426614174000',
    startingEpoch: '1',
    operationId: '123e4567-e89b-42d3-a456-426614174001',
    expiresAt: Date.now() + 60_000,
  };
  persistDirectAuthOperation('LOGOUT', logout);
  vi.mocked(inspectCommittedDirectLogout).mockResolvedValue(false);
  vi.mocked(performDirectLogout).mockImplementation(async () => {
    clearDirectAuthOperation('LOGOUT', logout);
  });
  const hook = await ready();
  expect(hook.result.current.hasPendingLogout).toBe(true);
  expect(hook.result.current.canRetryPendingLogout).toBe(true);

  await act(async () => {
    await hook.result.current.checkStatus();
  });
  expect(inspectCommittedDirectLogout).toHaveBeenCalledWith(logout, expect.any(Number));
  expect(performDirectLogout).not.toHaveBeenCalled();
  expect(hook.result.current.isLocked).toBe(true);

  await act(async () => {
    await hook.result.current.retryPendingLogout();
  });
  expect(performDirectLogout).toHaveBeenCalledOnce();
  expect(hook.result.current.hasPendingLogout).toBe(false);
  expect(hook.result.current.isLocked).toBe(false);
});

it.each([
  'LOGIN',
  'REFRESH',
  'BOOTSTRAP',
  'LOGIN_RECOVERY',
  'REFRESH_RECOVERY',
  'REBOOTSTRAP',
] as const)('keeps a non-expired %s marker without querying or clearing it', async (kind) => {
  const login = {
    flowId: kind === 'BOOTSTRAP' ? null : '123e4567-e89b-42d3-a456-426614174000',
    startingEpoch: kind === 'BOOTSTRAP' ? null : '1',
    operationId: '123e4567-e89b-42d3-a456-426614174001',
    expiresAt: Date.now() + 60_000,
  };
  persistDirectAuthOperation(kind, login);
  vi.mocked(inspectDirectRecovery).mockRejectedValue(new Error('AUTH_OPERATION_RECEIPT_EXPIRED'));
  const hook = renderHook(() => useDirectLoginFlow({ onRetryAuthRestore: vi.fn() }));

  await act(async () => {
    await hook.result.current.checkStatus();
  });

  expect(sessionStorage.getItem(`meomuneum:direct-auth-operation:${kind}`)).not.toBeNull();
  expect(readCurrentDirectOperation).not.toHaveBeenCalled();
  expect(hook.result.current.isLocked).toBe(true);
});

it('clears only a sole expired REFRESH marker after canonical null confirmation', async () => {
  const refresh = {
    flowId: '123e4567-e89b-42d3-a456-426614174000',
    startingEpoch: '1',
    operationId: '123e4567-e89b-42d3-a456-426614174001',
    expiresAt: Date.now() - 1,
  };
  sessionStorage.setItem('meomuneum:direct-auth-operation:REFRESH', JSON.stringify(refresh));
  vi.mocked(readCurrentDirectOperation).mockResolvedValue({
    message: 'current auth operation',
    data: {
      flow: {
        flowId: refresh.flowId,
        flowEpoch: '2',
        revision: '3',
        lifecycle: 'ANONYMOUS',
        authenticated: false,
        proofState: 'ACTIVE',
      },
      operation: null,
    },
  });
  const hook = renderHook(() => useDirectLoginFlow({ onRetryAuthRestore: vi.fn() }));
  await act(async () => hook.result.current.checkStatus());
  expect(readCurrentDirectOperation).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem('meomuneum:direct-auth-operation:REFRESH')).toBeNull();
  expect(hook.result.current.isLocked).toBe(false);
});

it('keeps an expired REFRESH marker when another operation marker exists', async () => {
  const refresh = {
    flowId: '123e4567-e89b-42d3-a456-426614174000',
    startingEpoch: '1',
    operationId: '123e4567-e89b-42d3-a456-426614174001',
    expiresAt: Date.now() - 1,
  };
  const login = {
    ...refresh,
    operationId: '123e4567-e89b-42d3-a456-426614174002',
    expiresAt: Date.now() + 60_000,
  };
  sessionStorage.setItem('meomuneum:direct-auth-operation:REFRESH', JSON.stringify(refresh));
  persistDirectAuthOperation('LOGIN', login);
  const hook = renderHook(() => useDirectLoginFlow({ onRetryAuthRestore: vi.fn() }));
  await act(async () => hook.result.current.checkStatus());
  expect(readCurrentDirectOperation).not.toHaveBeenCalled();
  expect(sessionStorage.getItem('meomuneum:direct-auth-operation:REFRESH')).not.toBeNull();
  expect(sessionStorage.getItem('meomuneum:direct-auth-operation:LOGIN')).not.toBeNull();
  expect(hook.result.current.isLocked).toBe(true);
});

it('releases an expired logout marker only after canonical GET resolution', async () => {
  const logout = {
    flowId: '123e4567-e89b-42d3-a456-426614174000',
    startingEpoch: '1',
    operationId: '123e4567-e89b-42d3-a456-426614174001',
    expiresAt: Date.now() - 1,
  };
  sessionStorage.setItem('meomuneum:direct-auth-operation:LOGOUT', JSON.stringify(logout));
  vi.mocked(inspectCommittedDirectLogout).mockResolvedValue(false);
  vi.mocked(releaseExpiredDirectLogout).mockImplementation(async () => {
    clearDirectAuthOperation('LOGOUT', logout);
    return true;
  });
  const onRetryAuthRestore = vi.fn();
  const hook = renderHook(() => useDirectLoginFlow({ onRetryAuthRestore }));
  await act(async () => {
    await hook.result.current.checkStatus();
  });
  expect(releaseExpiredDirectLogout).toHaveBeenCalledWith(logout, expect.any(Number));
  expect(hook.result.current.hasPendingLogout).toBe(false);
  expect(hook.result.current.isLocked).toBe(false);
  expect(onRetryAuthRestore).toHaveBeenCalledOnce();
  expect(performDirectLogout).not.toHaveBeenCalled();
});
