import { useCallback, useEffect, useState } from 'react';

const INTRO_STORAGE_KEY = 'meomuneum.main-map-intro-seen';

let hasSeenIntroInDocument = false;

function hasSeenIntro() {
  if (hasSeenIntroInDocument) return true;

  try {
    return window.sessionStorage.getItem(INTRO_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function getPrefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useMapIntro() {
  const [isCompleted, setIsCompleted] = useState(hasSeenIntro);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getPrefersReducedMotion);

  const completeIntro = useCallback(() => {
    hasSeenIntroInDocument = true;
    try {
      window.sessionStorage.setItem(INTRO_STORAGE_KEY, 'true');
    } catch {
      setIsCompleted(true);
      return;
    }
    setIsCompleted(true);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
      if (event.matches) completeIntro();
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [completeIntro]);

  return { isCompleted, prefersReducedMotion, completeIntro };
}
