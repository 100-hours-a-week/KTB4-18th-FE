import { useCallback, useLayoutEffect, useRef } from 'react';

import { ROUTE_CHANGE_EVENT } from '../../../shared/navigation';

const SCROLL_DURATION_MS = 300;

export function useMusicRecordRegionScroll(isDisabled: boolean) {
  const frame = useRef<number | null>(null);

  const cancelScroll = useCallback(() => {
    if (frame.current === null) return;
    window.cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  useLayoutEffect(() => {
    if (isDisabled) return;
    window.addEventListener('popstate', cancelScroll);
    window.addEventListener(ROUTE_CHANGE_EVENT, cancelScroll);
    return () => {
      cancelScroll();
      window.removeEventListener('popstate', cancelScroll);
      window.removeEventListener(ROUTE_CHANGE_EVENT, cancelScroll);
    };
  }, [cancelScroll, isDisabled]);

  const scrollToTop = (onComplete: () => void) => {
    cancelScroll();
    const startTop = window.scrollY;
    if (startTop <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      onComplete();
      return;
    }

    const startTime = window.performance.now();
    const step = (timestamp: number) => {
      const progress = Math.min(Math.max((timestamp - startTime) / SCROLL_DURATION_MS, 0), 1);
      const easedProgress = (1 - Math.cos(Math.PI * progress)) / 2;
      window.scrollTo({ top: startTop * (1 - easedProgress), behavior: 'instant' });
      if (progress < 1) {
        frame.current = window.requestAnimationFrame(step);
        return;
      }
      frame.current = null;
      onComplete();
    };

    frame.current = window.requestAnimationFrame(step);
  };

  return { scrollToTop, cancelScroll };
}
