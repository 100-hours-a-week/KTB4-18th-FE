import { createContext, useContext, useLayoutEffect } from 'react';
import { ACCESS_TOKEN_CHANGED_EVENT } from '../auth-login/api/authSession';
import {
  cancelLocationRecommendation,
  claimLocationRecommendationDisplay,
  createLocationRecommendation,
  getLocationRecommendationContext,
  getLocationRecommendationStatus,
  LocationRecommendationApiError,
  LocationRecommendationTimeoutError,
} from './api/locationRecommendationApi';
import {
  LocationRecommendationWorkerClient,
  supportsLocationRecommendationPrimitives,
} from './locationRecommendationWorkerClient';
import {
  LOCATION_RECOMMENDATION_BRIDGE_PREFIX,
  LOCATION_RECOMMENDATION_FE_TIMEOUT_MS,
  LOCATION_RECOMMENDATION_STATUS_INTERVAL_MS,
  LOCATION_RECOMMENDATION_WEB_LOCK,
  type LocationRecommendationCandidate,
  type LocationRecommendationCancelMarker,
  type LocationRecommendationContext,
  type LocationRecommendationResult,
  type LocationRecommendationState,
  type WorkerGrant,
} from './locationRecommendationTypes';

const NOTICE_ACK_KEY = 'meomuneum.location-recommendation.notice-ack';
const NOTICE_ACK_REVISION = 'v4';
const CANCEL_EVENT_NAME = 'meomuneum:location-recommendation:cancel';
const TIMEOUT_CLEANUP_PREFIX = 'meomuneum.location-recommendation.timeout-cleanup:';
const ACCESS_SEQUENCE_KEY_PREFIX = 'meomuneum.location-recommendation.access-sequence.v1:';
const ACCESS_CONTEXT_TIMEOUT_MS = 10_000;
const STATUS_CHECK_TIMEOUT_MS = 5_000;
let documentTabId: string | null = null;

export function isLocalLocationRecommendationTestHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export type CoordinatorView = {
  noticeOpen: boolean;
  candidate: LocationRecommendationCandidate | null;
};

export type LocationRecommendationRuntimeStatus = {
  permission: PermissionState | 'not-read' | 'unsupported';
  mapRoute: boolean;
  mapReady: boolean;
  serviceRoute: boolean;
  tabActive: boolean;
  noticeAcknowledged: boolean;
  coordinatorStarted: boolean;
  disabled: boolean;
  authorizationPaused: boolean;
  workerStatus: LocationRecommendationState['status'] | 'not-connected';
  workerPhase: LocationRecommendationState['phase'] | null;
  popupVisible: boolean;
  waitingFor: string | null;
};

type LocationSample = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  sampledAt: number;
};

type CachedSample = {
  sample: LocationSample;
  context: LocationRecommendationContext;
};

export type CoordinatorContextValue = {
  setAuthenticated: (isAuthenticated: boolean) => void;
};

export const CoordinatorContext = createContext<CoordinatorContextValue>({
  setAuthenticated: () => undefined,
});

export type LocationRecommendationViewContextValue = {
  reportMapState: (isMapRoute: boolean, isMapReady: boolean) => void;
};

export const LocationRecommendationViewContext =
  createContext<LocationRecommendationViewContextValue>({
    reportMapState: () => undefined,
  });

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export function isValidLocationSample(sample: LocationSample): boolean {
  return (
    Number.isFinite(sample.latitude) &&
    sample.latitude >= -90 &&
    sample.latitude <= 90 &&
    Number.isFinite(sample.longitude) &&
    sample.longitude >= -180 &&
    sample.longitude <= 180 &&
    Number.isFinite(sample.accuracyMeters) &&
    sample.accuracyMeters >= 0 &&
    sample.accuracyMeters <= 300 &&
    getLocationSampleAgeMs(sample.sampledAt) !== null
  );
}

export function getLocationSampleAgeMs(sampledAt: number, now = Date.now()): number | null {
  const ageMs = now - sampledAt;
  if (
    !Number.isFinite(sampledAt) ||
    !Number.isFinite(now) ||
    !Number.isFinite(ageMs) ||
    ageMs < 0 ||
    ageMs > 30_000
  ) {
    return null;
  }
  return Math.floor(ageMs);
}

export function isPersistedPageReentry(
  event: Pick<PageTransitionEvent, 'persisted'>,
  wasActive: boolean,
): boolean {
  return event.persisted && wasActive;
}

export async function withValidatedAccessLock(
  locks: Pick<LockManager, 'request'>,
  grant: WorkerGrant,
  validateGrant: (grant: WorkerGrant) => Promise<boolean>,
  isStillCurrent: () => boolean,
  onGranted: () => Promise<void>,
  reserveAccessEvent: () => Promise<boolean> = async () => true,
): Promise<boolean> {
  try {
    return await locks.request(
      LOCATION_RECOMMENDATION_WEB_LOCK,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (!lock || !isStillCurrent()) return false;
        if (!(await reserveAccessEvent()) || !isStillCurrent()) return false;
        if (!(await validateGrant(grant)) || !isStillCurrent()) return false;
        await onGranted();
        return true;
      },
    );
  } catch {
    return false;
  }
}

export function reserveAccessSequence(authEpoch: string): number {
  const key = `${ACCESS_SEQUENCE_KEY_PREFIX}${authEpoch}`;
  const stored = window.localStorage.getItem(key);
  const previous = stored === null ? 0 : Number(stored);
  if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER) {
    throw new Error('access-sequence-unavailable');
  }
  const sequence = previous + 1;
  window.localStorage.setItem(key, String(sequence));
  if (window.localStorage.getItem(key) !== String(sequence)) {
    throw new Error('access-sequence-unavailable');
  }
  return sequence;
}

export function getLocationSample(
  geolocation: Pick<Geolocation, 'getCurrentPosition'>,
  signal?: AbortSignal,
): Promise<LocationSample> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    geolocation.getCurrentPosition(
      (position) => {
        if (signal?.aborted) {
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          return;
        }
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          sampledAt: position.timestamp,
        });
      },
      reject,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
    );
  });
}

function waitForDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function createDeadlineSignal(source: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abortFromSource = () => controller.abort(source?.reason);
  source?.addEventListener('abort', abortFromSource, { once: true });
  if (source?.aborted) abortFromSource();
  const timer = window.setTimeout(
    () => controller.abort(new LocationRecommendationTimeoutError()),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose: () => {
      window.clearTimeout(timer);
      source?.removeEventListener('abort', abortFromSource);
    },
  };
}

function getTabId(): string {
  documentTabId ??= crypto.randomUUID();
  return documentTabId;
}

function readNoticeAcknowledgement(): boolean {
  try {
    return window.localStorage.getItem(NOTICE_ACK_KEY) === NOTICE_ACK_REVISION;
  } catch {
    return false;
  }
}

function markerStorageKey(marker: LocationRecommendationCancelMarker): string {
  return `${LOCATION_RECOMMENDATION_BRIDGE_PREFIX}${marker.authEpoch}:${marker.scopeGeneration}:${marker.cancellationUUID}`;
}

function timeoutCleanupStorageKey(marker: LocationRecommendationCancelMarker): string {
  return `${TIMEOUT_CLEANUP_PREFIX}${marker.authEpoch}:${marker.cancellationUUID}`;
}

function parseCancelMarker(value: unknown): LocationRecommendationCancelMarker | null {
  if (!value || typeof value !== 'object') return null;
  const marker = value as Record<string, unknown>;
  if (
    typeof marker.authEpoch !== 'string' ||
    !isUuid(marker.scopeGeneration) ||
    !isUuid(marker.cancellationUUID) ||
    !isUuid(marker.targetRequestId) ||
    !Number.isSafeInteger(marker.expectedCancelEpoch) ||
    !Number.isFinite(marker.createdAt)
  ) {
    return null;
  }
  return {
    authEpoch: marker.authEpoch,
    scopeGeneration: marker.scopeGeneration,
    cancellationUUID: marker.cancellationUUID,
    targetRequestId: marker.targetRequestId,
    expectedCancelEpoch: marker.expectedCancelEpoch as number,
    createdAt: marker.createdAt as number,
    resultCancelEpoch: Number.isSafeInteger(marker.resultCancelEpoch)
      ? (marker.resultCancelEpoch as number)
      : undefined,
  };
}

function readCancelMarkers(authEpoch: string): LocationRecommendationCancelMarker[] {
  const markers: LocationRecommendationCancelMarker[] = [];
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(LOCATION_RECOMMENDATION_BRIDGE_PREFIX)) continue;
      const marker = parseCancelMarker(JSON.parse(storage.getItem(key) ?? 'null'));
      if (marker?.authEpoch === authEpoch) markers.push(marker);
    }
  } catch {
    return markers;
  }
  return markers;
}

export class LocationRecommendationCoordinator {
  private client: LocationRecommendationWorkerClient | null = null;
  private started = false;
  private isActive = false;
  private lastActive = false;
  private serviceRoute = true;
  private isMapRoute = false;
  private mapEligibilityRevision = 0;
  private isMapEligible = false;
  private hasEnteredReadyMap = false;
  private dismissedForActivation = false;
  private noticeAcknowledged = readNoticeAcknowledgement();
  private noticeOpen = false;
  private currentAccessEventId: string | null = null;
  private currentOperationUUID: string | null = null;
  private currentTrigger: 'SESSION_START' | 'RESUME' = 'SESSION_START';
  private activeGrant: WorkerGrant | null = null;
  private currentState: LocationRecommendationState | null = null;
  private hasReceivedWorkerState = false;
  private waitingForWorkerState = false;
  private displayedCandidate: LocationRecommendationCandidate | null = null;
  private cachedSample: CachedSample | null = null;
  private accessContextController: AbortController | null = null;
  private readonly requestControllers = new Map<string, AbortController>();
  private readonly cancelMarkers = new Map<string, LocationRecommendationCancelMarker>();
  private readonly timeoutCleanupMarkers = new Map<string, LocationRecommendationCancelMarker>();
  private readonly durableMarkerIds = new Set<string>();
  private locationPermissionStatus: PermissionStatus | null = null;
  private transitionCount = 0;
  private heartbeatTimer: number | null = null;
  private activityCheckQueued = false;
  private isDisabled = false;
  private authorizationPaused = false;
  readonly authEpoch: string;
  private readonly onChange: (view: CoordinatorView) => void;

  constructor(authEpoch: string, onChange: (view: CoordinatorView) => void) {
    this.authEpoch = authEpoch;
    this.onChange = onChange;
    this.loadStoredCancelMarkers();
    this.loadStoredTimeoutCleanupMarkers();
  }


  async readRuntimeStatus(): Promise<LocationRecommendationRuntimeStatus> {
    let permission: LocationRecommendationRuntimeStatus['permission'] = 'unsupported';
    try {
      const permissionStatus = await navigator.permissions?.query({ name: 'geolocation' });
      if (permissionStatus) {
        permission = permissionStatus.state;
        if (permissionStatus !== this.locationPermissionStatus) {
          this.locationPermissionStatus?.removeEventListener(
            'change',
            this.handleLocationPermissionChange,
          );
          this.locationPermissionStatus = permissionStatus;
          permissionStatus.addEventListener('change', this.handleLocationPermissionChange);
        }
      }
    } catch {
      permission = 'unsupported';
    }

    const tabActive = this.isActuallyActive();
    const state = this.currentState;
    const waitingFor = !this.started
      ? 'COORDINATOR_NOT_STARTED'
      : this.isDisabled
        ? 'RECOMMENDATION_UNAVAILABLE'
        : this.authorizationPaused
          ? 'AUTHORIZATION_REQUIRED'
          : !this.serviceRoute
            ? 'SERVICE_ROUTE_REQUIRED'
            : !this.isMapRoute
              ? 'MAP_ROUTE_REQUIRED'
              : !this.isMapEligible
                ? 'MAP_NOT_READY'
                : !tabActive
                  ? 'SERVICE_TAB_NOT_ACTIVE'
                  : !this.noticeAcknowledged
                    ? 'LOCATION_NOTICE_REQUIRED'
                    : permission === 'denied'
                      ? 'LOCATION_PERMISSION_DENIED'
                      : !this.hasReceivedWorkerState
                        ? 'WORKER_STATE_PENDING'
                        : state?.status === 'READY'
                          ? null
                          : state?.status === 'PROCESSING'
                            ? 'AI_REQUEST_PROCESSING'
                            : state?.status === 'EMPTY'
                              ? 'NO_RECOMMENDATION_TRACKS'
                              : state?.status === 'FAILED'
                                ? 'RECOMMENDATION_FAILED'
                                : state?.status
                                  ? `REQUEST_${state.status}`
                                  : state?.phase && state.phase !== 'NOT_STARTED'
                                    ? state.phase
                                    : 'READY_TO_REQUEST';

    return {
      permission,
      mapRoute: this.isMapRoute,
      mapReady: this.isMapEligible,
      serviceRoute: this.serviceRoute,
      tabActive,
      noticeAcknowledged: this.noticeAcknowledged,
      coordinatorStarted: this.started,
      disabled: this.isDisabled,
      authorizationPaused: this.authorizationPaused,
      workerStatus: state?.status ?? 'not-connected',
      workerPhase: state?.phase ?? null,
      popupVisible: this.displayedCandidate !== null,
      waitingFor,
    };
  }


  start(): void {
    if (this.started || this.isDisabled) return;
    this.started = true;
    if (!supportsLocationRecommendationPrimitives()) {
      this.disable('required-browser-primitive-unavailable');
      return;
    }
    const tabId = getTabId();
    this.client = new LocationRecommendationWorkerClient(tabId, this.authEpoch, {
      onState: (state) => this.handleWorkerState(state),
      onGrant: (grant) => {
        this.activeGrant = grant;
      },
      onGrantRevoked: (grant) => this.handleGrantRevoked(grant),
      onDisabled: (reason) => this.disable(reason),
      onBridgeStatus: (compatible) => {
        if (!compatible) this.displayedCandidate = null;
      },
    });
    if (!this.client.connect()) {
      this.disable('shared-worker-unavailable');
      return;
    }
    this.client.setMapEligibility(this.isMapEligible, this.isMapRoute, this.mapEligibilityRevision);
    this.cancelMarkers.forEach((marker) => this.client?.cancelPending(marker));
    this.timeoutCleanupMarkers.forEach((marker) => void this.sendTimeoutCancellation(marker));
    window.addEventListener('focus', this.scheduleActivityCheck);
    window.addEventListener('blur', this.scheduleActivityCheck);
    window.addEventListener('pageshow', this.handlePageShow);
    window.addEventListener('pagehide', this.handlePageHide);
    window.addEventListener('storage', this.handleStorageEvent);
    window.addEventListener(ACCESS_TOKEN_CHANGED_EVENT, this.handleAuthorizationChange);
    document.addEventListener('visibilitychange', this.scheduleActivityCheck);
    this.heartbeatTimer = window.setInterval(() => {
      if (this.client) this.client.heartbeat(this.activeGrant?.leaderEpoch ?? 0);
    }, 5_000);
    this.scheduleActivityCheck();
    this.publishView();
  }

  stop(resetAuth: boolean, preserveLogicalActivity: boolean): void {
    if (!this.started && !this.client) return;
    this.started = false;
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    window.removeEventListener('focus', this.scheduleActivityCheck);
    window.removeEventListener('blur', this.scheduleActivityCheck);
    window.removeEventListener('pageshow', this.handlePageShow);
    window.removeEventListener('pagehide', this.handlePageHide);
    window.removeEventListener('storage', this.handleStorageEvent);
    window.removeEventListener(ACCESS_TOKEN_CHANGED_EVENT, this.handleAuthorizationChange);
    document.removeEventListener('visibilitychange', this.scheduleActivityCheck);
    this.locationPermissionStatus?.removeEventListener(
      'change',
      this.handleLocationPermissionChange,
    );
    this.locationPermissionStatus = null;
    this.currentState = null;
    this.hasReceivedWorkerState = false;
    this.waitingForWorkerState = false;
    if (resetAuth) {
      this.client?.resetAuth();
      this.requestControllers.forEach((controller) => controller.abort());
      this.requestControllers.clear();
      this.isActive = false;
      this.lastActive = false;
      this.currentAccessEventId = null;
      this.currentOperationUUID = null;
      this.activeGrant = null;
      this.cachedSample = null;
      this.accessContextController?.abort();
      this.accessContextController = null;
      this.abortCurrentRequest();
      this.cancelMarkers.clear();
      this.durableMarkerIds.clear();
    } else {
      this.client?.deactivate();
      if (!preserveLogicalActivity) {
        this.isActive = false;
        this.lastActive = false;
        this.activeGrant = null;
        this.abortCurrentRequest();
      }
    }
    this.client?.close();
    this.client = null;
    if (resetAuth) this.displayedCandidate = null;
    this.noticeOpen = false;
    this.publishView();
  }

  setMapState(isMapRoute: boolean, isMapReady: boolean): void {
    const previousMapRoute = this.isMapRoute;
    const wasMapEligible = this.isMapEligible;
    const nextEligible = isMapRoute && isMapReady;
    const hasChanged = this.isMapEligible !== nextEligible;
    this.isMapRoute = isMapRoute;
    this.isMapEligible = nextEligible;
    if (hasChanged) this.mapEligibilityRevision += 1;
    this.client?.setMapEligibility(
      this.isMapEligible,
      this.isMapRoute,
      this.mapEligibilityRevision,
    );
    if (nextEligible) {
      const accessEventBeforeMapReady = this.currentAccessEventId;
      if (!wasMapEligible) this.startMapAccessIfReady(true);
      if (
        !wasMapEligible &&
        this.hasEnteredReadyMap &&
        this.hasReceivedWorkerState &&
        isLocalLocationRecommendationTestHost(window.location.hostname) &&
        this.isActuallyActive() &&
        this.currentAccessEventId === accessEventBeforeMapReady
      ) {
        this.beginAccessEvent();
      }
      this.hasEnteredReadyMap = true;
    }
    if (this.isMapEligible) void this.tryDisplayCandidate();
    if (previousMapRoute !== isMapRoute) this.scheduleActivityCheck();
  }

  handleMapPageEntry(): void {
    if (!this.started || !this.serviceRoute || !this.isMapRoute || !this.isMapEligible) return;
    if (this.currentState?.status === 'PROCESSING') return;
    if (!this.isActive) {
      this.scheduleActivityCheck();
      return;
    }
    this.startMapAccessIfReady(true);
  }

  acknowledgeNotice(): void {
    try {
      window.localStorage.setItem(NOTICE_ACK_KEY, NOTICE_ACK_REVISION);
      this.noticeAcknowledged = readNoticeAcknowledgement();
    } catch {
      this.noticeAcknowledged = false;
    }
    if (!this.noticeAcknowledged) return;
    this.noticeOpen = false;
    this.publishView();
    if (this.isActive && !this.dismissedForActivation) this.beginAccessEvent();
  }

  dismissNotice(): void {
    this.noticeOpen = false;
    this.dismissedForActivation = true;
    this.publishView();
  }

  cancelCurrent(): void {
    const candidate = this.displayedCandidate ?? this.currentState?.candidate ?? null;
    if (!candidate) {
      this.dismissDialog();
      return;
    }
    const marker: LocationRecommendationCancelMarker = {
      authEpoch: this.authEpoch,
      scopeGeneration: candidate.scopeGeneration,
      cancellationUUID: crypto.randomUUID(),
      targetRequestId: candidate.requestId,
      expectedCancelEpoch: candidate.cancelEpoch,
      createdAt: Date.now(),
    };
    this.applyLocalCancel(marker);
    this.persistCancelMarker(marker);
    void this.sendCancellation(marker);
  }

  dismissDialog(): void {
    this.displayedCandidate = null;
    this.publishView();
  }

  refreshLocalRecommendation(): void {
    if (
      !isLocalLocationRecommendationTestHost(window.location.hostname) ||
      !this.displayedCandidate ||
      !this.isMapRoute ||
      !this.isMapEligible ||
      !this.isActuallyActive()
    ) {
      return;
    }
    this.dismissDialog();
    this.beginAccessEvent('RESUME');
  }

  async verifyStatus(
    candidate: LocationRecommendationCandidate,
    verifyContext = false,
  ): Promise<boolean> {
    if (this.hasPendingCancellation(candidate)) return false;
    const deadline = createDeadlineSignal(undefined, STATUS_CHECK_TIMEOUT_MS);
    try {
      const result = await getLocationRecommendationStatus(candidate.requestId, deadline.signal);
      if (
        result.requestId !== candidate.requestId ||
        result.status !== 'READY' ||
        result.region?.code !== candidate.region.code ||
        result.scopeGeneration !== candidate.scopeGeneration ||
        result.cancelEpoch !== candidate.cancelEpoch ||
        !result.tracks?.length
      ) {
        return false;
      }
      if (verifyContext) {
        const context = await getLocationRecommendationContext(deadline.signal);
        await this.reconcileMarkers(context);
        if (
          context.scopeGeneration !== candidate.scopeGeneration ||
          context.cancelEpoch !== candidate.cancelEpoch ||
          this.hasPendingCancellation(candidate)
        ) {
          return false;
        }
      }
      return true;
    } catch (caught) {
      this.pauseAfterAuthorizationFailure(caught);
      return false;
    } finally {
      deadline.dispose();
    }
  }

  private loadStoredCancelMarkers(): void {
    readCancelMarkers(this.authEpoch).forEach((marker) => {
      this.cancelMarkers.set(marker.cancellationUUID, marker);
      this.durableMarkerIds.add(marker.cancellationUUID);
    });
  }

  private loadStoredTimeoutCleanupMarkers(): void {
    try {
      const storage = window.localStorage;
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(TIMEOUT_CLEANUP_PREFIX)) continue;
        const marker = parseCancelMarker(JSON.parse(storage.getItem(key) ?? 'null'));
        if (marker?.authEpoch === this.authEpoch) {
          this.timeoutCleanupMarkers.set(marker.cancellationUUID, marker);
        }
      }
    } catch {
      // Request-scoped cleanup can still proceed in memory.
    }
  }

  private publishView(): void {
    this.onChange({ noticeOpen: this.noticeOpen, candidate: this.displayedCandidate });
  }

  private disable(reason: string): void {
    if (this.isDisabled) return;
    this.isDisabled = true;
    this.noticeOpen = false;
    this.displayedCandidate = null;
    this.requestControllers.forEach((controller) => controller.abort());
    this.requestControllers.clear();
    this.client?.deactivate();
    this.publishView();
    if (reason === 'worker-communication-failed') this.client?.close();
  }

  private readonly scheduleActivityCheck = () => {
    if (this.activityCheckQueued) return;
    this.activityCheckQueued = true;
    queueMicrotask(() => {
      this.activityCheckQueued = false;
      if (!this.started) return;
      this.checkActivity();
    });
  };

  private readonly handleAuthorizationChange = () => {
    if (!this.authorizationPaused) return;
    this.authorizationPaused = false;
    this.currentAccessEventId = null;
    this.currentOperationUUID = null;
    this.scheduleActivityCheck();
  };

  private readonly handleLocationPermissionChange = () => {
    const permissionState = this.locationPermissionStatus?.state;
    if (permissionState === 'denied') {
      const grant = this.activeGrant ?? undefined;
      this.activeGrant = null;
      this.cachedSample = null;
      this.accessContextController?.abort();
      this.accessContextController = null;
      this.abortCurrentRequest();
      this.client?.deactivate(grant);
      return;
    }
    if (
      permissionState !== 'granted' ||
      !this.started ||
      !this.isActuallyActive() ||
      !this.noticeAcknowledged ||
      this.authorizationPaused
    ) {
      return;
    }
    this.beginAccessEvent('RESUME');
  };

  private pauseAfterAuthorizationFailure(caught: unknown): void {
    if (
      !(caught instanceof LocationRecommendationApiError) ||
      (caught.status !== 401 && caught.status !== 403)
    ) {
      return;
    }
    this.authorizationPaused = true;
    this.lastActive = false;
    this.isActive = false;
    const grant = this.activeGrant ?? undefined;
    this.activeGrant = null;
    this.cachedSample = null;
    this.accessContextController?.abort();
    this.accessContextController = null;
    this.requestControllers.forEach((controller) => controller.abort());
    this.requestControllers.clear();
    this.client?.deactivate(grant);
  }

  private readonly handlePageHide = () => {
    if (!this.lastActive) return;
    const grant = this.activeGrant ?? undefined;
    this.lastActive = false;
    this.isActive = false;
    this.activeGrant = null;
    this.noticeOpen = false;
    this.cachedSample = null;
    this.accessContextController?.abort();
    this.accessContextController = null;
    this.abortCurrentRequest();
    this.client?.deactivate(grant);
  };

  private readonly handlePageShow = (event: PageTransitionEvent) => {
    if (isPersistedPageReentry(event, this.lastActive)) {
      const grant = this.activeGrant ?? undefined;
      this.lastActive = false;
      this.isActive = false;
      this.activeGrant = null;
      this.cachedSample = null;
      this.accessContextController?.abort();
      this.accessContextController = null;
      this.abortCurrentRequest();
      this.client?.deactivate(grant);
    }
    this.scheduleActivityCheck();
  };

  private checkActivity(): void {
    const active =
      this.serviceRoute &&
      !this.authorizationPaused &&
      document.visibilityState === 'visible' &&
      typeof document.hasFocus === 'function' &&
      document.hasFocus();
    if (active === this.lastActive) {
      if (active) {
        this.startMapAccessIfReady();
        void this.reconcilePendingMarkers();
      }
      return;
    }
    this.lastActive = active;
    this.isActive = active;
    if (!active) {
      const grant = this.activeGrant ?? undefined;
      this.dismissedForActivation = false;
      this.noticeOpen = false;
      this.activeGrant = null;
      this.cachedSample = null;
      this.accessContextController?.abort();
      this.accessContextController = null;
      this.abortCurrentRequest();
      this.client?.deactivate(grant);
      this.publishView();
      return;
    }
    void this.reconcilePendingMarkers();
    this.timeoutCleanupMarkers.forEach((marker) => void this.sendTimeoutCancellation(marker));
    this.dismissedForActivation = false;
    if (!this.isMapRoute || !this.isMapEligible) return;
    this.startMapAccessIfReady(true);
  }

  private startMapAccessIfReady(forceNewAccessEvent = false): void {
    if (!this.isActuallyActive() || !this.isMapRoute || !this.isMapEligible) return;
    if (!this.noticeAcknowledged) {
      if (this.dismissedForActivation || this.noticeOpen) return;
      this.noticeOpen = true;
      this.publishView();
      return;
    }
    if (!this.hasReceivedWorkerState) {
      this.waitingForWorkerState = true;
      return;
    }
    const state = this.currentState;
    const candidate = state?.candidate;
    if (
      state?.status === 'READY' &&
      candidate &&
      state.accessEventId === this.currentAccessEventId &&
      state.operationUUID === this.currentOperationUUID &&
      state.cancelMarker === null &&
      !this.hasPendingCancellation(candidate)
    ) {
      if (state.displayGrantedTabId === null || state.displayGrantedTabId === this.client?.tabId) {
        void this.tryDisplayCandidate();
      }
      return;
    }
    if (forceNewAccessEvent || this.currentAccessEventId === null) this.beginAccessEvent();
  }

  private beginAccessEvent(trigger?: 'SESSION_START' | 'RESUME'): void {
    if (
      !this.isActive ||
      !this.started ||
      !this.client ||
      this.isDisabled ||
      !this.noticeAcknowledged ||
      !this.isMapRoute ||
      !this.isMapEligible
    ) {
      return;
    }
    this.currentAccessEventId = crypto.randomUUID();
    this.currentOperationUUID = crypto.randomUUID();
    this.cachedSample = null;
    this.accessContextController?.abort();
    this.accessContextController = null;
    this.currentTrigger = trigger ?? (this.transitionCount === 0 ? 'SESSION_START' : 'RESUME');
    this.transitionCount += 1;
    this.publishView();
    void this.acquireLeaderAndStart(this.currentAccessEventId, this.currentOperationUUID);
  }

  private async acquireLeaderAndStart(accessEventId: string, operationUUID: string): Promise<void> {
    const client = this.client;
    if (!client || !(await client.waitForCompatibleBridge())) return;
    if (!this.isCurrentEvent(accessEventId, operationUUID)) return;
    let grant: WorkerGrant;
    try {
      grant = await client.activate(accessEventId, operationUUID);
    } catch (caught) {
      this.pauseAfterAuthorizationFailure(caught);
      return;
    }
    this.activeGrant = grant;
    if (!this.isCurrentEvent(accessEventId, operationUUID) || !this.isActuallyActive()) return;
    const locks = navigator.locks;
    if (!locks?.request) {
      this.activeGrant = null;
      client.deactivate(grant);
      return;
    }
    let accessSequence = 0;
    const didStart = await withValidatedAccessLock(
      locks,
      grant,
      (currentGrant) => client.validateGrant(currentGrant).catch(() => false),
      () => this.isCurrentGrant(grant) && this.isActuallyActive(),
      async () => {
        await this.runAccessUnderLock(grant, client);
      },
      async () => {
        try {
          accessSequence = reserveAccessSequence(this.authEpoch);
          return await client.confirmAccessEvent(grant, accessSequence);
        } catch {
          return false;
        }
      },
    );
    if (!didStart) {
      if (this.activeGrant?.leaderEpoch === grant.leaderEpoch) this.activeGrant = null;
      client.deactivate(grant);
      return;
    }
  }

  private async runAccessUnderLock(
    grant: WorkerGrant,
    client: LocationRecommendationWorkerClient,
  ): Promise<void> {
    const state = this.currentState;
    if (
      state?.accessEventId === grant.accessEventId &&
      state.operationUUID === grant.operationUUID
    ) {
      if (state.phase === 'REQUEST_SENT') {
        void this.recoverRequest(grant, client, state.requestId ?? grant.operationUUID);
        return;
      }
      if (state.phase === 'SAMPLING' || state.phase === 'ABORTED_UNKNOWN') return;
      if (state.phase === 'SAMPLED') {
        const cached = this.cachedSample;
        if (!cached) {
          client.setPhase(grant, 'ABORTED_UNKNOWN');
          return;
        }
        await this.startRequest(grant, cached.sample, cached.context, client);
        return;
      }
    }
    if (!(await this.hasLocationPermission())) return;
    if (!this.isCurrentGrant(grant) || !this.isActuallyActive()) return;
    let context: LocationRecommendationContext;
    const contextController = new AbortController();
    this.accessContextController = contextController;
    const contextDeadline = createDeadlineSignal(
      contextController.signal,
      ACCESS_CONTEXT_TIMEOUT_MS,
    );
    try {
      context = await getLocationRecommendationContext(contextDeadline.signal);
      await this.reconcileMarkers(context);
    } catch (caught) {
      this.pauseAfterAuthorizationFailure(caught);
      return;
    } finally {
      contextDeadline.dispose();
      if (this.accessContextController === contextController) {
        this.accessContextController = null;
      }
    }
    if (!this.isCurrentGrant(grant) || !this.isActuallyActive()) return;
    client.setPhase(grant, 'SAMPLING');
    let sample: LocationSample;
    try {
      const geolocation = navigator.geolocation;
      if (!geolocation) {
        client.setPhase(grant, 'ABORTED_UNKNOWN');
        return;
      }
      sample = await getLocationSample(geolocation);
    } catch {
      client.setPhase(grant, 'ABORTED_UNKNOWN');
      return;
    }
    if (!this.isCurrentGrant(grant) || !this.isActuallyActive()) return;
    if (!isValidLocationSample(sample)) {
      client.setPhase(grant, 'ABORTED_UNKNOWN');
      return;
    }
    const isStillLeader = await client.validateGrant(grant).catch(() => false);
    if (!isStillLeader || !this.isCurrentGrant(grant) || !this.isActuallyActive()) {
      return;
    }
    this.cachedSample = { sample, context };
    client.setPhase(grant, 'SAMPLED');
    await this.startRequest(grant, sample, context, client);
  }

  private async hasLocationPermission(): Promise<boolean> {
    try {
      const permission = await navigator.permissions?.query({ name: 'geolocation' });
      if (!this.started) return false;
      if (permission && permission !== this.locationPermissionStatus) {
        this.locationPermissionStatus?.removeEventListener(
          'change',
          this.handleLocationPermissionChange,
        );
        this.locationPermissionStatus = permission;
        permission.addEventListener('change', this.handleLocationPermissionChange);
      }
      if (permission?.state === 'denied') {
        return false;
      }
    } catch {
      return true;
    }
    return Boolean(navigator.geolocation);
  }

  private async startRequest(
    grant: WorkerGrant,
    sample: LocationSample,
    context: LocationRecommendationContext,
    client: LocationRecommendationWorkerClient,
  ): Promise<void> {
    const sampleAgeMs = getLocationSampleAgeMs(sample.sampledAt);
    if (sampleAgeMs === null || !this.isCurrentGrant(grant) || !this.isActuallyActive()) return;
    const controller = new AbortController();
    this.requestControllers.set(grant.operationUUID, controller);
    const requestStartedAt = performance.now();
    const request = createLocationRecommendation(
      {
        requestId: grant.operationUUID,
        latitude: sample.latitude,
        longitude: sample.longitude,
        accuracyMeters: sample.accuracyMeters,
        sampleAgeMs,
        trigger: this.currentTrigger,
        scopeGeneration: context.scopeGeneration,
        cancelEpoch: context.cancelEpoch,
      },
      controller.signal,
    );
    client.setPhase(grant, 'REQUEST_SENT');
    this.cachedSample = null;
    try {
      const result = await request;
      if (!this.isCurrentGrant(grant) || !this.isActuallyActive()) {
        this.requestControllers.delete(grant.operationUUID);
        return;
      }
      if (
        result.scopeGeneration !== context.scopeGeneration ||
        result.cancelEpoch !== context.cancelEpoch
      ) {
        this.requestControllers.delete(grant.operationUUID);
        return;
      }
      void this.completeRequest(grant, context, Promise.resolve(result), client, requestStartedAt);
    } catch (caught) {
      if (!this.isCurrentGrant(grant) || !this.isActuallyActive()) {
        this.requestControllers.delete(grant.operationUUID);
        return;
      }
      void this.completeRequest(grant, context, Promise.reject(caught), client, requestStartedAt);
    }
  }

  private async completeRequest(
    grant: WorkerGrant,
    context: LocationRecommendationContext,
    request: Promise<LocationRecommendationResult>,
    client: LocationRecommendationWorkerClient,
    requestStartedAt: number,
  ): Promise<void> {
    let canonicalRequestId = grant.operationUUID;
    try {
      let result = await request;
      canonicalRequestId = result.requestId;
      if (result.status === 'PROCESSING') {
        try {
          result = await this.waitForTerminalStatus(result.requestId, grant, requestStartedAt);
        } catch (caught) {
          if (caught instanceof LocationRecommendationApiError && caught.status === 409) return;
          throw caught;
        }
      }
      if (
        result.scopeGeneration !== context.scopeGeneration ||
        result.cancelEpoch !== context.cancelEpoch
      ) {
        return;
      }
      client.updateResult(grant, grant.operationUUID, result);
    } catch (caught) {
      this.pauseAfterAuthorizationFailure(caught);
      if (caught instanceof LocationRecommendationTimeoutError) {
        const marker: LocationRecommendationCancelMarker = {
          authEpoch: this.authEpoch,
          scopeGeneration: context.scopeGeneration,
          cancellationUUID: crypto.randomUUID(),
          targetRequestId: canonicalRequestId,
          expectedCancelEpoch: context.cancelEpoch,
          createdAt: Date.now(),
        };
        this.cleanupTimedOutRequest(marker, grant.operationUUID);
        void this.sendTimeoutCancellation(marker);
      } else if (caught instanceof LocationRecommendationApiError && caught.status === 409) {
        await this.syncContextAfterConflict();
      }
    } finally {
      this.requestControllers.delete(grant.operationUUID);
    }
  }

  private async recoverRequest(
    grant: WorkerGrant,
    client: LocationRecommendationWorkerClient,
    requestId: string,
  ): Promise<void> {
    const controller = new AbortController();
    this.requestControllers.set(grant.operationUUID, controller);
    let recoveredContext: LocationRecommendationContext | null = null;
    let cleanupRequestId = requestId;
    let waitingForRequestTerminalStatus = false;
    try {
      if (!this.isCurrentGrant(grant) || !this.isActuallyActive()) return;
      const contextDeadline = createDeadlineSignal(controller.signal, ACCESS_CONTEXT_TIMEOUT_MS);
      let context: LocationRecommendationContext;
      try {
        context = await getLocationRecommendationContext(contextDeadline.signal);
        recoveredContext = context;
      } finally {
        contextDeadline.dispose();
      }
      if (!this.isCurrentGrant(grant) || !this.isActuallyActive()) return;
      await this.reconcileMarkers(context);
      const statusDeadline = createDeadlineSignal(controller.signal, STATUS_CHECK_TIMEOUT_MS);
      let result: LocationRecommendationResult;
      try {
        result = await getLocationRecommendationStatus(requestId, statusDeadline.signal);
      } finally {
        statusDeadline.dispose();
      }
      if (!this.isCurrentGrant(grant) || !this.isActuallyActive()) return;
      if (result.requestId !== requestId && requestId !== grant.operationUUID) return;
      cleanupRequestId = result.requestId;
      const previousCandidate = this.currentState?.candidate;
      if (
        previousCandidate?.operationUUID === grant.operationUUID &&
        result.region?.code !== previousCandidate.region.code
      ) {
        return;
      }
      if (result.status === 'PROCESSING') {
        waitingForRequestTerminalStatus = true;
        result = await this.waitForTerminalStatus(
          result.requestId,
          grant,
          performance.now(),
          controller.signal,
        );
      }
      if (!this.isCurrentGrant(grant) || !this.isActuallyActive()) return;
      if (
        result.scopeGeneration !== recoveredContext.scopeGeneration ||
        result.cancelEpoch !== recoveredContext.cancelEpoch
      ) {
        return;
      }
      client.updateResult(grant, grant.operationUUID, result);
    } catch (caught) {
      this.pauseAfterAuthorizationFailure(caught);
      if (
        caught instanceof LocationRecommendationTimeoutError &&
        waitingForRequestTerminalStatus &&
        recoveredContext
      ) {
        const marker: LocationRecommendationCancelMarker = {
          authEpoch: this.authEpoch,
          scopeGeneration: recoveredContext.scopeGeneration,
          cancellationUUID: crypto.randomUUID(),
          targetRequestId: cleanupRequestId,
          expectedCancelEpoch: recoveredContext.cancelEpoch,
          createdAt: Date.now(),
        };
        this.cleanupTimedOutRequest(marker, grant.operationUUID);
        void this.sendTimeoutCancellation(marker);
      }
      return;
    } finally {
      if (this.requestControllers.get(grant.operationUUID) === controller) {
        this.requestControllers.delete(grant.operationUUID);
      }
    }
  }

  private async waitForTerminalStatus(
    requestId: string,
    grant: WorkerGrant,
    requestStartedAt: number,
    signal?: AbortSignal,
  ): Promise<LocationRecommendationResult> {
    const operationSignal = signal ?? this.requestControllers.get(grant.operationUUID)?.signal;
    let currentRequestId = requestId;
    while (true) {
      const remainingMs =
        LOCATION_RECOMMENDATION_FE_TIMEOUT_MS - (performance.now() - requestStartedAt);
      if (remainingMs <= 0) throw new LocationRecommendationTimeoutError();
      await waitForDelay(
        Math.min(LOCATION_RECOMMENDATION_STATUS_INTERVAL_MS, remainingMs),
        operationSignal,
      );
      const deadline = createDeadlineSignal(operationSignal, remainingMs);
      try {
        const result = await getLocationRecommendationStatus(currentRequestId, deadline.signal);
        if (result.requestId !== currentRequestId) {
          throw new Error('canonical-request-mismatch');
        }
        currentRequestId = result.requestId;
        if (result.status !== 'PROCESSING') return result;
      } finally {
        deadline.dispose();
      }
    }
  }

  private async tryDisplayCandidate(): Promise<void> {
    const client = this.client;
    const state = this.currentState;
    const candidate = state?.candidate;
    if (
      !client ||
      !candidate ||
      !this.isActive ||
      !this.isMapEligible ||
      !this.isActuallyActive() ||
      state?.status !== 'READY' ||
      (state.displayGrantedTabId !== null && state.displayGrantedTabId !== client.tabId) ||
      state.cancelMarker !== null ||
      candidate.accessEventId !== this.currentAccessEventId ||
      candidate.operationUUID !== this.currentOperationUUID ||
      this.hasPendingCancellation(candidate)
    ) {
      return;
    }
    if (this.displayedCandidate?.requestId === candidate.requestId) return;
    const currentStateRevision = state.stateRevision;
    const mapRevision = this.mapEligibilityRevision;
    const accessEventId = candidate.accessEventId;
    const operationUUID = candidate.operationUUID;
    if (!(await this.verifyStatus(candidate, true))) {
      this.startFreshAccessAfterStaleCandidate(
        candidate,
        currentStateRevision,
        mapRevision,
        accessEventId,
        operationUUID,
      );
      return;
    }
    if (
      !this.isActuallyActive() ||
      !this.isMapEligible ||
      this.currentState?.stateRevision !== currentStateRevision ||
      this.mapEligibilityRevision !== mapRevision ||
      this.currentAccessEventId !== accessEventId ||
      this.currentOperationUUID !== operationUUID ||
      this.hasPendingCancellation(candidate)
    ) {
      return;
    }
    if (state.displayGrantedTabId === client.tabId) {
      this.displayedCandidate = { ...candidate };
      this.publishView();
      return;
    }
    let claim;
    try {
      claim = await claimLocationRecommendationDisplay(
        candidate.requestId,
        { scopeGeneration: candidate.scopeGeneration, cancelEpoch: candidate.cancelEpoch },
        crypto.randomUUID(),
      );
    } catch (caught) {
      this.pauseAfterAuthorizationFailure(caught);
      return;
    }
    if (
      !claim ||
      !this.isActuallyActive() ||
      !this.isMapEligible ||
      this.currentState?.stateRevision !== currentStateRevision ||
      this.mapEligibilityRevision !== mapRevision ||
      this.currentAccessEventId !== accessEventId ||
      this.currentOperationUUID !== operationUUID ||
      this.hasPendingCancellation(candidate)
    ) {
      return;
    }
    const grantState = await client
      .requestDisplayGrant({
        accessEventId: candidate.accessEventId,
        operationUUID: candidate.operationUUID,
        leaderEpoch: candidate.leaderEpoch,
        workerInstanceId: state.workerInstanceId,
        stateRevision: currentStateRevision,
        mapEligibilityRevision: mapRevision,
        claim,
      })
      .catch(() => null);
    if (
      !grantState ||
      !this.isActuallyActive() ||
      !this.isMapEligible ||
      this.currentState?.stateRevision !== currentStateRevision ||
      this.mapEligibilityRevision !== mapRevision ||
      this.currentAccessEventId !== accessEventId ||
      this.currentOperationUUID !== operationUUID ||
      grantState.candidate?.requestId !== candidate.requestId ||
      grantState.displayGrantedTabId !== client.tabId ||
      this.hasPendingCancellation(candidate)
    ) {
      return;
    }
    this.displayedCandidate = { ...grantState.candidate };
    this.publishView();
  }

  private startFreshAccessAfterStaleCandidate(
    candidate: LocationRecommendationCandidate,
    stateRevision: number,
    mapRevision: number,
    accessEventId: string,
    operationUUID: string,
  ): void {
    const state = this.currentState;
    if (
      !this.isActuallyActive() ||
      !this.isMapEligible ||
      this.mapEligibilityRevision !== mapRevision ||
      !state ||
      state.stateRevision !== stateRevision ||
      state.candidate?.requestId !== candidate.requestId ||
      this.currentAccessEventId !== accessEventId ||
      this.currentOperationUUID !== operationUUID ||
      this.hasPendingCancellation(candidate)
    ) {
      return;
    }
    this.currentAccessEventId = null;
    this.currentOperationUUID = null;
    this.beginAccessEvent();
  }

  private handleWorkerState(state: LocationRecommendationState): void {
    if (state.authEpoch !== this.authEpoch) return;
    if (
      this.isActuallyActive() &&
      this.currentAccessEventId !== null &&
      (state.accessEventId !== this.currentAccessEventId ||
        state.operationUUID !== this.currentOperationUUID)
    ) {
      return;
    }
    if (
      this.currentState?.workerInstanceId === state.workerInstanceId &&
      state.stateRevision < this.currentState.stateRevision
    ) {
      return;
    }
    this.currentState = state;
    this.hasReceivedWorkerState = true;
    const continueAfterWorkerState =
      this.waitingForWorkerState && this.isActuallyActive() && this.isMapEligible;
    this.waitingForWorkerState = false;
    if (
      state.accessEventId &&
      state.accessEventId !== this.currentAccessEventId &&
      state.operationUUID
    ) {
      this.cachedSample = null;
      this.accessContextController?.abort();
      this.accessContextController = null;
      this.currentAccessEventId = state.accessEventId;
      this.currentOperationUUID = state.operationUUID;
    }
    if (
      !state.candidate ||
      state.cancelMarker ||
      state.accessEventId !== this.currentAccessEventId ||
      state.displayGrantedTabId !== this.client?.tabId
    ) {
      const cancelTargetsDisplayed = Boolean(
        this.displayedCandidate &&
        state.cancelMarker &&
        (state.cancelMarker.targetRequestId === this.displayedCandidate.requestId ||
          state.cancelMarker.targetRequestId === this.displayedCandidate.operationUUID),
      );
      if (this.displayedCandidate && cancelTargetsDisplayed && state.cancelMarker) {
        window.dispatchEvent(new CustomEvent(CANCEL_EVENT_NAME, { detail: state.cancelMarker }));
        this.displayedCandidate = null;
      }
    }
    if (state.cancelMarker) {
      this.cancelMarkers.set(state.cancelMarker.cancellationUUID, state.cancelMarker);
    }
    if (state.candidate) {
      if (this.isMapEligible) void this.tryDisplayCandidate();
    } else if (continueAfterWorkerState) {
      this.startMapAccessIfReady(true);
    }
    this.publishView();
  }

  private handleGrantRevoked(grant: WorkerGrant): void {
    if (this.activeGrant?.leaderEpoch !== grant.leaderEpoch) return;
    this.activeGrant = null;
    this.requestControllers.get(grant.operationUUID)?.abort();
    this.accessContextController?.abort();
    this.accessContextController = null;
  }

  private isCurrentEvent(accessEventId: string, operationUUID: string): boolean {
    return (
      this.currentAccessEventId === accessEventId &&
      this.currentOperationUUID === operationUUID &&
      this.isActive &&
      this.started &&
      !this.isDisabled
    );
  }

  private isCurrentGrant(grant: WorkerGrant): boolean {
    return Boolean(
      this.activeGrant &&
      this.activeGrant.tabId === grant.tabId &&
      this.activeGrant.accessEventId === grant.accessEventId &&
      this.activeGrant.operationUUID === grant.operationUUID &&
      this.activeGrant.leaderEpoch === grant.leaderEpoch &&
      this.activeGrant.workerInstanceId === grant.workerInstanceId &&
      this.isCurrentEvent(grant.accessEventId, grant.operationUUID),
    );
  }

  private isActuallyActive(): boolean {
    return (
      this.isActive &&
      this.serviceRoute &&
      !this.authorizationPaused &&
      document.visibilityState === 'visible' &&
      document.hasFocus()
    );
  }

  private abortCurrentRequest(): void {
    if (this.currentOperationUUID) {
      this.requestControllers.get(this.currentOperationUUID)?.abort();
    }
  }

  private applyLocalCancel(marker: LocationRecommendationCancelMarker): void {
    this.cancelMarkers.set(marker.cancellationUUID, marker);
    this.requestControllers.get(marker.targetRequestId)?.abort();
    const candidate = this.displayedCandidate ?? this.currentState?.candidate;
    if (
      this.currentOperationUUID &&
      (marker.targetRequestId === this.currentOperationUUID ||
        candidate?.requestId === marker.targetRequestId)
    ) {
      this.requestControllers.get(this.currentOperationUUID)?.abort();
    }
    this.client?.cancelPending(marker);
    window.dispatchEvent(new CustomEvent(CANCEL_EVENT_NAME, { detail: marker }));
    this.displayedCandidate = null;
    this.publishView();
  }

  private cleanupTimedOutRequest(
    marker: LocationRecommendationCancelMarker,
    operationUUID: string,
  ): void {
    this.requestControllers.get(operationUUID)?.abort();
    this.timeoutCleanupMarkers.set(marker.cancellationUUID, marker);
    try {
      window.localStorage.setItem(timeoutCleanupStorageKey(marker), JSON.stringify(marker));
    } catch {
      // Keep cleanup pending in memory until the next coordinator entry.
    }
  }

  private async sendTimeoutCancellation(marker: LocationRecommendationCancelMarker): Promise<void> {
    try {
      await cancelLocationRecommendation({
        requestId: marker.targetRequestId,
        scopeGeneration: marker.scopeGeneration,
        cancelEpoch: marker.expectedCancelEpoch,
        cancellationUUID: marker.cancellationUUID,
      });
      this.timeoutCleanupMarkers.delete(marker.cancellationUUID);
      window.localStorage.removeItem(timeoutCleanupStorageKey(marker));
    } catch {
      // Retry this request only on the next service entry.
    }
  }

  private persistCancelMarker(marker: LocationRecommendationCancelMarker): void {
    try {
      window.localStorage.setItem(markerStorageKey(marker), JSON.stringify(marker));
      this.durableMarkerIds.add(marker.cancellationUUID);
    } catch {
      this.cancelMarkers.set(marker.cancellationUUID, marker);
    }
  }

  private readonly handleStorageEvent = (event: StorageEvent) => {
    if (event.key?.startsWith(TIMEOUT_CLEANUP_PREFIX) && event.newValue) {
      try {
        const timeoutMarker = parseCancelMarker(JSON.parse(event.newValue));
        if (timeoutMarker?.authEpoch === this.authEpoch) {
          this.timeoutCleanupMarkers.set(timeoutMarker.cancellationUUID, timeoutMarker);
          void this.sendTimeoutCancellation(timeoutMarker);
        }
      } catch {
        return;
      }
      return;
    }
    if (!event.key?.startsWith(LOCATION_RECOMMENDATION_BRIDGE_PREFIX) || !event.newValue) return;
    let marker: LocationRecommendationCancelMarker | null;
    try {
      marker = parseCancelMarker(JSON.parse(event.newValue));
    } catch {
      return;
    }
    if (!marker || marker.authEpoch !== this.authEpoch) return;
    this.durableMarkerIds.add(marker.cancellationUUID);
    this.applyLocalCancel(marker);
  };

  private hasPendingCancellation(candidate: LocationRecommendationCandidate): boolean {
    if (
      [...this.cancelMarkers.values()].some(
        (marker) =>
          marker.targetRequestId === candidate.requestId ||
          marker.targetRequestId === candidate.operationUUID,
      )
    ) {
      return true;
    }
    const marker = this.currentState?.cancelMarker;
    return Boolean(
      marker &&
      (marker.targetRequestId === candidate.requestId ||
        marker.targetRequestId === candidate.operationUUID),
    );
  }

  private async reconcilePendingMarkers(): Promise<void> {
    if (!this.cancelMarkers.size) return;
    let context: LocationRecommendationContext | null;
    try {
      context = await getLocationRecommendationContext();
    } catch (caught) {
      this.pauseAfterAuthorizationFailure(caught);
      return;
    }
    if (!context) return;
    await this.reconcileMarkers(context);
    for (const marker of [...this.cancelMarkers.values()]) {
      if (marker.scopeGeneration !== context.scopeGeneration) continue;
      if (context.cancelEpoch >= (marker.resultCancelEpoch ?? marker.expectedCancelEpoch + 1))
        continue;
      await this.sendCancellation(marker);
    }
  }

  private async syncContextAfterConflict(): Promise<void> {
    const deadline = createDeadlineSignal(undefined, ACCESS_CONTEXT_TIMEOUT_MS);
    try {
      const context = await getLocationRecommendationContext(deadline.signal);
      await this.reconcileMarkers(context);
    } catch (caught) {
      this.pauseAfterAuthorizationFailure(caught);
      return;
    } finally {
      deadline.dispose();
    }
  }

  private async reconcileMarkers(context: LocationRecommendationContext): Promise<void> {
    for (const marker of [...this.cancelMarkers.values()]) {
      const isSupersededGeneration = marker.scopeGeneration !== context.scopeGeneration;
      const expectedResultEpoch = marker.resultCancelEpoch ?? marker.expectedCancelEpoch + 1;
      if (!isSupersededGeneration && context.cancelEpoch < expectedResultEpoch) continue;
      this.removeCancelMarker(marker, context);
    }
  }

  private removeCancelMarker(
    marker: LocationRecommendationCancelMarker,
    context: LocationRecommendationContext,
  ): void {
    this.cancelMarkers.delete(marker.cancellationUUID);
    if (this.durableMarkerIds.has(marker.cancellationUUID)) {
      try {
        window.localStorage.removeItem(markerStorageKey(marker));
        this.durableMarkerIds.delete(marker.cancellationUUID);
      } catch {
        this.cancelMarkers.set(marker.cancellationUUID, marker);
        return;
      }
    }
    this.client?.clearCancelMarker(marker, context.cancelEpoch, context.scopeGeneration);
  }

  private async sendCancellation(marker: LocationRecommendationCancelMarker): Promise<void> {
    const controller = new AbortController();
    try {
      const response = await cancelLocationRecommendation(
        {
          requestId: marker.targetRequestId,
          scopeGeneration: marker.scopeGeneration,
          cancelEpoch: marker.expectedCancelEpoch,
          cancellationUUID: marker.cancellationUUID,
        },
        controller.signal,
      );
      const context = await getLocationRecommendationContext();
      if (
        context.scopeGeneration !== marker.scopeGeneration ||
        context.cancelEpoch >= response.cancelEpoch
      ) {
        this.removeCancelMarker(marker, context);
      } else {
        const updatedMarker = {
          ...marker,
          resultCancelEpoch: response.cancelEpoch,
        };
        this.cancelMarkers.set(marker.cancellationUUID, updatedMarker);
        if (this.durableMarkerIds.has(marker.cancellationUUID)) {
          try {
            window.localStorage.setItem(markerStorageKey(marker), JSON.stringify(updatedMarker));
          } catch {
            this.cancelMarkers.set(marker.cancellationUUID, updatedMarker);
          }
        }
      }
    } catch (caught) {
      this.pauseAfterAuthorizationFailure(caught);
      this.cancelMarkers.set(marker.cancellationUUID, marker);
    }
  }
}

export function useLocationRecommendationAuthState(isAuthenticated: boolean): void {
  const context = useContext(CoordinatorContext);
  useLayoutEffect(() => context.setAuthenticated(isAuthenticated), [context, isAuthenticated]);
}

export function useLocationRecommendationMapEligibility(
  isMapRoute: boolean,
  isMapReady: boolean,
): void {
  const context = useContext(LocationRecommendationViewContext);
  useLayoutEffect(
    () => context.reportMapState(isMapRoute, isMapReady),
    [context, isMapReady, isMapRoute],
  );
}
