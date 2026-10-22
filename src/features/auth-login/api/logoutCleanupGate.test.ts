import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLoginQueueStatus } from './loginQueueApi';
import {
  beginLogoutCleanupGate,
  completeLogoutCleanupGate,
  isLogoutCleanupPending,
  QUEUE_LOGOUT_PENDING_STORAGE,
  resetLogoutCleanupGateForTests,
} from './logoutCleanupGate';

describe('logout cleanup gate', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetLogoutCleanupGateForTests();
  });

  it('blocks a queue-only request when localStorage writes fail but the shared latch is set', async () => {
    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === QUEUE_LOGOUT_PENDING_STORAGE && this === localStorage) {
        throw new DOMException('storage unavailable', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    beginLogoutCleanupGate();

    expect(isLogoutCleanupPending()).toBe(true);
    await expect(getLoginQueueStatus()).rejects.toMatchObject({ code: 'LOGOUT_CLEANUP_PENDING' });
    expect(fetchMock).not.toHaveBeenCalled();

    setItem.mockRestore();
    completeLogoutCleanupGate();
    expect(isLogoutCleanupPending()).toBe(false);
  });

  it('fails closed when marker storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('storage unavailable', 'SecurityError');
    });

    expect(isLogoutCleanupPending()).toBe(true);
  });
});
