import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useDirectLoginRecovery } from './useDirectLoginRecovery';
import { inspectSourceRecovery, performSourceRecovery } from '../api/directAuthRecovery';
import { inspectRebootstrap, performRebootstrap } from '../api/directAuthRebootstrap';
import { beginDirectAuthIntent, directAuthVersion } from '../api/directAuthSessionState';
vi.mock('../api/directAuthRecovery', () => ({
  inspectSourceRecovery: vi.fn(),
  performSourceRecovery: vi.fn(),
}));
vi.mock('../api/directAuthRebootstrap', () => ({
  inspectRebootstrap: vi.fn(),
  performRebootstrap: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  beginDirectAuthIntent();
});
function setup() {
  const options = { onLoginSuccess: vi.fn(), onMessage: vi.fn(), onReleased: vi.fn() };
  const hook = renderHook(() => useDirectLoginRecovery(options));
  return { ...hook, options };
}
function sourcePlan() {
  return {
    kind: 'refresh' as const,
    source: { flowId: 'f', startingEpoch: '1', operationId: 's', expiresAt: Date.now() + 60000 },
    recovery: null,
    sourceCutoff: Date.now() + 60000,
    version: directAuthVersion(),
  };
}
it('does no discovery or mutation automatically and requires a separate action click', async () => {
  vi.mocked(inspectSourceRecovery).mockResolvedValue(sourcePlan());
  vi.mocked(inspectRebootstrap).mockResolvedValue(null);
  const hook = setup();
  expect(inspectSourceRecovery).not.toHaveBeenCalled();
  expect(performSourceRecovery).not.toHaveBeenCalled();
  await act(async () => {
    await hook.result.current.inspectActions();
  });
  expect(hook.result.current.canRecoverSource).toBe(true);
  expect(performSourceRecovery).not.toHaveBeenCalled();
  vi.mocked(performSourceRecovery).mockResolvedValue({
    message: 'complete',
    version: directAuthVersion(),
    success: { message: 'login success', data: { access_token: 'memory', expires_in: 60 } },
  });
  await act(async () => {
    await hook.result.current.recoverSource();
  });
  expect(performSourceRecovery).toHaveBeenCalledOnce();
  expect(hook.options.onLoginSuccess).toHaveBeenCalledOnce();
});
it('allows independent rebootstrap discovery even when source metadata fails', async () => {
  vi.mocked(inspectSourceRecovery).mockRejectedValue(new Error());
  vi.mocked(inspectRebootstrap).mockResolvedValue({
    flow: {
      flowId: 'f',
      flowEpoch: '1',
      revision: '2',
      lifecycle: 'ANONYMOUS',
      authenticated: false,
      proofState: 'REBOOTSTRAP_REQUIRED',
    },
    operation: null,
    version: directAuthVersion(),
  });
  const hook = setup();
  await act(async () => {
    await hook.result.current.inspectActions();
  });
  expect(hook.result.current.canRebootstrap).toBe(true);
  expect(performRebootstrap).not.toHaveBeenCalled();
  vi.mocked(performRebootstrap).mockResolvedValue({
    message: 'ready',
    released: true,
    version: directAuthVersion(),
  });
  await act(async () => {
    await hook.result.current.rebootstrap();
  });
  expect(hook.options.onReleased).toHaveBeenCalledOnce();
});
it('ignores a stale successful response after a newer intent', async () => {
  vi.mocked(inspectSourceRecovery).mockResolvedValue(sourcePlan());
  const hook = setup();
  await act(async () => {
    await hook.result.current.inspectActions();
  });
  const version = directAuthVersion();
  vi.mocked(performSourceRecovery).mockImplementation(async () => {
    beginDirectAuthIntent();
    return {
      message: 'old',
      version,
      success: { message: 'login success', data: { access_token: 'old', expires_in: 60 } },
    };
  });
  await act(async () => {
    await hook.result.current.recoverSource();
  });
  expect(hook.options.onLoginSuccess).not.toHaveBeenCalled();
  expect(hook.options.onMessage).not.toHaveBeenCalled();
});
