export const LOCATION_RECOMMENDATION_PROTOCOL_MAJOR = 1;
export const LOCATION_RECOMMENDATION_PROTOCOL_MINOR = 1;
export const LOCATION_RECOMMENDATION_BRIDGE_NAME = 'meomuneum:location-recommendation:bridge:v1';
export const LOCATION_RECOMMENDATION_BRIDGE_PREFIX = 'meomuneum:location-recommendation:cancel:';
export const LOCATION_RECOMMENDATION_WEB_LOCK = 'meomuneum:location-recommendation:access';
export const LOCATION_RECOMMENDATION_BUILD_ID = 'v3';
export const LOCATION_RECOMMENDATION_FE_TIMEOUT_MS = 140_000;
export const LOCATION_RECOMMENDATION_PREVIEW_LIMIT_MS = 30_000;
export const LOCATION_RECOMMENDATION_STATUS_INTERVAL_MS = 3_000;

export function isCompatibleBridgeProtocol(wireMajor: number, wireMinor: number): boolean {
  return (
    wireMajor === LOCATION_RECOMMENDATION_PROTOCOL_MAJOR &&
    wireMinor === LOCATION_RECOMMENDATION_PROTOCOL_MINOR
  );
}

export type LocationRecommendationStatus =
  'PROCESSING' | 'READY' | 'EMPTY' | 'FAILED' | 'CANCELLED' | 'SUPERSEDED' | 'EXPIRED';

export type LocationRecommendationTrack = {
  trackId: string;
  title: string;
  artist: string;
  previewUrl: string | null;
  artworkUrl: string | null;
  storeUrl: string | null;
};

export type LocationRecommendationRegion = {
  regionId: number;
  code: string;
  name: string;
  sidoName: string;
};

export type LocationRecommendationContext = {
  scopeGeneration: string;
  cancelEpoch: number;
  kstDate: string;
  activeRequestId: string | null;
};

export type LocationRecommendationResult = {
  requestId: string;
  status: LocationRecommendationStatus;
  reason: string | null;
  region: LocationRecommendationRegion;
  tracks: LocationRecommendationTrack[];
  scopeGeneration: string;
  cancelEpoch: number;
  remainingTtlMs: number;
};

export type LocationRecommendationDisplayClaim = {
  requestId: string;
  displayAllowed: boolean;
  reason: string | null;
};

export type LocationRecommendationCancellation = {
  status: 'CANCELLED';
  scopeGeneration: string;
  cancelEpoch: number;
};

export type RecommendationPhase =
  'NOT_STARTED' | 'SAMPLING' | 'SAMPLED' | 'REQUEST_SENT' | 'ABORTED_UNKNOWN';

export type LocationRecommendationCancelMarker = {
  authEpoch: string;
  scopeGeneration: string;
  cancellationUUID: string;
  targetRequestId: string;
  expectedCancelEpoch: number;
  createdAt: number;
  resultCancelEpoch?: number;
};

export type LocationRecommendationCandidate = {
  authEpoch: string;
  accessEventId: string;
  operationUUID: string;
  accessSequence: number;
  leaderEpoch: number;
  requestId: string;
  region: LocationRecommendationRegion;
  tracks: LocationRecommendationTrack[];
  scopeGeneration: string;
  cancelEpoch: number;
  remainingTtlMs: number;
  receivedAt: number;
  sourceWorkerInstanceId: string;
  sourceStateRevision: number;
};

export type LocationRecommendationState = {
  authEpoch: string;
  workerInstanceId: string;
  stateRevision: number;
  activeTabId: string | null;
  leaderEpoch: number;
  accessEventId: string | null;
  operationUUID: string | null;
  accessSequence: number | null;
  phase: RecommendationPhase;
  status: LocationRecommendationStatus | null;
  requestId: string | null;
  region: LocationRecommendationRegion | null;
  tracks: LocationRecommendationTrack[];
  scopeGeneration: string | null;
  cancelEpoch: number | null;
  remainingTtlMs: number;
  displayGrantedTabId: string | null;
  cancelMarker: LocationRecommendationCancelMarker | null;
  candidate: LocationRecommendationCandidate | null;
};

export type WorkerGrant = {
  tabId: string;
  accessEventId: string;
  operationUUID: string;
  leaderEpoch: number;
  workerInstanceId: string;
};

export function matchesAuthEpoch(currentEpoch: string | null, requestedEpoch: string): boolean {
  return Boolean(currentEpoch && currentEpoch === requestedEpoch);
}

export function matchesWorkerGrant(
  currentGrant: WorkerGrant | null,
  expectedGrant: WorkerGrant,
): boolean {
  return Boolean(
    currentGrant &&
    currentGrant.tabId === expectedGrant.tabId &&
    currentGrant.accessEventId === expectedGrant.accessEventId &&
    currentGrant.operationUUID === expectedGrant.operationUUID &&
    currentGrant.leaderEpoch === expectedGrant.leaderEpoch &&
    currentGrant.workerInstanceId === expectedGrant.workerInstanceId,
  );
}

export function resetLocationRecommendationState(
  state: LocationRecommendationState,
): LocationRecommendationState {
  return {
    ...state,
    authEpoch: '',
    activeTabId: null,
    accessEventId: null,
    operationUUID: null,
    accessSequence: null,
    leaderEpoch: 0,
    phase: 'NOT_STARTED',
    status: null,
    requestId: null,
    region: null,
    tracks: [],
    scopeGeneration: null,
    cancelEpoch: null,
    remainingTtlMs: 0,
    displayGrantedTabId: null,
    cancelMarker: null,
    candidate: null,
  };
}

export function hasUnclaimedReadyCandidate(state: LocationRecommendationState): boolean {
  return state.status === 'READY' && state.candidate !== null && state.displayGrantedTabId === null;
}

export function shouldAcceptBridgeAccessEvent(
  current: Pick<LocationRecommendationState, 'accessEventId' | 'operationUUID' | 'accessSequence'>,
  incoming: { accessEventId: string; operationUUID: string; accessSequence: number },
): boolean {
  if (!Number.isSafeInteger(incoming.accessSequence) || incoming.accessSequence < 1) return false;
  if (current.accessSequence === null) {
    if (current.accessEventId === null && current.operationUUID === null) return true;
    return (
      incoming.accessEventId === current.accessEventId &&
      incoming.operationUUID === current.operationUUID
    );
  }
  if (incoming.accessSequence < current.accessSequence) return false;
  if (incoming.accessSequence > current.accessSequence) return true;
  return (
    incoming.accessEventId === current.accessEventId &&
    incoming.operationUUID === current.operationUUID
  );
}

export function shouldAcceptBridgeCandidate(
  current: Pick<LocationRecommendationState, 'accessEventId' | 'operationUUID' | 'accessSequence'>,
  incoming: { accessEventId: string; operationUUID: string; accessSequence: number },
): boolean {
  return shouldAcceptBridgeAccessEvent(current, incoming);
}

export function shouldAcceptDeferredBridgeAccessEvent(
  current: Pick<LocationRecommendationState, 'accessEventId' | 'operationUUID' | 'accessSequence'>,
  incoming: { accessEventId: string; operationUUID: string; accessSequence: number },
  latestAccessSequence: number,
): boolean {
  if (incoming.accessSequence !== latestAccessSequence) return false;
  if (current.accessSequence === null) return true;
  return shouldAcceptBridgeAccessEvent(current, incoming);
}

export type WorkerClientMessage =
  | {
      type: 'CONNECT';
      tabId: string;
      authEpoch: string;
      protocolMajor: number;
      protocolMinor: number;
      buildId: string;
    }
  | { type: 'GET_STATE'; requestId: string; authEpoch: string }
  | {
      type: 'ACTIVATE';
      tabId: string;
      authEpoch: string;
      accessEventId: string;
      operationUUID: string;
    }
  | { type: 'DEACTIVATE'; tabId: string; authEpoch: string; grant?: WorkerGrant }
  | { type: 'HEARTBEAT'; tabId: string; authEpoch: string; leaderEpoch: number }
  | {
      type: 'SET_MAP_ELIGIBILITY';
      tabId: string;
      authEpoch: string;
      eligible: boolean;
      isMapRoute: boolean;
      mapEligibilityRevision: number;
    }
  | { type: 'VALIDATE_GRANT'; requestId: string; grant: WorkerGrant; authEpoch: string }
  | {
      type: 'CONFIRM_ACCESS_EVENT';
      requestId: string;
      grant: WorkerGrant;
      authEpoch: string;
      accessSequence: number;
    }
  | {
      type: 'SET_PHASE';
      grant: WorkerGrant;
      authEpoch: string;
      phase: RecommendationPhase;
    }
  | {
      type: 'UPDATE_RESULT';
      grant: WorkerGrant;
      authEpoch: string;
      result: LocationRecommendationResult;
      operationUUID: string;
    }
  | {
      type: 'DISPLAY_CLAIM_RESULT';
      requestId: string;
      tabId: string;
      authEpoch: string;
      accessEventId: string;
      operationUUID: string;
      leaderEpoch: number;
      workerInstanceId: string;
      stateRevision: number;
      mapEligibilityRevision: number;
      claim: LocationRecommendationDisplayClaim;
    }
  | {
      type: 'CANCEL_PENDING';
      marker: LocationRecommendationCancelMarker;
    }
  | {
      type: 'CLEAR_CANCEL_MARKER';
      marker: LocationRecommendationCancelMarker;
      confirmedCancelEpoch: number;
      confirmedScopeGeneration: string;
    }
  | { type: 'AUTH_RESET'; authEpoch: string }
  | { type: 'BRIDGE_STATUS'; compatible: boolean; authEpoch: string };

export type WorkerServerMessage =
  | { type: 'STATE_SNAPSHOT'; requestId?: string; state: LocationRecommendationState }
  | { type: 'EMPTY_CACHE'; requestId?: string; state: LocationRecommendationState }
  | { type: 'STATE_UPDATED'; state: LocationRecommendationState }
  | { type: 'LEADER_GRANTED'; grant: WorkerGrant }
  | { type: 'LEADER_REVOKED'; grant: WorkerGrant }
  | { type: 'GRANT_VALIDATED'; requestId: string; valid: boolean; grant: WorkerGrant }
  | { type: 'ACCESS_EVENT_RESERVED'; requestId: string; reserved: boolean; accessSequence: number }
  | { type: 'PHASE_UPDATED'; grant: WorkerGrant; phase: RecommendationPhase }
  | { type: 'DISPLAY_GRANTED'; requestId: string; state: LocationRecommendationState }
  | { type: 'DISPLAY_DENIED'; requestId: string }
  | { type: 'CANCEL_APPLIED'; marker: LocationRecommendationCancelMarker }
  | { type: 'BRIDGE_STATUS'; compatible: boolean }
  | { type: 'FEATURE_DISABLED'; reason: string };

export type LocationBridgeEnvelope = {
  wireMajor: number;
  wireMinor: number;
  buildId: string;
  workerInstanceId: string;
  authEpoch: string;
  messageId: string;
  type: 'HELLO' | 'ACCESS_STARTED' | 'STATE_UPDATED' | 'CANCEL_MARKER' | 'CANCEL_ACK';
  [key: string]: unknown;
};
