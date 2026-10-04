import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkUserAvailability } from './userAvailabilityApi';

describe('checkUserAvailability', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['nickname', '한글닉네임'],
    ['email', 'name@example.com'],
  ] as const)('requests availability for %s using an encoded value', async (field, value) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: 'availability checked', data: { available: false } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkUserAvailability(field, value)).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/users/availability/${field}?value=${encodeURIComponent(value)}`,
      { cache: 'no-store' },
    );
  });

  it('rejects an unsuccessful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    await expect(checkUserAvailability('email', 'name@example.com')).rejects.toThrow(
      'availability unavailable',
    );
  });

  it('distinguishes a rate limit response for a retry hint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));

    await expect(checkUserAvailability('email', 'name@example.com')).rejects.toThrow(
      'too many requests',
    );
  });

  it('rejects an unexpected response envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'availability checked', data: { available: 'yes' } }),
      }),
    );

    await expect(checkUserAvailability('nickname', '한글닉네임')).rejects.toThrow(
      'availability unavailable',
    );
  });
});
