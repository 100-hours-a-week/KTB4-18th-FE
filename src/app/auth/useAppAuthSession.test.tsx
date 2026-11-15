import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { useAppAuthSession } from './useAppAuthSession';
import { restoreVerifiedDirectSession } from '../../features/auth-login/api/directAuthSessionRefresh';
import {
  DIRECT_AUTH_CHANGED_EVENT,
  beginDirectAuthIntent,
  clearDirectSession,
  directAuthVersion,
  getDirectAccessToken,
  installDirectSession,
} from '../../features/auth-login/api/directAuthSessionState';
import type { AuthStatus } from '../../features/auth-login/api/authSession';
vi.mock('../../features/auth-login/api/directAuthSessionRefresh', () => ({
  restoreVerifiedDirectSession: vi.fn(),
}));
const flow = {
  flowId: 'f',
  flowEpoch: '1',
  revision: '2',
  lifecycle: 'AUTHENTICATED',
  authenticated: true,
  proofState: 'ACTIVE',
} as const;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('DEV', true);
  vi.stubEnv('VITE_AUTH_DIRECT_V2_ENABLED', 'true');
  clearDirectSession();
});
afterEach(() => {
  cleanup();
  clearDirectSession();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function useHarness() {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [version, setVersion] = useState(0);
  useAppAuthSession(status, setStatus, setVersion);
  return { status, version };
}
it('keeps initial state restoring until a slow authenticated check completes', async () => {
  let finish!: (result: 'VALID') => void;
  vi.mocked(restoreVerifiedDirectSession).mockImplementation(
    () =>
      new Promise<'VALID'>((resolve) => {
        finish = resolve;
      }),
  );
  const hook = renderHook(useHarness);
  expect(hook.result.current.status).toBe('restoring');
  await act(async () => {
    installDirectSession(directAuthVersion(), 'memory', '60', flow);
    finish('VALID');
  });
  expect(hook.result.current.status).toBe('authenticated');
});
it('reconciles peer and expiry notifications without a guest state before confirmation', async () => {
  vi.mocked(restoreVerifiedDirectSession).mockResolvedValue('VALID');
  installDirectSession(beginDirectAuthIntent(), 'memory', '60', flow);
  const hook = renderHook(useHarness);
  await act(async () => {});
  expect(hook.result.current.status).toBe('authenticated');
  let finish!: (result: 'VALID') => void;
  vi.mocked(restoreVerifiedDirectSession).mockImplementation(
    () =>
      new Promise<'VALID'>((resolve) => {
        finish = resolve;
      }),
  );
  act(() =>
    window.dispatchEvent(
      new CustomEvent(DIRECT_AUTH_CHANGED_EVENT, { detail: { reason: 'peer' } }),
    ),
  );
  expect(hook.result.current.status).toBe('authenticated');
  await act(async () => {
    finish('VALID');
  });
  expect(hook.result.current.status).toBe('authenticated');
});
it('checks focus, visibility and reconnect even when BroadcastChannel is unsupported', async () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.mocked(restoreVerifiedDirectSession).mockResolvedValue('VALID');
  const hook = renderHook(useHarness);
  await act(async () => {});
  const initial = vi.mocked(restoreVerifiedDirectSession).mock.calls.length;
  for (const name of ['focus', 'pageshow', 'online'])
    await act(async () => {
      window.dispatchEvent(new Event(name));
    });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(restoreVerifiedDirectSession).toHaveBeenCalledTimes(initial + 4);
  expect(getDirectAccessToken()).toBeNull();
  expect(hook.result.current.status).toBe('guest');
});
it('coalesces overlapping observations and rechecks once after an in-flight result', async () => {
  let finish!: (result: 'VALID') => void;
  vi.mocked(restoreVerifiedDirectSession)
    .mockImplementationOnce(
      () =>
        new Promise<'VALID'>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue('VALID');
  const hook = renderHook(useHarness);
  act(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
  });
  expect(restoreVerifiedDirectSession).toHaveBeenCalledOnce();
  await act(async () => {
    finish('VALID');
  });
  expect(restoreVerifiedDirectSession).toHaveBeenCalledTimes(2);
  expect(hook.result.current.status).toBe('guest');
});

it('holds a blank restoring state on actual client expiry until a replacement is confirmed', async () => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_AUTH_DIRECT_V2_REFRESH_VERIFIED', 'false');
  vi.mocked(restoreVerifiedDirectSession).mockResolvedValue('VALID');
  installDirectSession(beginDirectAuthIntent(), 'memory', '1', flow);
  const hook = renderHook(useHarness);
  await act(async () => {});
  let finish!: (result: 'VALID') => void;
  vi.mocked(restoreVerifiedDirectSession).mockImplementation(
    () =>
      new Promise<'VALID'>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1001);
  });
  expect(hook.result.current.status).toBe('restoring');
  await act(async () => {
    installDirectSession(directAuthVersion(), 'replacement', '60', flow);
    finish('VALID');
  });
  expect(hook.result.current.status).toBe('authenticated');
});

it('refreshes a direct-v2 token ten minutes before its one-hour expiry', async () => {
  vi.useFakeTimers();
  vi.mocked(restoreVerifiedDirectSession).mockResolvedValue('VALID');
  installDirectSession(beginDirectAuthIntent(), 'memory', '3600', flow);
  renderHook(useHarness);
  await act(async () => {});

  expect(restoreVerifiedDirectSession).toHaveBeenCalledWith({ forceRefresh: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50 * 60 * 1000 - 1);
  });
  expect(restoreVerifiedDirectSession).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(restoreVerifiedDirectSession).toHaveBeenLastCalledWith({ forceRefresh: true });
});

it('runs one due refresh immediately when a backgrounded tab becomes visible', async () => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  vi.mocked(restoreVerifiedDirectSession).mockResolvedValue('VALID');
  installDirectSession(beginDirectAuthIntent(), 'memory', '3600', flow);
  renderHook(useHarness);
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50 * 60 * 1000);
  });
  expect(restoreVerifiedDirectSession).toHaveBeenCalledTimes(1);

  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
  });
  expect(restoreVerifiedDirectSession).toHaveBeenCalledTimes(2);
  expect(restoreVerifiedDirectSession).toHaveBeenLastCalledWith({ forceRefresh: true });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

it('keeps a valid access session after proactive refresh is unavailable and avoids a refresh loop', async () => {
  vi.useFakeTimers();
  vi.mocked(restoreVerifiedDirectSession)
    .mockResolvedValueOnce('VALID')
    .mockResolvedValue('UNAVAILABLE');
  installDirectSession(beginDirectAuthIntent(), 'memory', '3600', flow);
  const hook = renderHook(useHarness);
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50 * 60 * 1000);
  });

  expect(getDirectAccessToken()).toBe('memory');
  expect(hook.result.current.status).toBe('authenticated');
  expect(restoreVerifiedDirectSession).toHaveBeenCalledTimes(2);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(restoreVerifiedDirectSession).toHaveBeenCalledTimes(3);
  expect(restoreVerifiedDirectSession).toHaveBeenLastCalledWith({ forceRefresh: false });
});

it('preserves the form key during guest focus, pageshow, online and peer observations', async () => {
  vi.mocked(restoreVerifiedDirectSession).mockResolvedValue('VALID');
  const hook = renderHook(useHarness);
  await act(async () => {});
  const version = hook.result.current.version;
  for (const name of ['focus', 'pageshow', 'online'])
    await act(async () => {
      window.dispatchEvent(new Event(name));
    });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent(DIRECT_AUTH_CHANGED_EVENT, { detail: { reason: 'peer' } }),
    );
  });
  expect(hook.result.current.version).toBe(version);
});
it('does not remount a logging-in form during a concurrent observation', async () => {
  vi.mocked(restoreVerifiedDirectSession).mockResolvedValue('VALID');
  const hook = renderHook(() => {
    const [status, setStatus] = useState<AuthStatus>('logging-in');
    const [version, setVersion] = useState(0);
    useAppAuthSession(status, setStatus, setVersion);
    return { status, version };
  });
  await act(async () => {});
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(hook.result.current.status).toBe('logging-in');
  expect(hook.result.current.version).toBe(0);
});

it('keeps a displayed guest form mounted while its background GET remains slow', async () => {
  vi.mocked(restoreVerifiedDirectSession).mockResolvedValue('VALID');
  const hook = renderHook(useHarness);
  await act(async () => {});
  expect(hook.result.current.status).toBe('guest');
  const version = hook.result.current.version;
  let finish!: (result: 'VALID') => void;
  vi.mocked(restoreVerifiedDirectSession).mockImplementation(
    () =>
      new Promise<'VALID'>((resolve) => {
        finish = resolve;
      }),
  );
  act(() => window.dispatchEvent(new Event('focus')));
  expect(hook.result.current.status).toBe('guest');
  expect(hook.result.current.version).toBe(version);
  await act(async () => {
    finish('VALID');
  });
  expect(hook.result.current.status).toBe('guest');
  expect(hook.result.current.version).toBe(version);
});
