import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const INTRO_STORAGE_KEY = 'meomuneum.main-map-intro-seen';
let mediaQuery: MediaQueryList;

beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  mediaQuery = {
    matches: false,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mediaQuery),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('useMapIntro', () => {
  it('처음에는 미완료 상태이며 완료하면 현재 세션에 저장하고 재진입 시 유지한다', async () => {
    const { useMapIntro } = await import('./useMapIntro');
    const first = renderHook(useMapIntro);
    expect(first.result.current.isCompleted).toBe(false);
    expect(first.result.current.prefersReducedMotion).toBe(false);

    act(() => first.result.current.completeIntro());
    expect(first.result.current.isCompleted).toBe(true);
    expect(sessionStorage.getItem(INTRO_STORAGE_KEY)).toBe('true');
    first.unmount();

    const next = renderHook(useMapIntro);
    expect(next.result.current.isCompleted).toBe(true);
  });

  it('이전 모듈에서 완료했어도 새 문서와 빈 세션은 미완료로 시작한다', async () => {
    const firstModule = await import('./useMapIntro');
    const first = renderHook(firstModule.useMapIntro);
    act(() => first.result.current.completeIntro());
    first.unmount();
    sessionStorage.clear();
    vi.resetModules();

    const freshModule = await import('./useMapIntro');
    const fresh = renderHook(freshModule.useMapIntro);
    expect(fresh.result.current.isCompleted).toBe(false);
  });

  it('문서 모듈이 새로 로드되어도 세션에 저장된 완료 상태를 읽는다', async () => {
    sessionStorage.setItem(INTRO_STORAGE_KEY, 'true');
    const { useMapIntro } = await import('./useMapIntro');
    const { result } = renderHook(useMapIntro);
    expect(result.current.isCompleted).toBe(true);
  });

  it('reduced motion 변경 시 완료하고 언마운트 시 구독을 해제한다', async () => {
    const { useMapIntro } = await import('./useMapIntro');
    const { result, unmount } = renderHook(useMapIntro);
    const handler = vi.mocked(mediaQuery.addEventListener).mock.calls[0][1] as (
      event: MediaQueryListEvent,
    ) => void;

    act(() => handler({ matches: true } as MediaQueryListEvent));
    expect(result.current.prefersReducedMotion).toBe(true);
    expect(result.current.isCompleted).toBe(true);
    expect(sessionStorage.getItem(INTRO_STORAGE_KEY)).toBe('true');
    unmount();
    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith('change', handler);
  });
});
