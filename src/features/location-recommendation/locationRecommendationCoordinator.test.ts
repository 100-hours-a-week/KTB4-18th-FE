import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_TOKEN_CHANGED_EVENT } from '../auth-login/api/authSession';
import {
  getLocationSampleAgeMs,
  getLocationSample,
  isPersistedPageReentry,
  isLocalLocationRecommendationTestHost,
  isValidLocationSample,
  LocationRecommendationCoordinator,
  reserveAccessSequence,
  withValidatedAccessLock,
} from './locationRecommendationCoordinator';
import {
  LocationRecommendationApiError,
  LocationRecommendationTimeoutError,
} from './api/locationRecommendationApi';
import {
  LOCATION_RECOMMENDATION_BRIDGE_PREFIX,
  LOCATION_RECOMMENDATION_STATUS_INTERVAL_MS,
  LOCATION_RECOMMENDATION_WEB_LOCK,
  type LocationRecommendationCandidate,
  type LocationRecommendationState,
  type WorkerGrant,
} from './locationRecommendationTypes';
import {
  cancelLocationRecommendation,
  claimLocationRecommendationDisplay,
  createLocationRecommendation,
  getLocationRecommendationContext,
  getLocationRecommendationStatus,
} from './api/locationRecommendationApi';

vi.mock('./api/locationRecommendationApi', () => ({
  cancelLocationRecommendation: vi.fn(),
  claimLocationRecommendationDisplay: vi.fn(),
  createLocationRecommendation: vi.fn(),
  getLocationRecommendationContext: vi.fn(),
  getLocationRecommendationStatus: vi.fn(),
  LocationRecommendationApiError: class LocationRecommendationApiError extends Error {
    readonly status: number | null;

    constructor(status: number | null) {
      super('Location recommendation request failed');
      this.status = status;
    }
  },
  LocationRecommendationTimeoutError: class LocationRecommendationTimeoutError extends Error {},
}));

const scopeGeneration = '123e4567-e89b-42d3-a456-426614174000';
const requestId = '223e4567-e89b-42d3-a456-426614174001';

function lockManager(
  request: (
    name: string,
    options: LockOptions,
    callback: (lockValue: Lock | null) => Promise<boolean>,
  ) => Promise<boolean>,
): Pick<LockManager, 'request'> {
  return { request } as unknown as Pick<LockManager, 'request'>;
}

const grant: WorkerGrant = {
  tabId: '323e4567-e89b-42d3-a456-426614174002',
  accessEventId: '423e4567-e89b-42d3-a456-426614174003',
  operationUUID: '523e4567-e89b-42d3-a456-426614174004',
  leaderEpoch: 3,
  workerInstanceId: '623e4567-e89b-42d3-a456-426614174005',
};

const candidate: LocationRecommendationCandidate = {
  authEpoch: 'auth-epoch',
  accessEventId: grant.accessEventId,
  operationUUID: grant.operationUUID,
  accessSequence: 1,
  leaderEpoch: grant.leaderEpoch,
  requestId,
  region: { regionId: 1, code: '11110', name: '종로구', sidoName: '서울특별시' },
  tracks: [
    {
      trackId: 'track-1',
      title: '노래',
      artist: '가수',
      previewUrl: null,
      artworkUrl: null,
      storeUrl: null,
    },
  ],
  scopeGeneration,
  cancelEpoch: 2,
  remainingTtlMs: 60_000,
  receivedAt: 1,
  sourceWorkerInstanceId: 'worker',
  sourceStateRevision: 4,
};

describe('location recommendation coordination helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('keeps the displayed recommendation available when leaving and returning to the map route', () => {
    const coordinator = new LocationRecommendationCoordinator('auth-epoch', () => undefined);
    const internals = coordinator as unknown as {
      displayedCandidate: LocationRecommendationCandidate | null;
      client: { setMapEligibility: ReturnType<typeof vi.fn> };
      setMapState: (isMapRoute: boolean, isMapReady: boolean) => void;
    };
    internals.displayedCandidate = candidate;
    internals.client = { setMapEligibility: vi.fn() };

    internals.setMapState(false, false);

    expect(internals.displayedCandidate).toBe(candidate);
  });

  it('enables repeated map recommendations only on localhost and IPv4 loopback', () => {
    expect(isLocalLocationRecommendationTestHost('localhost')).toBe(true);
    expect(isLocalLocationRecommendationTestHost('127.0.0.1')).toBe(true);
    expect(isLocalLocationRecommendationTestHost('192.168.0.10')).toBe(false);
    expect(isLocalLocationRecommendationTestHost('dev.meomuneum.com')).toBe(false);
  });

  it('starts another local recommendation when re-entering the ready main map', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const coordinator = new LocationRecommendationCoordinator('local-map-repeat-test', () => {});
    const beginAccessEvent = vi.fn();
    const internals = coordinator as unknown as {
      serviceRoute: boolean;
      isActive: boolean;
      lastActive: boolean;
      started: boolean;
      hasEnteredReadyMap: boolean;
      beginAccessEvent: typeof beginAccessEvent;
      setMapState: (isMapRoute: boolean, isMapReady: boolean) => void;
    };
    internals.serviceRoute = true;
    internals.isActive = true;
    internals.lastActive = true;
    internals.started = false;
    internals.hasEnteredReadyMap = true;
    internals.beginAccessEvent = beginAccessEvent;

    internals.setMapState(false, false);
    internals.setMapState(true, true);

    expect(beginAccessEvent).toHaveBeenCalledOnce();
  });

  it('preserves an unclosed recommendation when temporarily leaving service routes', () => {
    const coordinator = new LocationRecommendationCoordinator('auth-epoch', () => undefined);
    const internals = coordinator as unknown as {
      displayedCandidate: LocationRecommendationCandidate | null;
      client: { deactivate: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
      started: boolean;
      stop: (resetAuth: boolean, preserveLogicalActivity: boolean) => void;
    };
    internals.displayedCandidate = candidate;
    internals.client = { deactivate: vi.fn(), close: vi.fn() };
    internals.started = true;

    internals.stop(false, false);

    expect(internals.displayedCandidate).toBe(candidate);
  });

  it('does not close a displayed recommendation when geolocation permission changes', () => {
    const coordinator = new LocationRecommendationCoordinator('auth-epoch', () => undefined);
    const internals = coordinator as unknown as {
      displayedCandidate: LocationRecommendationCandidate | null;
      locationPermissionStatus: { state: PermissionState };
      client: { deactivate: ReturnType<typeof vi.fn> };
      handleLocationPermissionChange: () => void;
    };
    internals.displayedCandidate = candidate;
    internals.locationPermissionStatus = { state: 'denied' };
    internals.client = { deactivate: vi.fn() };

    internals.handleLocationPermissionChange();

    expect(internals.displayedCandidate).toBe(candidate);
  });

  it('requests one fresh high accuracy position with no cached position', async () => {
    const timestamp = Date.now();
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({
        coords: { latitude: 37.5, longitude: 127, accuracy: 25 } as GeolocationCoordinates,
        timestamp,
      } as GeolocationPosition),
    );

    await expect(getLocationSample({ getCurrentPosition })).resolves.toMatchObject({
      latitude: 37.5,
      longitude: 127,
      accuracyMeters: 25,
      sampledAt: timestamp,
    });
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10_000,
    });
  });

  it('accepts fresh samples at 300 meters and rejects stale or invalid samples', () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(
      isValidLocationSample({
        latitude: 90,
        longitude: -180,
        accuracyMeters: 300,
        sampledAt: now,
      }),
    ).toBe(true);
    expect(
      isValidLocationSample({
        latitude: 0,
        longitude: 0,
        accuracyMeters: 300.01,
        sampledAt: now,
      }),
    ).toBe(false);
    expect(
      isValidLocationSample({
        latitude: 90.01,
        longitude: 0,
        accuracyMeters: 1,
        sampledAt: now,
      }),
    ).toBe(false);
    expect(getLocationSampleAgeMs(now, now)).toBe(0);
    expect(getLocationSampleAgeMs(now - 30_000, now)).toBe(30_000);
    expect(getLocationSampleAgeMs(now - 30_001, now)).toBeNull();
    expect(getLocationSampleAgeMs(now + 1, now)).toBeNull();
    expect(getLocationSampleAgeMs(Number.NaN, now)).toBeNull();
    expect(getLocationSampleAgeMs(Number.POSITIVE_INFINITY, now)).toBeNull();
    expect(
      isValidLocationSample({
        latitude: 37.5,
        longitude: 127,
        accuracyMeters: 10,
        sampledAt: now - 30_001,
      }),
    ).toBe(false);
  });

  it('does not turn the initial pageshow into another access event', () => {
    expect(isPersistedPageReentry({ persisted: false }, true)).toBe(false);
    expect(isPersistedPageReentry({ persisted: true }, true)).toBe(true);
    expect(isPersistedPageReentry({ persisted: true }, false)).toBe(false);
  });

  it('revalidates the exact worker grant inside an if-available Web Lock', async () => {
    const order: string[] = [];
    const onGranted = vi.fn(async () => undefined);
    const validateGrant = vi.fn(async () => {
      order.push('validate');
      return true;
    });
    const reserveEvent = vi.fn(async () => {
      order.push('reserve');
      return true;
    });
    const lock = { name: LOCATION_RECOMMENDATION_WEB_LOCK, mode: 'exclusive' };
    const request = vi.fn(
      async (
        _name: string,
        _options: LockOptions,
        callback: (lockValue: Lock | null) => Promise<boolean>,
      ) => callback(lock as Lock),
    );

    await expect(
      withValidatedAccessLock(
        lockManager(request),
        grant,
        validateGrant,
        () => true,
        onGranted,
        reserveEvent,
      ),
    ).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith(
      LOCATION_RECOMMENDATION_WEB_LOCK,
      { mode: 'exclusive', ifAvailable: true },
      expect.any(Function),
    );
    expect(validateGrant).toHaveBeenCalledWith(grant);
    expect(onGranted).toHaveBeenCalledOnce();
    expect(order).toEqual(['reserve', 'validate']);
    expect(reserveEvent).toHaveBeenCalledOnce();
  });

  it('increments the per-auth access sequence stored for Web Lock winners', () => {
    const key = 'meomuneum.location-recommendation.access-sequence.v1:sequence-test';
    window.localStorage.removeItem(key);
    expect(reserveAccessSequence('sequence-test')).toBe(1);
    expect(reserveAccessSequence('sequence-test')).toBe(2);
    window.localStorage.removeItem(key);
  });

  it('requires and writes the exact v4 location notice revision', () => {
    const revisionKey = 'meomuneum.location-recommendation.notice-ack';
    const priorBooleanKey = `${revisionKey}.v3`;
    window.localStorage.removeItem(revisionKey);
    window.localStorage.setItem(priorBooleanKey, 'true');
    const coordinator = new LocationRecommendationCoordinator('notice-test', () => undefined);
    const internals = coordinator as unknown as { noticeAcknowledged: boolean };

    expect(internals.noticeAcknowledged).toBe(false);
    coordinator.acknowledgeNotice();
    expect(window.localStorage.getItem(revisionKey)).toBe('v4');
    expect(internals.noticeAcknowledged).toBe(true);
    window.localStorage.removeItem(revisionKey);
    window.localStorage.removeItem(priorBooleanKey);
  });

  it('pauses automatic location checks after a 403 until authorization changes', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const coordinator = new LocationRecommendationCoordinator('service-403-test', () => undefined);
    const deactivate = vi.fn();
    const acquireLeaderAndStart = vi.fn(async () => undefined);
    const internals = coordinator as unknown as {
      authorizationPaused: boolean;
      activeGrant: WorkerGrant | null;
      currentAccessEventId: string | null;
      currentOperationUUID: string | null;
      isActive: boolean;
      isMapRoute: boolean;
      serviceRoute: boolean;
      started: boolean;
      client: { deactivate: typeof deactivate };
      pauseAfterAuthorizationFailure: (error: unknown) => void;
      handleAuthorizationChange: () => void;
      acquireLeaderAndStart: typeof acquireLeaderAndStart;
      noticeAcknowledged: boolean;
      transitionCount: number;
      currentTrigger: string;
    };
    internals.activeGrant = grant;
    internals.currentAccessEventId = grant.accessEventId;
    internals.currentOperationUUID = grant.operationUUID;
    internals.isActive = true;
    internals.isMapRoute = true;
    internals.serviceRoute = true;
    internals.started = true;
    internals.client = { deactivate };
    internals.acquireLeaderAndStart = acquireLeaderAndStart;
    internals.noticeAcknowledged = true;
    internals.transitionCount = 1;
    const handleAuthorizationChange = internals.handleAuthorizationChange;
    window.addEventListener(ACCESS_TOKEN_CHANGED_EVENT, handleAuthorizationChange);
    internals.pauseAfterAuthorizationFailure(new LocationRecommendationApiError(403));

    expect(internals.authorizationPaused).toBe(true);
    expect(deactivate).toHaveBeenCalledWith(grant);
    expect(acquireLeaderAndStart).not.toHaveBeenCalled();

    window.dispatchEvent(new Event(ACCESS_TOKEN_CHANGED_EVENT));
    await vi.waitFor(() => expect(acquireLeaderAndStart).toHaveBeenCalledOnce());
    expect(internals.authorizationPaused).toBe(false);
    expect(internals.currentTrigger).toBe('RESUME');
    expect(internals.currentAccessEventId).not.toBe(grant.accessEventId);
    window.removeEventListener(ACCESS_TOKEN_CHANGED_EVENT, handleAuthorizationChange);
  });

  it('starts one access check on service entry before the map route is ready', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const coordinator = new LocationRecommendationCoordinator(
      'service-entry-test',
      () => undefined,
    );
    const beginAccessEvent = vi.fn();
    const internals = coordinator as unknown as {
      serviceRoute: boolean;
      isMapRoute: boolean;
      isActive: boolean;
      lastActive: boolean;
      started: boolean;
      noticeAcknowledged: boolean;
      beginAccessEvent: typeof beginAccessEvent;
      checkActivity: () => void;
    };
    internals.serviceRoute = true;
    internals.isMapRoute = false;
    internals.started = true;
    internals.noticeAcknowledged = true;
    internals.beginAccessEvent = beginAccessEvent;
    internals.checkActivity();

    expect(internals.isActive).toBe(true);
    expect(internals.lastActive).toBe(true);
    expect(internals.isMapRoute).toBe(false);
    expect(beginAccessEvent).toHaveBeenCalledOnce();
  });

  it('resumes a location check when browser geolocation permission is granted again', async () => {
    const originalPermissions = Object.getOwnPropertyDescriptor(navigator, 'permissions');
    const permissionStatus = new EventTarget() as PermissionStatus;
    let permissionState: PermissionState = 'denied';
    Object.defineProperty(permissionStatus, 'state', {
      configurable: true,
      get: () => permissionState,
    });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn().mockResolvedValue(permissionStatus) },
    });

    const coordinator = new LocationRecommendationCoordinator('permission-regrant-test', () => {});
    const internals = coordinator as unknown as {
      started: boolean;
      isActive: boolean;
      isMapRoute: boolean;
      noticeAcknowledged: boolean;
      authorizationPaused: boolean;
      beginAccessEvent: (trigger?: string) => void;
      hasLocationPermission: () => Promise<boolean>;
    };
    const beginAccessEvent = vi.fn();
    internals.started = true;
    internals.isActive = true;
    internals.isMapRoute = true;
    internals.noticeAcknowledged = true;
    internals.authorizationPaused = false;
    internals.beginAccessEvent = beginAccessEvent;
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);

    try {
      await expect(internals.hasLocationPermission()).resolves.toBe(false);
      permissionState = 'granted';
      permissionStatus.dispatchEvent(new Event('change'));

      expect(beginAccessEvent).toHaveBeenCalledWith('RESUME');
    } finally {
      coordinator.stop(false, false);
      if (originalPermissions) {
        Object.defineProperty(navigator, 'permissions', originalPermissions);
      } else {
        Reflect.deleteProperty(navigator, 'permissions');
      }
    }
  });

  it('does not start when the lock is unavailable or the grant changed', async () => {
    const onGranted = vi.fn(async () => undefined);
    const validateGrant = vi.fn(async () => true);
    const unavailableLock = {
      request: async (
        _name: string,
        _options: LockOptions,
        callback: (lockValue: Lock | null) => Promise<boolean>,
      ) => callback(null),
    };
    await expect(
      withValidatedAccessLock(
        lockManager(unavailableLock.request),
        grant,
        validateGrant,
        () => true,
        onGranted,
      ),
    ).resolves.toBe(false);
    expect(validateGrant).not.toHaveBeenCalled();

    const changedGrantLock = {
      request: async (
        _name: string,
        _options: LockOptions,
        callback: (lockValue: Lock | null) => Promise<boolean>,
      ) => callback({ name: 'lock', mode: 'exclusive' } as Lock),
    };
    validateGrant.mockResolvedValue(false);
    await expect(
      withValidatedAccessLock(
        lockManager(changedGrantLock.request),
        grant,
        validateGrant,
        () => true,
        onGranted,
      ),
    ).resolves.toBe(false);
    expect(onGranted).not.toHaveBeenCalled();
  });

  it('requires an exact request ID, READY status, matching context, and same region before display', async () => {
    const coordinator = new LocationRecommendationCoordinator('auth-epoch', () => undefined);
    vi.mocked(getLocationRecommendationStatus).mockResolvedValue({
      requestId,
      status: 'READY',
      reason: null,
      region: candidate.region,
      tracks: candidate.tracks,
      scopeGeneration,
      cancelEpoch: 2,
      remainingTtlMs: 60_000,
    });
    vi.mocked(getLocationRecommendationContext).mockResolvedValue({
      scopeGeneration,
      cancelEpoch: 2,
      kstDate: '2026-10-31',
      activeRequestId: null,
    });

    await expect(coordinator.verifyStatus(candidate, true)).resolves.toBe(true);
    vi.mocked(getLocationRecommendationStatus).mockResolvedValueOnce({
      requestId: '723e4567-e89b-42d3-a456-426614174006',
      status: 'READY',
      reason: null,
      region: candidate.region,
      tracks: candidate.tracks,
      scopeGeneration,
      cancelEpoch: 2,
      remainingTtlMs: 60_000,
    });
    await expect(coordinator.verifyStatus(candidate, true)).resolves.toBe(false);

    vi.mocked(getLocationRecommendationStatus).mockResolvedValue({
      requestId,
      status: 'READY',
      reason: null,
      region: candidate.region,
      tracks: candidate.tracks,
      scopeGeneration,
      cancelEpoch: 2,
      remainingTtlMs: 60_000,
    });
    vi.mocked(getLocationRecommendationContext).mockResolvedValue({
      scopeGeneration,
      cancelEpoch: 3,
      kstDate: '2026-10-31',
      activeRequestId: null,
    });
    await expect(coordinator.verifyStatus(candidate, true)).resolves.toBe(false);
  });

  it('does not adopt a prior bridge event while the active tab is awaiting access confirmation', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const coordinator = new LocationRecommendationCoordinator('auth-epoch', () => undefined);
    const localEventId = 'a23e4567-e89b-42d3-a456-426614174009';
    const localOperationId = 'b23e4567-e89b-42d3-a456-426614174010';
    const internals = coordinator as unknown as {
      isActive: boolean;
      serviceRoute: boolean;
      currentAccessEventId: string | null;
      currentOperationUUID: string | null;
      currentState: unknown;
      isMapRoute: boolean;
      handleWorkerState: (state: unknown, isInitial: boolean) => void;
    };
    internals.isActive = true;
    internals.serviceRoute = true;
    internals.currentAccessEventId = localEventId;
    internals.currentOperationUUID = localOperationId;
    internals.isMapRoute = true;
    internals.handleWorkerState(
      {
        authEpoch: 'auth-epoch',
        workerInstanceId: 'worker-old',
        stateRevision: 100,
        activeTabId: grant.tabId,
        leaderEpoch: grant.leaderEpoch,
        accessEventId: candidate.accessEventId,
        operationUUID: candidate.operationUUID,
        accessSequence: 4,
        phase: 'REQUEST_SENT',
        status: 'READY',
        requestId: candidate.requestId,
        region: candidate.region,
        tracks: candidate.tracks,
        scopeGeneration,
        cancelEpoch: 2,
        remainingTtlMs: 60_000,
        displayGrantedTabId: null,
        candidate,
        cancelMarker: null,
      },
      false,
    );

    expect(internals.currentState).toBeNull();
    expect(internals.currentAccessEventId).toBe(localEventId);
  });

  it('synchronizes context after a 409 without retrying the location request', async () => {
    const context = {
      scopeGeneration,
      cancelEpoch: 2,
      kstDate: '2026-10-31',
      activeRequestId: null,
    };
    vi.mocked(getLocationRecommendationContext).mockResolvedValue(context);
    const coordinator = new LocationRecommendationCoordinator('auth-epoch', () => undefined);
    const internals = coordinator as unknown as {
      completeRequest: (
        requestGrant: WorkerGrant,
        requestContext: typeof context,
        request: Promise<never>,
        client: object,
        requestStartedAt: number,
      ) => Promise<void>;
    };

    await internals.completeRequest(
      grant,
      context,
      Promise.reject(new LocationRecommendationApiError(409)),
      {},
      0,
    );

    expect(getLocationRecommendationContext).toHaveBeenCalledOnce();
    expect(createLocationRecommendation).not.toHaveBeenCalled();
  });

  it('drops a terminal status 409 without refreshing context', async () => {
    const context = {
      scopeGeneration,
      cancelEpoch: 2,
      kstDate: '2026-10-31',
      activeRequestId: null,
    };
    const coordinator = new LocationRecommendationCoordinator('auth-epoch', () => undefined);
    const internals = coordinator as unknown as {
      waitForTerminalStatus: () => Promise<never>;
      completeRequest: (
        requestGrant: WorkerGrant,
        requestContext: typeof context,
        request: Promise<{
          requestId: string;
          status: 'PROCESSING';
          reason: null;
          region: LocationRecommendationCandidate['region'];
          tracks: [];
          scopeGeneration: string;
          cancelEpoch: number;
          remainingTtlMs: number;
        }>,
        client: object,
        requestStartedAt: number,
      ) => Promise<void>;
    };
    internals.waitForTerminalStatus = vi.fn(async () => {
      throw new LocationRecommendationApiError(409);
    });
    await internals.completeRequest(
      grant,
      context,
      Promise.resolve({
        requestId,
        status: 'PROCESSING',
        reason: null,
        region: candidate.region,
        tracks: [],
        scopeGeneration,
        cancelEpoch: 2,
        remainingTtlMs: 0,
      }),
      {},
      0,
    );

    expect(getLocationRecommendationContext).not.toHaveBeenCalled();
    expect(createLocationRecommendation).not.toHaveBeenCalled();
  });

  it('keeps READY UI intact while persisting request-scoped timeout cleanup without close fanout', async () => {
    const coordinator = new LocationRecommendationCoordinator('auth-epoch', () => undefined);
    const cancelPending = vi.fn();
    const controller = new AbortController();
    const internals = coordinator as unknown as {
      displayedCandidate: LocationRecommendationCandidate | null;
      requestControllers: Map<string, AbortController>;
      client: { cancelPending: typeof cancelPending };
      completeRequest: (
        requestGrant: WorkerGrant,
        requestContext: {
          scopeGeneration: string;
          cancelEpoch: number;
          kstDate: string;
          activeRequestId: null;
        },
        request: Promise<never>,
        client: object,
        requestStartedAt: number,
      ) => Promise<void>;
    };
    internals.displayedCandidate = candidate;
    internals.requestControllers.set(grant.operationUUID, controller);
    internals.client = { cancelPending };
    vi.mocked(cancelLocationRecommendation).mockImplementation(() => new Promise(() => undefined));
    const closeEvent = vi.fn();
    window.addEventListener('meomuneum:location-recommendation:cancel', closeEvent);
    const context = {
      scopeGeneration,
      cancelEpoch: 2,
      kstDate: '2026-10-31',
      activeRequestId: null,
    } as const;

    await internals.completeRequest(
      grant,
      context,
      Promise.reject(new LocationRecommendationTimeoutError()),
      {},
      0,
    );

    expect(controller.signal.aborted).toBe(true);
    expect(internals.displayedCandidate).toBe(candidate);
    expect(cancelPending).not.toHaveBeenCalled();
    expect(closeEvent).not.toHaveBeenCalled();
    const timeoutKey = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    ).find((key) => key?.startsWith('meomuneum.location-recommendation.timeout-cleanup:'));
    expect(timeoutKey).toBeTruthy();
    window.removeEventListener('meomuneum:location-recommendation:cancel', closeEvent);
    if (timeoutKey) window.localStorage.removeItem(timeoutKey);
  });

  it('keeps the same READY operation hidden after coordinator and worker recreation', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const views: Array<{ candidate: LocationRecommendationCandidate | null }> = [];
    const coordinator = new LocationRecommendationCoordinator('cancel-test', (view) =>
      views.push(view),
    );
    const cancelPending = vi.fn();
    const internals = coordinator as unknown as {
      displayedCandidate: LocationRecommendationCandidate | null;
      client: { cancelPending: typeof cancelPending };
      cancelMarkers: Map<string, unknown>;
    };
    internals.displayedCandidate = candidate;
    internals.client = { cancelPending };
    let markerAtRequest: Record<string, unknown> | null = null;
    vi.mocked(cancelLocationRecommendation).mockImplementation(async () => {
      const key = Array.from({ length: window.localStorage.length }, (_, index) =>
        window.localStorage.key(index),
      ).find((item) => item?.startsWith(LOCATION_RECOMMENDATION_BRIDGE_PREFIX));
      markerAtRequest = key
        ? (JSON.parse(window.localStorage.getItem(key) ?? 'null') as Record<string, unknown>)
        : null;
      throw new Error('network unavailable');
    });

    coordinator.cancelCurrent();

    expect(views.at(-1)?.candidate).toBeNull();
    expect(cancelPending).toHaveBeenCalledOnce();
    expect(markerAtRequest).toMatchObject({
      targetRequestId: requestId,
      scopeGeneration,
    });
    expect(markerAtRequest).not.toHaveProperty('latitude');
    expect(markerAtRequest).not.toHaveProperty('longitude');
    expect(cancelLocationRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({ requestId }),
      expect.any(AbortSignal),
    );
    const key = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    ).find((item) => item?.startsWith(LOCATION_RECOMMENDATION_BRIDGE_PREFIX));
    expect(key).toBeTruthy();

    const recreatedViews: Array<{ candidate: LocationRecommendationCandidate | null }> = [];
    const recreatedCoordinator = new LocationRecommendationCoordinator('cancel-test', (view) =>
      recreatedViews.push(view),
    );
    const requestDisplayGrant = vi.fn();
    const recreatedInternals = recreatedCoordinator as unknown as {
      cancelMarkers: Map<string, unknown>;
      currentAccessEventId: string | null;
      currentOperationUUID: string | null;
      isActive: boolean;
      isMapEligible: boolean;
      isMapRoute: boolean;
      serviceRoute: boolean;
      started: boolean;
      client: { tabId: string; requestDisplayGrant: typeof requestDisplayGrant };
      handleWorkerState: (state: LocationRecommendationState, isInitial: boolean) => void;
      displayedCandidate: LocationRecommendationCandidate | null;
      reconcilePendingMarkers: () => Promise<void>;
    };
    const retryReadyCandidate = {
      ...candidate,
      authEpoch: 'cancel-test',
      sourceWorkerInstanceId: 'recreated-worker',
      sourceStateRevision: 1,
      receivedAt: Date.now(),
    };
    const retryReadyState: LocationRecommendationState = {
      authEpoch: 'cancel-test',
      workerInstanceId: 'recreated-worker',
      stateRevision: 1,
      activeTabId: grant.tabId,
      leaderEpoch: grant.leaderEpoch,
      accessEventId: grant.accessEventId,
      operationUUID: grant.operationUUID,
      accessSequence: candidate.accessSequence,
      phase: 'REQUEST_SENT',
      status: 'READY',
      requestId: candidate.requestId,
      region: candidate.region,
      tracks: candidate.tracks,
      scopeGeneration: candidate.scopeGeneration,
      cancelEpoch: candidate.cancelEpoch,
      remainingTtlMs: candidate.remainingTtlMs,
      displayGrantedTabId: null,
      cancelMarker: null,
      candidate: retryReadyCandidate,
    };
    recreatedInternals.currentAccessEventId = grant.accessEventId;
    recreatedInternals.currentOperationUUID = grant.operationUUID;
    recreatedInternals.isActive = true;
    recreatedInternals.isMapEligible = true;
    recreatedInternals.isMapRoute = true;
    recreatedInternals.serviceRoute = true;
    recreatedInternals.started = true;
    recreatedInternals.client = { tabId: grant.tabId, requestDisplayGrant };

    expect(recreatedInternals.cancelMarkers.size).toBe(1);
    expect(retryReadyCandidate.operationUUID).toBe(candidate.operationUUID);
    expect(retryReadyCandidate.requestId).toBe(candidate.requestId);
    expect(retryReadyCandidate.tracks).toEqual(candidate.tracks);
    recreatedInternals.handleWorkerState(retryReadyState, false);
    await Promise.resolve();

    expect(recreatedInternals.displayedCandidate).toBeNull();
    expect(recreatedViews.at(-1)?.candidate).toBeNull();
    expect(getLocationRecommendationStatus).not.toHaveBeenCalled();
    expect(claimLocationRecommendationDisplay).not.toHaveBeenCalled();
    expect(requestDisplayGrant).not.toHaveBeenCalled();

    const persistedMarker = key
      ? (JSON.parse(window.localStorage.getItem(key) ?? 'null') as Record<string, unknown>)
      : null;
    expect(persistedMarker).toBeTruthy();
    vi.mocked(cancelLocationRecommendation).mockResolvedValue({
      status: 'CANCELLED',
      scopeGeneration,
      cancelEpoch: 3,
    });
    vi.mocked(getLocationRecommendationContext)
      .mockResolvedValueOnce({
        scopeGeneration,
        cancelEpoch: 2,
        kstDate: '2026-10-31',
        activeRequestId: null,
      })
      .mockResolvedValueOnce({
        scopeGeneration,
        cancelEpoch: 3,
        kstDate: '2026-10-31',
        activeRequestId: null,
      });
    await recreatedInternals.reconcilePendingMarkers();

    expect(cancelLocationRecommendation).toHaveBeenCalledTimes(2);
    expect(cancelLocationRecommendation.mock.calls[1][0]).toEqual(
      cancelLocationRecommendation.mock.calls[0][0],
    );
    expect(cancelLocationRecommendation.mock.calls[1][0]).toMatchObject({
      requestId,
      scopeGeneration,
      cancelEpoch: candidate.cancelEpoch,
      cancellationUUID: persistedMarker?.cancellationUUID,
    });
    if (key) window.localStorage.removeItem(key);
  });

  it('accepts a canonical request ID only while recovering the original operation UUID', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const context = {
      scopeGeneration,
      cancelEpoch: 2,
      kstDate: '2026-10-31',
      activeRequestId: null,
    };
    vi.mocked(getLocationRecommendationContext).mockResolvedValue(context);
    const processing = {
      requestId,
      status: 'PROCESSING' as const,
      reason: null,
      region: candidate.region,
      tracks: [],
      scopeGeneration,
      cancelEpoch: 2,
      remainingTtlMs: 0,
    };
    const ready = {
      ...processing,
      status: 'READY' as const,
      tracks: candidate.tracks,
      remainingTtlMs: 60_000,
    };
    vi.mocked(getLocationRecommendationStatus)
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(ready);
    const coordinator = new LocationRecommendationCoordinator('auth-epoch', () => undefined);
    const updateResult = vi.fn();
    const internals = coordinator as unknown as {
      activeGrant: WorkerGrant | null;
      currentAccessEventId: string | null;
      currentOperationUUID: string | null;
      isActive: boolean;
      isMapRoute: boolean;
      serviceRoute: boolean;
      started: boolean;
      recoverRequest: (
        recoveryGrant: WorkerGrant,
        client: { updateResult: typeof updateResult },
        requestId: string,
      ) => Promise<void>;
    };
    internals.activeGrant = grant;
    internals.currentAccessEventId = grant.accessEventId;
    internals.currentOperationUUID = grant.operationUUID;
    internals.isActive = true;
    internals.isMapRoute = true;
    internals.serviceRoute = true;
    internals.started = true;

    const recovery = internals.recoverRequest(grant, { updateResult }, grant.operationUUID);
    await vi.advanceTimersByTimeAsync(LOCATION_RECOMMENDATION_STATUS_INTERVAL_MS);
    await recovery;

    expect(getLocationRecommendationStatus.mock.calls.map(([id]) => id)).toEqual([
      grant.operationUUID,
      requestId,
    ]);
    expect(updateResult).toHaveBeenCalledWith(grant, grant.operationUUID, ready);
  });

  it('sends scoped cleanup when recovering a PROCESSING request reaches the FE deadline', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.mocked(getLocationRecommendationContext).mockResolvedValue({
      scopeGeneration,
      cancelEpoch: 2,
      kstDate: '2026-10-31',
      activeRequestId: requestId,
    });
    vi.mocked(getLocationRecommendationStatus).mockResolvedValue({
      requestId,
      status: 'PROCESSING',
      reason: null,
      region: candidate.region,
      tracks: [],
      scopeGeneration,
      cancelEpoch: 2,
      remainingTtlMs: 0,
    });
    vi.mocked(cancelLocationRecommendation).mockResolvedValue(undefined);
    const coordinator = new LocationRecommendationCoordinator('auth-epoch', () => undefined);
    const internals = coordinator as unknown as {
      activeGrant: WorkerGrant | null;
      currentAccessEventId: string | null;
      currentOperationUUID: string | null;
      isActive: boolean;
      started: boolean;
      recoverRequest: (
        recoveryGrant: WorkerGrant,
        client: { updateResult: ReturnType<typeof vi.fn> },
        requestId: string,
      ) => Promise<void>;
      waitForTerminalStatus: ReturnType<typeof vi.fn>;
    };
    internals.activeGrant = grant;
    internals.currentAccessEventId = grant.accessEventId;
    internals.currentOperationUUID = grant.operationUUID;
    internals.isActive = true;
    internals.started = true;
    internals.waitForTerminalStatus = vi
      .fn()
      .mockRejectedValue(new LocationRecommendationTimeoutError());

    await internals.recoverRequest(grant, { updateResult: vi.fn() }, grant.operationUUID);

    expect(cancelLocationRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId,
        scopeGeneration,
        cancelEpoch: 2,
      }),
    );
    expect(cancelLocationRecommendation).toHaveBeenCalledOnce();
  });

  it('does not cancel a request when only the initial recovery status check times out', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.mocked(getLocationRecommendationContext).mockResolvedValue({
      scopeGeneration,
      cancelEpoch: 2,
      kstDate: '2026-10-31',
      activeRequestId: requestId,
    });
    vi.mocked(getLocationRecommendationStatus).mockRejectedValue(
      new LocationRecommendationTimeoutError(),
    );
    const coordinator = new LocationRecommendationCoordinator('auth-epoch', () => undefined);
    const internals = coordinator as unknown as {
      activeGrant: WorkerGrant | null;
      currentAccessEventId: string | null;
      currentOperationUUID: string | null;
      isActive: boolean;
      started: boolean;
      recoverRequest: (
        recoveryGrant: WorkerGrant,
        client: { updateResult: ReturnType<typeof vi.fn> },
        requestId: string,
      ) => Promise<void>;
    };
    internals.activeGrant = grant;
    internals.currentAccessEventId = grant.accessEventId;
    internals.currentOperationUUID = grant.operationUUID;
    internals.isActive = true;
    internals.started = true;

    await internals.recoverRequest(grant, { updateResult: vi.fn() }, grant.operationUUID);

    expect(cancelLocationRecommendation).not.toHaveBeenCalled();
  });

  it.each(['status', 'context'] as const)(
    'fails closed when the %s verification request times out',
    async (stage) => {
      vi.useFakeTimers();
      const coordinator = new LocationRecommendationCoordinator('auth-epoch', () => undefined);
      const result = {
        requestId,
        status: 'READY' as const,
        reason: null,
        region: candidate.region,
        tracks: candidate.tracks,
        scopeGeneration,
        cancelEpoch: 2,
        remainingTtlMs: 60_000,
      };
      vi.mocked(getLocationRecommendationStatus).mockImplementation((_, signal) =>
        stage === 'status'
          ? new Promise((_, reject) => {
              signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
            })
          : Promise.resolve(result),
      );
      vi.mocked(getLocationRecommendationContext).mockImplementation((signal) =>
        stage === 'context'
          ? new Promise((_, reject) => {
              signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
            })
          : Promise.resolve({
              scopeGeneration,
              cancelEpoch: 2,
              kstDate: '2026-10-31',
              activeRequestId: null,
            }),
      );

      const verification = coordinator.verifyStatus(candidate, true);
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(verification).resolves.toBe(false);
    },
  );

  it('discards a late GPS callback after the access grant changes', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const context = {
      scopeGeneration,
      cancelEpoch: 2,
      kstDate: '2026-10-31',
      activeRequestId: null,
    };
    vi.mocked(getLocationRecommendationContext).mockResolvedValue(context);
    const nextGrant: WorkerGrant = { ...grant, leaderEpoch: grant.leaderEpoch + 1 };
    const testCoordinator = new LocationRecommendationCoordinator('auth-epoch', () => undefined);
    const internals = testCoordinator as unknown as {
      activeGrant: WorkerGrant | null;
      currentAccessEventId: string | null;
      currentOperationUUID: string | null;
      cachedSample: unknown;
      isActive: boolean;
      isMapRoute: boolean;
      started: boolean;
      runAccessUnderLock: (
        accessGrant: WorkerGrant,
        workerClient: {
          setPhase: ReturnType<typeof vi.fn>;
          validateGrant: ReturnType<typeof vi.fn>;
        },
      ) => Promise<void>;
    };
    internals.activeGrant = grant;
    internals.currentAccessEventId = grant.accessEventId;
    internals.currentOperationUUID = grant.operationUUID;
    internals.isActive = true;
    internals.isMapRoute = true;
    internals.started = true;
    const workerClient = {
      setPhase: vi.fn(),
      validateGrant: vi.fn().mockResolvedValue(true),
    };
    const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    const originalPermissions = Object.getOwnPropertyDescriptor(navigator, 'permissions');
    let onSuccess: PositionCallback | undefined;
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      onSuccess = success;
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn().mockResolvedValue({ state: 'granted' }) },
    });

    try {
      const access = internals.runAccessUnderLock(grant, workerClient);
      await vi.waitFor(() => expect(getCurrentPosition).toHaveBeenCalledOnce());
      internals.activeGrant = nextGrant;
      internals.currentAccessEventId = '723e4567-e89b-42d3-a456-426614174006';
      internals.currentOperationUUID = '823e4567-e89b-42d3-a456-426614174007';
      onSuccess?.({
        coords: { latitude: 37.5, longitude: 127, accuracy: 10 } as GeolocationCoordinates,
        timestamp: Date.now(),
      } as GeolocationPosition);
      await access;

      expect(internals.cachedSample).toBeNull();
      expect(workerClient.setPhase).not.toHaveBeenCalledWith(grant, 'SAMPLED');
      expect(workerClient.validateGrant).not.toHaveBeenCalled();
      expect(createLocationRecommendation).not.toHaveBeenCalled();
    } finally {
      if (originalGeolocation) {
        Object.defineProperty(navigator, 'geolocation', originalGeolocation);
      } else {
        Reflect.deleteProperty(navigator, 'geolocation');
      }
      if (originalPermissions) {
        Object.defineProperty(navigator, 'permissions', originalPermissions);
      } else {
        Reflect.deleteProperty(navigator, 'permissions');
      }
    }
  });
});
