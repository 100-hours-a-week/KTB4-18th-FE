import { useEffect, useState } from 'react';
import { fetchMapDots, fetchMapGrid } from './mapApi';
import type { MapLoadState } from './mapTypes';

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function useMapZones() {
  const [state, setState] = useState<MapLoadState>({ status: 'loading', attempt: 1 });

  useEffect(() => {
    const controller = new AbortController();

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
  }, []);

  return state;
}
