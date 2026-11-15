import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDelayedMusicLoading } from './useDelayedMusicLoading';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('waits through199ms then shows at200ms and immediately hides on completion', () => {
  const { result, rerender } = renderHook(({ loading }) => useDelayedMusicLoading(loading), {
    initialProps: { loading: true },
    wrapper: StrictMode,
  });
  act(() => vi.advanceTimersByTime(199));
  expect(result.current).toBe(false);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current).toBe(true);
  rerender({ loading: false });
  expect(result.current).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
it('never flashes for a fast response and starts a fresh delay for another request', () => {
  const { result, rerender } = renderHook(({ loading }) => useDelayedMusicLoading(loading), {
    initialProps: { loading: true },
  });
  act(() => vi.advanceTimersByTime(100));
  rerender({ loading: false });
  act(() => vi.advanceTimersByTime(200));
  expect(result.current).toBe(false);
  rerender({ loading: true });
  act(() => vi.advanceTimersByTime(199));
  expect(result.current).toBe(false);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current).toBe(true);
});
it('cleans pending work on tab departure and unmount', () => {
  const { result, rerender, unmount } = renderHook(
    ({ loading }) => useDelayedMusicLoading(loading),
    { initialProps: { loading: true }, wrapper: StrictMode },
  );
  rerender({ loading: false });
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(300));
  expect(result.current).toBe(false);
  rerender({ loading: true });
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
