import { useEffect, useState } from 'react';

export function useDelayedMusicLoading(isLoading: boolean) {
  const [wasLoading, setWasLoading] = useState(isLoading);
  const [isVisible, setIsVisible] = useState(false);
  if (wasLoading !== isLoading) {
    setWasLoading(isLoading);
    setIsVisible(false);
  }
  useEffect(() => {
    if (!isLoading) return;
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, [isLoading]);
  return isLoading && isVisible;
}
