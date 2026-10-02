import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ token: 'session-a' as string | null }));
vi.mock('../auth-login/api/authSession', () => ({
  ACCESS_TOKEN_CHANGED_EVENT: 'test-token-changed',
  getAccessToken: () => session.token,
}));
vi.mock('./mapApi', () => ({
  fetchMapGrid: vi.fn(),
  fetchMapDots: vi.fn(),
  invalidateMapDotsCache: vi.fn(),
}));
import { fetchMapDots, fetchMapGrid } from './mapApi';
import { useMapZones } from './useMapZones';

const data = (cover: string | null) => ({
  items: [
    { map_dot_id: 207, code: 'KR-COAST-0207', album_cover_url: cover, latest_recorded_at: null },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  session.token = 'session-a';
  vi.mocked(fetchMapGrid).mockResolvedValue([
    { code: 'KR-COAST-0207', gridRow: 48, gridColumn: 28 },
  ]);
});
afterEach(() => cleanup());

it('clears the visible old account cover and reloads when the token changes', async () => {
  vi.mocked(fetchMapDots).mockResolvedValueOnce(data('a')).mockResolvedValueOnce(data('b'));
  const { result } = renderHook(() => useMapZones());
  await waitFor(() =>
    expect(result.current).toMatchObject({ status: 'remote', items: data('a').items }),
  );
  act(() => {
    session.token = 'session-b';
    window.dispatchEvent(new Event('test-token-changed'));
  });
  expect(result.current.status).toBe('loading');
  await waitFor(() =>
    expect(result.current).toMatchObject({ status: 'remote', items: data('b').items }),
  );
});

it('aborts the old request and ignores its late cover after logout', async () => {
  let finishOld!: (value: ReturnType<typeof data>) => void;
  vi.mocked(fetchMapDots)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValueOnce(data(null));
  const { result } = renderHook(() => useMapZones());
  await waitFor(() => expect(fetchMapDots).toHaveBeenCalledTimes(1));
  const previousSignal = vi.mocked(fetchMapDots).mock.calls[0][0];
  act(() => {
    session.token = null;
    window.dispatchEvent(new Event('test-token-changed'));
  });
  expect(previousSignal.aborted).toBe(true);
  await waitFor(() =>
    expect(result.current).toMatchObject({ status: 'remote', items: data(null).items }),
  );
  await act(async () => {
    finishOld(data('old'));
  });
  expect(result.current).toMatchObject({ status: 'remote', items: data(null).items });
});
