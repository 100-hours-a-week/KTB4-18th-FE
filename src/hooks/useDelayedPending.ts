import { useEffect, useMemo, useState } from 'react';

const DEFAULT_DELAY_MS = 300;

/** Delays a visual pending state while tying the timer to the current request identity. */
export function useDelayedPending(
  isPending: boolean,
  requestIdentity?: unknown,
  delayMs = DEFAULT_DELAY_MS,
) {
  // The token is deliberately renewed when request inputs change, even though its value is otherwise empty.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const requestToken = useMemo(() => ({}), [delayMs, isPending, requestIdentity]);
  const [elapsedToken, setElapsedToken] = useState<object | null>(null);

  useEffect(() => {
    if (!isPending) return;

    const timer = window.setTimeout(() => setElapsedToken(requestToken), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, isPending, requestToken]);

  return isPending && elapsedToken === requestToken;
}
