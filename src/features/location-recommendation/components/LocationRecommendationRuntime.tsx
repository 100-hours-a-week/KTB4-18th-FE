import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  ACCESS_TOKEN_CHANGED_EVENT,
  AUTH_EXPIRED_EVENT,
  getSharedAuthEpoch,
} from '../../auth-login/api/authSession';
import { readRouteLocation, ROUTE_CHANGE_EVENT } from '../../../shared/navigation';
import { LocationRecommendationDialog } from './LocationRecommendationDialog';
import { LocationUseNotice } from './LocationUseNotice';
import {
  CoordinatorContext,
  LocationRecommendationViewContext,
  LocationRecommendationCoordinator,
  type CoordinatorView,
} from '../locationRecommendationCoordinator';
import { isLocationRecommendationServiceRoute } from '../locationRecommendationRoutes';
import type { LocationRecommendationCandidate } from '../locationRecommendationTypes';

export function LocationRecommendationProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setAuthenticated] = useState(false);
  const [pathname, setPathname] = useState(() => readRouteLocation().pathname);
  const [mapReady, setMapReady] = useState(false);
  const [view, setView] = useState<CoordinatorView>({ noticeOpen: false, candidate: null });
  const coordinatorRef = useRef<LocationRecommendationCoordinator | null>(null);
  const identityRef = useRef('');
  const serviceRouteRef = useRef(false);
  const onChange = useCallback((next: CoordinatorView) => setView(next), []);

  const subscribeAuthEpoch = useCallback((onStoreChange: () => void) => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'meomuneum:auth-epoch') onStoreChange();
    };
    window.addEventListener(ACCESS_TOKEN_CHANGED_EVENT, onStoreChange);
    window.addEventListener(AUTH_EXPIRED_EVENT, onStoreChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(ACCESS_TOKEN_CHANGED_EVENT, onStoreChange);
      window.removeEventListener(AUTH_EXPIRED_EVENT, onStoreChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);
  const getAuthEpochSnapshot = useCallback(() => {
    if (!isAuthenticated) return null;
    try {
      return getSharedAuthEpoch();
    } catch {
      return null;
    }
  }, [isAuthenticated]);
  const authEpoch = useSyncExternalStore(
    subscribeAuthEpoch,
    getAuthEpochSnapshot,
    getAuthEpochSnapshot,
  );

  const coordinator = useMemo(
    () => (authEpoch ? new LocationRecommendationCoordinator(authEpoch, onChange) : null),
    [authEpoch, onChange],
  );
  const isServiceRoute = isLocationRecommendationServiceRoute(pathname);
  const mapRoute = pathname === '/';
  const identity = `${isAuthenticated ? 'authenticated' : 'guest'}:${authEpoch ?? ''}`;

  useLayoutEffect(() => {
    coordinatorRef.current = coordinator;
    identityRef.current = identity;
    serviceRouteRef.current = isServiceRoute;
  }, [coordinator, identity, isServiceRoute]);

  useEffect(() => {
    const updatePath = () => {
      const nextPathname = readRouteLocation().pathname;
      setPathname(nextPathname);
      if (nextPathname !== '/') setMapReady(false);
    };
    window.addEventListener('popstate', updatePath);
    window.addEventListener(ROUTE_CHANGE_EVENT, updatePath);
    return () => {
      window.removeEventListener('popstate', updatePath);
      window.removeEventListener(ROUTE_CHANGE_EVENT, updatePath);
    };
  }, []);

  useEffect(() => {
    if (!coordinator || !isAuthenticated || !isServiceRoute) return;
    coordinator.start();
    const effectIdentity = identity;
    return () => {
      const resetAuth = identityRef.current !== effectIdentity;
      coordinator.stop(resetAuth, serviceRouteRef.current);
    };
  }, [coordinator, identity, isAuthenticated, isServiceRoute]);

  useEffect(() => {
    coordinator?.setMapState(mapRoute, mapReady);
  }, [coordinator, mapReady, mapRoute]);

  const reportMapState = useCallback((isMapRoute: boolean, isMapReady: boolean) => {
    setMapReady(isMapRoute && isMapReady);
  }, []);
  const acknowledgeNotice = useCallback(() => coordinatorRef.current?.acknowledgeNotice(), []);
  const dismissNotice = useCallback(() => coordinatorRef.current?.dismissNotice(), []);
  const cancelCurrent = useCallback(() => coordinatorRef.current?.cancelCurrent(), []);
  const dismissDialog = useCallback(() => coordinatorRef.current?.dismissDialog(), []);
  const verifyStatus = useCallback(
    (candidate: LocationRecommendationCandidate, verifyContext?: boolean) =>
      coordinatorRef.current?.verifyStatus(candidate, verifyContext) ?? Promise.resolve(false),
    [],
  );
  const authContext = useMemo(() => ({ setAuthenticated }), []);
  const viewContext = useMemo(() => ({ reportMapState }), [reportMapState]);

  return (
    <CoordinatorContext.Provider value={authContext}>
      <LocationRecommendationViewContext.Provider value={viewContext}>
        {children}
        {view.noticeOpen && (
          <LocationUseNotice onAcknowledge={acknowledgeNotice} onDismiss={dismissNotice} />
        )}
        {view.candidate && (
          <LocationRecommendationDialog
            candidate={view.candidate}
            verifyStatus={verifyStatus}
            onCancel={cancelCurrent}
            onDismiss={dismissDialog}
          />
        )}
      </LocationRecommendationViewContext.Provider>
    </CoordinatorContext.Provider>
  );
}
