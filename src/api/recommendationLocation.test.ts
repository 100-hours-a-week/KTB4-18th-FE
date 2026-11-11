import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { recommendationLocationToken } from './recommendationLocation';
import { resolveLocation } from './locationResolutions';
const auth = vi.hoisted(() => ({ epoch: 'account-1', token: 'synthetic-owner' }));
vi.mock('../features/auth-login/api/authSession', () => ({
  getAccessToken: () => auth.token,
  getSharedAuthEpoch: () => auth.epoch,
}));
vi.mock('./locationResolutions', () => ({ resolveLocation: vi.fn() }));
let query: ReturnType<typeof vi.fn>;
let gps: ReturnType<typeof vi.fn>;
beforeEach(() => {
  auth.epoch = 'account-1';
  auth.token = 'synthetic-owner';
  query = vi.fn().mockResolvedValue({ state: 'granted' });
  gps = vi
    .fn()
    .mockImplementation((success) =>
      success({ coords: { latitude: 37.4, longitude: 127.1, accuracy: 10 } }),
    );
  vi.stubGlobal('navigator', { permissions: { query }, geolocation: { getCurrentPosition: gps } });
  vi.mocked(resolveLocation).mockResolvedValue({
    locationResolutionToken: 'signed-current-region',
  } as Awaited<ReturnType<typeof resolveLocation>>);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
it('uses fresh permitted GPS and sends only the server token to the caller', async () => {
  const signal = new AbortController().signal;
  expect(await recommendationLocationToken(signal)).toBe('signed-current-region');
  expect(gps.mock.calls[0][2]).toMatchObject({ maximumAge: 0, timeout: 3000 });
  expect(resolveLocation).toHaveBeenCalledWith(
    { latitude: 37.4, longitude: 127.1, accuracyMeters: 10 },
    expect.any(AbortSignal),
    'synthetic-owner',
  );
});
it('does not prompt and falls back when permission, GPS or accuracy is unavailable', async () => {
  query.mockResolvedValueOnce({ state: 'prompt' });
  expect(await recommendationLocationToken(new AbortController().signal)).toBeUndefined();
  expect(gps).not.toHaveBeenCalled();
  gps.mockImplementationOnce((_, fail) => fail({ code: 2 }));
  expect(await recommendationLocationToken(new AbortController().signal)).toBeUndefined();
  gps.mockImplementationOnce((success) =>
    success({ coords: { latitude: 37, longitude: 127, accuracy: 500 } }),
  );
  expect(await recommendationLocationToken(new AbortController().signal)).toBeUndefined();
  expect(resolveLocation).not.toHaveBeenCalled();
});
it('drops a resolved location after an account transition and propagates cancellation', async () => {
  vi.mocked(resolveLocation).mockImplementationOnce(async () => {
    auth.epoch = 'account-2';
    return { locationResolutionToken: 'old-token' } as Awaited<ReturnType<typeof resolveLocation>>;
  });
  await expect(recommendationLocationToken(new AbortController().signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  const controller = new AbortController();
  controller.abort();
  await expect(recommendationLocationToken(controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
});
