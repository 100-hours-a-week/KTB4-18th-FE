import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDelayedPending } from './useDelayedPending';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useDelayedPending', () => {
  it('becomes eligible at 300ms and resets for a new request identity', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ pending, identity }) => useDelayedPending(pending, identity),
      { initialProps: { pending: true, identity: 1 } },
    );

    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(299));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);

    rerender({ pending: true, identity: 2 });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe(true);
  });

  it.each([299, 300, 301])('settles immediately at %ims without a visible floor', (elapsed) => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ pending, identity }) => useDelayedPending(pending, identity),
      { initialProps: { pending: true, identity: 1 } },
    );

    act(() => vi.advanceTimersByTime(elapsed));
    rerender({ pending: false, identity: 1 });
    expect(result.current).toBe(false);
  });

  it('cancels a superseded timer and an unmounted timer', () => {
    vi.useFakeTimers();
    const { result, rerender, unmount } = renderHook(
      ({ pending, identity }) => useDelayedPending(pending, identity),
      { initialProps: { pending: true, identity: 1 } },
    );

    act(() => vi.advanceTimersByTime(200));
    rerender({ pending: true, identity: 2 });
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe(true);
    rerender({ pending: true, identity: 3 });
    unmount();
    expect(() => vi.advanceTimersByTime(300)).not.toThrow();
  });

  it('does not reveal a timer that was canceled when the request settles', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ pending, identity }) => useDelayedPending(pending, identity),
      { initialProps: { pending: true, identity: 1 } },
    );

    act(() => vi.advanceTimersByTime(299));
    rerender({ pending: false, identity: 1 });
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });
});
