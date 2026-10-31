import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDirectAuthCapabilities } from './authCapabilities';

afterEach(() => vi.unstubAllGlobals());

describe('direct auth capabilities', () => {
  it('does not depend on optional tab coordination features or storage', () => {
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { cookieEnabled: true });
    vi.stubGlobal('crypto', { randomUUID: () => 'id' });
    vi.stubGlobal('fetch', () => Promise.resolve());
    expect(getDirectAuthCapabilities().ready).toBe(true);
  });

  it('fails when required cookie transport is disabled', () => {
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { cookieEnabled: false });
    vi.stubGlobal('crypto', { randomUUID: () => 'id' });
    vi.stubGlobal('fetch', () => Promise.resolve());
    expect(getDirectAuthCapabilities().ready).toBe(false);
  });
});
