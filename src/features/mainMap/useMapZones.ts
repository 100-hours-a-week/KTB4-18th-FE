import { useEffect, useState, useSyncExternalStore } from 'react';
import { ACCESS_TOKEN_CHANGED_EVENT, getAccessToken } from '../auth-login/api/authSession';
import { fetchMapDots, fetchMapGrid, invalidateMapDotsCache } from './mapApi';
import type { MapLoadState } from './mapTypes';

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function subscribeToSession(onChange: () => void) {
  window.addEventListener(ACCESS_TOKEN_CHANGED_EVENT, onChange);
  return () => window.removeEventListener(ACCESS_TOKEN_CHANGED_EVENT, onChange);
}

export function useMapZones() {
  const token = useSyncExternalStore(subscribeToSession, getAccessToken, () => null);
  const [ownedState, setOwnedState] = useState<{ token: string | null; state: MapLoadState }>({
    token,
    state: { status: 'loading', attempt: 1 },
  });

  useEffect(() => {
    const controller = new AbortController();
    invalidateMapDotsCache();
    const setState = (state: MapLoadState) => setOwnedState({ token, state });

    async function loadMapZones() {
      setState({ status: 'loading', attempt: 1 });
      let gridDots;
      try {
        gridDots = await fetchMapGrid(controller.signal);
      } catch (error) {
        if (!isAbortError(error) && !controller.signal.aborted) {
          setState({ status: 'fallback', gridDots: [], items: [] });
        }
        return;
      }

      try {
        const data = await fetchMapDots(controller.signal);
        if (!controller.signal.aborted) {
          setState({ status: 'remote', gridDots, items: data.items });
        }
        return;
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
      }

      setState({ status: 'loading', attempt: 2 });
      try {
        const data = await fetchMapDots(controller.signal);
        if (!controller.signal.aborted) {
          setState({ status: 'remote', gridDots, items: data.items });
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }

        if (!controller.signal.aborted) {
          setState({ status: 'fallback', gridDots, items: [] });
        }
      }
    }

    void loadMapZones();
    return () => controller.abort();
  }, [token]);

  return ownedState.token === token
    ? ownedState.state
    : ({ status: 'loading', attempt: 1 } as MapLoadState);
}
