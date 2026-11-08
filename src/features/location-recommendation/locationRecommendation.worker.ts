import {
  LOCATION_RECOMMENDATION_BUILD_ID,
  LOCATION_RECOMMENDATION_BRIDGE_NAME,
  LOCATION_RECOMMENDATION_PROTOCOL_MAJOR,
  LOCATION_RECOMMENDATION_PROTOCOL_MINOR,
  type LocationBridgeEnvelope,
  type LocationRecommendationCancelMarker,
  type LocationRecommendationRegion,
  type LocationRecommendationState,
  type LocationRecommendationTrack,
  hasUnclaimedReadyCandidate,
  isCompatibleBridgeProtocol,
  matchesAuthEpoch,
  matchesWorkerGrant,
  shouldAcceptBridgeAccessEvent,
  shouldAcceptBridgeCandidate,
  shouldAcceptDeferredBridgeAccessEvent,
  type RecommendationPhase,
  resetLocationRecommendationState,
  type WorkerClientMessage,
  type WorkerGrant,
  type WorkerServerMessage,
} from './locationRecommendationTypes';

type WorkerHost = typeof globalThis & {
  onconnect: ((event: MessageEvent<{ ports: MessagePort[] }>) => void) | null;
};

type PortRegistration = {
  port: MessagePort;
  tabId: string;
  authEpoch: string;
  active: boolean;
  mapEligible: boolean;
  isMapRoute: boolean;
  mapEligibilityRevision: number;
  heartbeatAt: number;
  grant: WorkerGrant | null;
  reservedAccessSequence: number | null;
};

type DeferredBridgeAccess = {
  tabId: string;
  accessEventId: string;
  operationUUID: string;
  accessSequence: number;
  leaderEpoch: number;
  state: LocationRecommendationState | null;
  receivedAt: number;
};

const workerHost = globalThis as WorkerHost;
const workerInstanceId = crypto.randomUUID();
const ports = new Map<string, PortRegistration>();
let authEpoch: string | null = null;
let bridgeCompatible = false;
let stateRevision = 0;
let ttlStartedAt = 0;
let latestAccessSequence = 0;
let deferredBridgeAccess: DeferredBridgeAccess | null = null;
let currentState: LocationRecommendationState = {
  authEpoch: '',
  workerInstanceId,
  stateRevision,
  activeTabId: null,
  leaderEpoch: 0,
  accessEventId: null,
  operationUUID: null,
  accessSequence: null,
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
let bridge: BroadcastChannel | null = null;
let bridgeRejected = false;

function cloneMarker(marker: LocationRecommendationCancelMarker | null) {
  return marker ? { ...marker } : null;
}

function stateSnapshot(): LocationRecommendationState {
  const elapsedMs = currentState.status === 'READY' ? performance.now() - ttlStartedAt : 0;
  const remainingTtlMs = Math.max(0, Math.floor(currentState.remainingTtlMs - elapsedMs));
  if (currentState.status === 'READY' && remainingTtlMs === 0) {
    return {
      ...currentState,
      status: 'EXPIRED',
      tracks: [],
      candidate: null,
      remainingTtlMs: 0,
      cancelMarker: cloneMarker(currentState.cancelMarker),
    };
  }
  const candidate = currentState.candidate ? { ...currentState.candidate, remainingTtlMs } : null;
  return {
    ...currentState,
    tracks: currentState.tracks.map((track) => ({ ...track })),
    candidate,
    remainingTtlMs,
    cancelMarker: cloneMarker(currentState.cancelMarker),
  };
}

function post(port: MessagePort, message: WorkerServerMessage): void {
  try {
    port.postMessage(message);
  } catch {
    ports.forEach((registration) => {
      if (registration.port === port) ports.delete(registration.tabId);
    });
  }
}

function notifyPorts(): void {
  stateRevision += 1;
  currentState = { ...currentState, stateRevision };
  const snapshot = stateSnapshot();
  ports.forEach((registration) => {
    if (registration.authEpoch === authEpoch) {
      post(registration.port, { type: 'STATE_UPDATED', state: snapshot });
    }
  });
  publishBridgeState(snapshot);
}

function makeEnvelope(
  type: LocationBridgeEnvelope['type'],
  fields: Record<string, unknown> = {},
): LocationBridgeEnvelope | null {
  if (!authEpoch) return null;
  return {
    wireMajor: LOCATION_RECOMMENDATION_PROTOCOL_MAJOR,
    wireMinor: LOCATION_RECOMMENDATION_PROTOCOL_MINOR,
    buildId: LOCATION_RECOMMENDATION_BUILD_ID,
    workerInstanceId,
    authEpoch,
    messageId: crypto.randomUUID(),
    type,
    ...fields,
  };
}

function publishBridge(type: LocationBridgeEnvelope['type'], fields: Record<string, unknown> = {}) {
  if (!bridge || !bridgeCompatible) return;
  const envelope = makeEnvelope(type, fields);
  if (!envelope) return;
  try {
    bridge.postMessage(envelope);
  } catch {
    bridgeCompatible = false;
    announceBridgeStatus();
  }
}

function publishBridgeState(snapshot = stateSnapshot()): void {
  if (!snapshot.accessEventId || !snapshot.operationUUID) return;
  publishBridge('STATE_UPDATED', { state: snapshot });
}

function announceBridgeStatus(): void {
  ports.forEach((registration) => {
    post(registration.port, { type: 'BRIDGE_STATUS', compatible: bridgeCompatible });
    if (!bridgeCompatible) {
      post(registration.port, { type: 'FEATURE_DISABLED', reason: 'bridge-unavailable' });
    }
  });
}

function disableBridge(): void {
  bridgeCompatible = false;
  currentState = {
    ...currentState,
    candidate: null,
    status: null,
    tracks: [],
    displayGrantedTabId: null,
  };
  announceBridgeStatus();
  notifyPorts();
}

function validUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function validRegion(value: unknown): value is LocationRecommendationRegion {
  if (!value || typeof value !== 'object') return false;
  const region = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(region.regionId) &&
    typeof region.code === 'string' &&
    typeof region.name === 'string' &&
    typeof region.sidoName === 'string'
  );
}

function validTracks(value: unknown): value is LocationRecommendationTrack[] {
  return (
    Array.isArray(value) &&
    value.length <= 5 &&
    value.every((track) => {
      if (!track || typeof track !== 'object') return false;
      const candidate = track as Record<string, unknown>;
      return (
        typeof candidate.trackId === 'string' &&
        typeof candidate.title === 'string' &&
        typeof candidate.artist === 'string' &&
        (candidate.previewUrl === null || typeof candidate.previewUrl === 'string') &&
        (candidate.artworkUrl === null || typeof candidate.artworkUrl === 'string') &&
        (candidate.storeUrl === null || typeof candidate.storeUrl === 'string')
      );
    })
  );
}

function grantIsCurrent(grant: WorkerGrant, registration?: PortRegistration): boolean {
  const owner = registration ?? ports.get(grant.tabId);
  return Boolean(
    bridgeCompatible &&
    owner &&
    owner.active &&
    owner.authEpoch === authEpoch &&
    owner.tabId === grant.tabId &&
    matchesWorkerGrant(owner.grant, grant) &&
    currentState.activeTabId === grant.tabId &&
    currentState.accessEventId === grant.accessEventId &&
    currentState.operationUUID === grant.operationUUID &&
    currentState.leaderEpoch === grant.leaderEpoch &&
    currentState.workerInstanceId === grant.workerInstanceId,
  );
}

function clearCandidate(status: LocationRecommendationState['status'] = null): void {
  ttlStartedAt = 0;
  currentState = {
    ...currentState,
    status,
    requestId: null,
    region: null,
    tracks: [],
    scopeGeneration: null,
    cancelEpoch: null,
    remainingTtlMs: 0,
    displayGrantedTabId: null,
    candidate: null,
  };
}

function applyCancelMarker(marker: LocationRecommendationCancelMarker, publish = true): void {
  if (
    marker.authEpoch !== authEpoch ||
    !validUuid(marker.cancellationUUID) ||
    !validUuid(marker.scopeGeneration) ||
    !validUuid(marker.targetRequestId) ||
    !Number.isSafeInteger(marker.expectedCancelEpoch)
  ) {
    return;
  }
  currentState = {
    ...currentState,
    cancelMarker: { ...marker },
    candidate: null,
    displayGrantedTabId: null,
    tracks: [],
  };
  if (publish) publishBridge('CANCEL_MARKER', { marker });
  notifyPorts();
}

function hasUnreservedLocalGrant(): boolean {
  return [...ports.values()].some(
    (registration) =>
      registration.active &&
      registration.grant !== null &&
      registration.reservedAccessSequence === null,
  );
}

function deferBridgeAccess(
  event: Omit<DeferredBridgeAccess, 'state' | 'receivedAt'>,
  state: LocationRecommendationState | null = null,
): void {
  if (deferredBridgeAccess && deferredBridgeAccess.accessSequence > event.accessSequence) return;
  const isSameDeferredEvent = Boolean(
    deferredBridgeAccess?.accessSequence === event.accessSequence &&
    deferredBridgeAccess.accessEventId === event.accessEventId &&
    deferredBridgeAccess.operationUUID === event.operationUUID,
  );
  const deferredReceivedAt = deferredBridgeAccess?.receivedAt;
  if (
    deferredBridgeAccess &&
    deferredBridgeAccess.accessSequence === event.accessSequence &&
    (deferredBridgeAccess.accessEventId !== event.accessEventId ||
      deferredBridgeAccess.operationUUID !== event.operationUUID)
  ) {
    deferredBridgeAccess = null;
    return;
  }
  deferredBridgeAccess = {
    ...event,
    state,
    receivedAt:
      isSameDeferredEvent && deferredReceivedAt !== undefined
        ? deferredReceivedAt
        : performance.now(),
  };
}

function revokeOlderLocalGrant(accessSequence: number): void {
  const registration = ports.get(currentState.activeTabId ?? '');
  if (
    !registration?.grant ||
    registration.reservedAccessSequence === null ||
    registration.reservedAccessSequence >= accessSequence
  ) {
    return;
  }
  post(registration.port, { type: 'LEADER_REVOKED', grant: registration.grant });
  registration.grant = null;
  registration.reservedAccessSequence = null;
  registration.active = false;
  registration.mapEligible = false;
}

function applyBridgeAccessStarted(
  event: Omit<DeferredBridgeAccess, 'state' | 'receivedAt'>,
  isDeferredWinner = false,
): void {
  const accepted = isDeferredWinner
    ? shouldAcceptDeferredBridgeAccessEvent(currentState, event, latestAccessSequence)
    : shouldAcceptBridgeAccessEvent(currentState, event);
  if (!accepted) return;
  revokeOlderLocalGrant(event.accessSequence);
  currentState = {
    ...currentState,
    activeTabId: event.tabId,
    leaderEpoch: event.leaderEpoch,
    accessEventId: event.accessEventId,
    operationUUID: event.operationUUID,
    accessSequence: event.accessSequence,
    phase: 'NOT_STARTED',
    status: null,
    requestId: null,
    region: null,
    tracks: [],
    scopeGeneration: null,
    cancelEpoch: null,
    remainingTtlMs: 0,
    displayGrantedTabId: null,
    candidate: null,
    cancelMarker: currentState.cancelMarker,
    workerInstanceId,
  };
  notifyPorts();
}

function applyBridgeCandidate(
  remote: LocationRecommendationState,
  receivedAt = performance.now(),
  isDeferredWinner = false,
): void {
  if (!authEpoch) return;
  const currentAuthEpoch = authEpoch;
  const candidate = remote.candidate;
  const accepted = candidate
    ? isDeferredWinner
      ? shouldAcceptDeferredBridgeAccessEvent(currentState, candidate, latestAccessSequence)
      : shouldAcceptBridgeCandidate(currentState, candidate)
    : false;
  if (!candidate || !accepted) return;
  revokeOlderLocalGrant(candidate.accessSequence);
  const elapsedMs = Math.max(0, performance.now() - receivedAt);
  const remainingTtlMs = Math.max(0, remote.remainingTtlMs - elapsedMs);
  if (remainingTtlMs <= 0) return;
  const marker = currentState.cancelMarker;
  if (
    marker &&
    (marker.targetRequestId === candidate.requestId ||
      marker.targetRequestId === candidate.operationUUID) &&
    candidate.cancelEpoch < marker.expectedCancelEpoch
  ) {
    return;
  }
  currentState = {
    ...currentState,
    accessEventId: candidate.accessEventId,
    operationUUID: candidate.operationUUID,
    accessSequence: candidate.accessSequence,
    leaderEpoch: candidate.leaderEpoch,
    status: 'READY',
    requestId: candidate.requestId,
    region: { ...candidate.region },
    tracks: candidate.tracks.map((track) => ({ ...track })),
    scopeGeneration: candidate.scopeGeneration,
    cancelEpoch: candidate.cancelEpoch,
    remainingTtlMs,
    displayGrantedTabId: null,
    candidate: {
      ...candidate,
      authEpoch: currentAuthEpoch,
      sourceWorkerInstanceId: remote.workerInstanceId,
      sourceStateRevision: remote.stateRevision,
      receivedAt: performance.now(),
      remainingTtlMs,
    },
    workerInstanceId,
  };
  ttlStartedAt = performance.now();
  notifyPorts();
}

function applyDeferredBridgeAccess(): void {
  const deferred = deferredBridgeAccess;
  if (!deferred || hasUnreservedLocalGrant()) return;
  deferredBridgeAccess = null;
  if (deferred.accessSequence !== latestAccessSequence) return;
  if (deferred.state?.candidate) {
    const state = {
      ...deferred.state,
      remainingTtlMs: Math.max(
        0,
        deferred.state.remainingTtlMs - (performance.now() - deferred.receivedAt),
      ),
      receivedAt: deferred.receivedAt,
    };
    applyBridgeCandidate(state, deferred.receivedAt, true);
    return;
  }
  applyBridgeAccessStarted(deferred, true);
}

function applyBridgeMessage(message: LocationBridgeEnvelope): void {
  if (!authEpoch || message.authEpoch !== authEpoch) return;
  if (!isCompatibleBridgeProtocol(message.wireMajor, message.wireMinor)) {
    bridgeRejected = true;
    disableBridge();
    return;
  }
  if (message.workerInstanceId === workerInstanceId) return;
  if (message.type === 'HELLO') {
    if (bridgeRejected) return;
    bridgeCompatible = true;
    announceBridgeStatus();
    publishBridge('HELLO');
    return;
  }
  if (!bridgeCompatible) return;
  if (message.type === 'CANCEL_MARKER' || message.type === 'CANCEL_ACK') {
    const marker = message.marker as LocationRecommendationCancelMarker | undefined;
    if (!marker) return;
    if (
      message.type === 'CANCEL_ACK' &&
      Number.isSafeInteger(marker.resultCancelEpoch) &&
      currentState.cancelMarker?.cancellationUUID === marker.cancellationUUID &&
      (marker.resultCancelEpoch as number) >= currentState.cancelMarker.expectedCancelEpoch
    ) {
      currentState = {
        ...currentState,
        cancelMarker: null,
        cancelEpoch: marker.resultCancelEpoch as number,
      };
      notifyPorts();
      return;
    }
    applyCancelMarker(marker, false);
    return;
  }
  if (message.type === 'ACCESS_STARTED') {
    const tabId = message.tabId;
    const accessEventId = message.accessEventId;
    const operationUUID = message.operationUUID;
    const accessSequence = message.accessSequence;
    const leaderEpoch = message.leaderEpoch;
    if (
      !validUuid(tabId) ||
      !validUuid(accessEventId) ||
      !validUuid(operationUUID) ||
      typeof accessSequence !== 'number' ||
      !Number.isSafeInteger(accessSequence) ||
      accessSequence < 1 ||
      typeof leaderEpoch !== 'number' ||
      !Number.isSafeInteger(leaderEpoch) ||
      leaderEpoch < 1 ||
      accessSequence < latestAccessSequence
    ) {
      return;
    }
    const event = { tabId, accessEventId, operationUUID, accessSequence, leaderEpoch };
    if (accessSequence === latestAccessSequence) return;
    latestAccessSequence = accessSequence;
    if (hasUnreservedLocalGrant()) {
      deferBridgeAccess(event);
      return;
    }
    applyBridgeAccessStarted(event, true);
    return;
  }
  if (message.type !== 'STATE_UPDATED') return;
  const remote = message.state as LocationRecommendationState | undefined;
  const candidate = remote?.candidate;
  if (
    !remote ||
    !candidate ||
    remote.authEpoch !== authEpoch ||
    !validUuid(candidate.accessEventId) ||
    !validUuid(candidate.operationUUID) ||
    !validUuid(candidate.requestId) ||
    !validUuid(candidate.scopeGeneration) ||
    !Number.isSafeInteger(candidate.accessSequence) ||
    candidate.accessSequence < 1 ||
    remote.accessSequence !== candidate.accessSequence ||
    !validUuid(remote.workerInstanceId) ||
    !Number.isSafeInteger(candidate.leaderEpoch) ||
    !Number.isSafeInteger(candidate.cancelEpoch) ||
    !validRegion(candidate.region) ||
    !validTracks(candidate.tracks) ||
    candidate.tracks.length < 1 ||
    !Number.isSafeInteger(remote.remainingTtlMs) ||
    remote.remainingTtlMs <= 0
  ) {
    return;
  }
  if (candidate.accessSequence < latestAccessSequence) return;
  const isNewerBridgeEvent = candidate.accessSequence > latestAccessSequence;
  if (
    candidate.accessSequence === latestAccessSequence &&
    deferredBridgeAccess &&
    (deferredBridgeAccess.accessEventId !== candidate.accessEventId ||
      deferredBridgeAccess.operationUUID !== candidate.operationUUID)
  ) {
    return;
  }
  latestAccessSequence = candidate.accessSequence;
  if (hasUnreservedLocalGrant()) {
    deferBridgeAccess(
      {
        tabId: remote.activeTabId ?? '',
        accessEventId: candidate.accessEventId,
        operationUUID: candidate.operationUUID,
        accessSequence: candidate.accessSequence,
        leaderEpoch: candidate.leaderEpoch,
      },
      remote,
    );
    return;
  }
  applyBridgeCandidate(remote, performance.now(), isNewerBridgeEvent);
}

try {
  bridge = new BroadcastChannel(LOCATION_RECOMMENDATION_BRIDGE_NAME);
  bridge.addEventListener('message', (event: MessageEvent<LocationBridgeEnvelope>) => {
    const value = event.data;
    if (!value || typeof value !== 'object') return;
    applyBridgeMessage(value);
  });
} catch {
  bridge = null;
}

function initializeBridge(): void {
  if (!bridge) {
    bridgeCompatible = false;
    announceBridgeStatus();
    return;
  }
  const envelope = makeEnvelope('HELLO');
  if (!envelope) return;
  try {
    bridge.postMessage(envelope);
    bridgeCompatible = false;
    setTimeout(() => {
      if (!bridgeRejected && !bridgeCompatible) {
        bridgeCompatible = true;
        announceBridgeStatus();
      }
    }, 100);
  } catch {
    disableBridge();
  }
}

function attachPort(port: MessagePort): void {
  port.addEventListener('message', (event: MessageEvent<WorkerClientMessage>) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'CONNECT') {
      if (
        message.protocolMajor !== LOCATION_RECOMMENDATION_PROTOCOL_MAJOR ||
        message.protocolMinor !== LOCATION_RECOMMENDATION_PROTOCOL_MINOR ||
        typeof message.authEpoch !== 'string' ||
        !message.authEpoch ||
        !validUuid(message.tabId)
      ) {
        post(port, { type: 'FEATURE_DISABLED', reason: 'protocol-mismatch' });
        return;
      }
      if (authEpoch && authEpoch !== message.authEpoch) {
        post(port, { type: 'FEATURE_DISABLED', reason: 'auth-epoch-mismatch' });
        return;
      }
      authEpoch = message.authEpoch;
      currentState = { ...currentState, authEpoch };
      const previous = ports.get(message.tabId);
      if (previous && previous.port !== port) previous.port.close();
      ports.set(message.tabId, {
        port,
        tabId: message.tabId,
        authEpoch: message.authEpoch,
        active: false,
        mapEligible: false,
        isMapRoute: false,
        mapEligibilityRevision: 0,
        heartbeatAt: performance.now(),
        grant: null,
        reservedAccessSequence: null,
      });
      if (!bridgeCompatible) initializeBridge();
      post(port, { type: 'BRIDGE_STATUS', compatible: bridgeCompatible });
      return;
    }
    if (message.type === 'BRIDGE_STATUS') {
      if (message.authEpoch !== authEpoch) return;
      if (!message.compatible) disableBridge();
      else {
        bridgeCompatible = true;
        announceBridgeStatus();
      }
      return;
    }
    const messageEpoch =
      'authEpoch' in message
        ? message.authEpoch
        : 'marker' in message
          ? message.marker.authEpoch
          : null;
    if (!matchesAuthEpoch(authEpoch, messageEpoch ?? '')) return;
    if (message.type === 'GET_STATE') {
      const snapshot = stateSnapshot();
      post(port, {
        type: currentState.accessEventId ? 'STATE_SNAPSHOT' : 'EMPTY_CACHE',
        requestId: message.requestId,
        state: snapshot,
      });
      return;
    }
    if (message.type === 'ACTIVATE') {
      const registration = ports.get(message.tabId);
      if (!registration || registration.port !== port || !bridgeCompatible) {
        post(port, { type: 'FEATURE_DISABLED', reason: 'activation-unavailable' });
        return;
      }
      if (!validUuid(message.accessEventId) || !validUuid(message.operationUUID)) return;
      const previousLeader = ports.get(currentState.activeTabId ?? '');
      if (previousLeader?.grant) {
        post(previousLeader.port, { type: 'LEADER_REVOKED', grant: previousLeader.grant });
        previousLeader.grant = null;
        previousLeader.active = false;
      }
      const isSameEvent =
        currentState.accessEventId === message.accessEventId &&
        currentState.operationUUID === message.operationUUID;
      const leaderEpoch = currentState.leaderEpoch + 1;
      const grant: WorkerGrant = {
        tabId: message.tabId,
        accessEventId: message.accessEventId,
        operationUUID: message.operationUUID,
        leaderEpoch,
        workerInstanceId,
      };
      registration.active = true;
      registration.heartbeatAt = performance.now();
      registration.grant = grant;
      registration.reservedAccessSequence = null;
      currentState = {
        ...(isSameEvent
          ? currentState
          : {
              ...currentState,
              status: null,
              requestId: null,
              region: null,
              tracks: [],
              scopeGeneration: null,
              cancelEpoch: null,
              remainingTtlMs: 0,
              candidate: null,
            }),
        authEpoch: message.authEpoch,
        activeTabId: message.tabId,
        leaderEpoch,
        accessEventId: message.accessEventId,
        operationUUID: message.operationUUID,
        accessSequence: isSameEvent ? currentState.accessSequence : null,
        phase: isSameEvent ? currentState.phase : 'NOT_STARTED',
        displayGrantedTabId: isSameEvent ? currentState.displayGrantedTabId : null,
        workerInstanceId,
      };
      notifyPorts();
      post(port, { type: 'LEADER_GRANTED', grant });
      return;
    }
    if (message.type === 'DEACTIVATE') {
      const registration = ports.get(message.tabId);
      if (registration?.port === port) {
        if (message.grant && !matchesWorkerGrant(registration.grant, message.grant)) return;
        registration.active = false;
        registration.mapEligible = false;
        registration.reservedAccessSequence = null;
        if (currentState.activeTabId === message.tabId) {
          if (registration.grant) {
            post(port, { type: 'LEADER_REVOKED', grant: registration.grant });
          }
          registration.grant = null;
          currentState = { ...currentState, activeTabId: null, displayGrantedTabId: null };
          notifyPorts();
          applyDeferredBridgeAccess();
        }
      }
      return;
    }
    if (message.type === 'HEARTBEAT') {
      const registration = ports.get(message.tabId);
      if (registration?.port === port && registration.authEpoch === authEpoch) {
        registration.heartbeatAt = performance.now();
      }
      return;
    }
    if (message.type === 'SET_MAP_ELIGIBILITY') {
      const registration = ports.get(message.tabId);
      if (registration?.port !== port) return;
      const isChanged = registration.mapEligible !== message.eligible;
      const didLeaveMapRoute = registration.isMapRoute && !message.isMapRoute;
      registration.mapEligible = message.eligible;
      registration.isMapRoute = message.isMapRoute;
      registration.mapEligibilityRevision = message.mapEligibilityRevision;
      if ((isChanged && !message.eligible) || didLeaveMapRoute) {
        if (
          currentState.activeTabId !== message.tabId &&
          currentState.displayGrantedTabId !== message.tabId
        ) {
          return;
        }
        if (hasUnclaimedReadyCandidate(currentState)) return;
        currentState = {
          ...currentState,
          displayGrantedTabId: null,
        };
        notifyPorts();
      }
      return;
    }
    if (message.type === 'VALIDATE_GRANT') {
      post(port, {
        type: 'GRANT_VALIDATED',
        requestId: message.requestId,
        valid: grantIsCurrent(message.grant, ports.get(message.grant.tabId)),
        grant: message.grant,
      });
      return;
    }
    if (message.type === 'CONFIRM_ACCESS_EVENT') {
      const registration = ports.get(message.grant.tabId);
      const reserved = Boolean(
        grantIsCurrent(message.grant, registration) &&
        Number.isSafeInteger(message.accessSequence) &&
        message.accessSequence > latestAccessSequence &&
        message.accessSequence > 0 &&
        registration?.reservedAccessSequence === null,
      );
      if (reserved && registration) {
        latestAccessSequence = message.accessSequence;
        registration.reservedAccessSequence = message.accessSequence;
        if (deferredBridgeAccess && deferredBridgeAccess.accessSequence <= message.accessSequence) {
          deferredBridgeAccess = null;
        }
        currentState = {
          ...currentState,
          accessSequence: message.accessSequence,
          candidate:
            currentState.candidate?.accessEventId === message.grant.accessEventId &&
            currentState.candidate.operationUUID === message.grant.operationUUID
              ? { ...currentState.candidate, accessSequence: message.accessSequence }
              : currentState.candidate,
        };
        notifyPorts();
        publishBridge('ACCESS_STARTED', {
          tabId: message.grant.tabId,
          accessEventId: message.grant.accessEventId,
          operationUUID: message.grant.operationUUID,
          leaderEpoch: message.grant.leaderEpoch,
          accessSequence: message.accessSequence,
          stateRevision,
        });
      }
      post(port, {
        type: 'ACCESS_EVENT_RESERVED',
        requestId: message.requestId,
        reserved,
        accessSequence: message.accessSequence,
      });
      return;
    }
    if (message.type === 'SET_PHASE') {
      if (!grantIsCurrent(message.grant, ports.get(message.grant.tabId))) return;
      const allowed: Record<RecommendationPhase, RecommendationPhase[]> = {
        NOT_STARTED: ['SAMPLING'],
        SAMPLING: ['SAMPLED', 'ABORTED_UNKNOWN'],
        SAMPLED: ['REQUEST_SENT', 'ABORTED_UNKNOWN'],
        REQUEST_SENT: [],
        ABORTED_UNKNOWN: [],
      };
      if (!allowed[currentState.phase].includes(message.phase)) return;
      currentState = { ...currentState, phase: message.phase };
      post(port, { type: 'PHASE_UPDATED', grant: message.grant, phase: message.phase });
      notifyPorts();
      return;
    }
    if (message.type === 'UPDATE_RESULT') {
      const currentOperation = currentState.operationUUID;
      if (
        !grantIsCurrent(message.grant, ports.get(message.grant.tabId)) ||
        message.operationUUID !== currentOperation ||
        message.authEpoch !== authEpoch ||
        currentState.accessSequence === null ||
        !validUuid(message.result.requestId) ||
        !validUuid(message.result.scopeGeneration) ||
        !Number.isSafeInteger(message.result.cancelEpoch)
      ) {
        return;
      }
      const marker = currentState.cancelMarker;
      if (
        marker &&
        (marker.targetRequestId === message.result.requestId ||
          marker.targetRequestId === message.operationUUID) &&
        message.result.cancelEpoch < marker.expectedCancelEpoch
      ) {
        return;
      }
      const tracks = message.result.status === 'READY' ? (message.result.tracks ?? []) : [];
      if (
        message.result.status === 'READY' &&
        (!validRegion(message.result.region) || tracks.length < 1 || tracks.length > 5)
      ) {
        return;
      }
      const ttl = Math.max(0, message.result.remainingTtlMs ?? 0);
      currentState = {
        ...currentState,
        status: message.result.status,
        requestId: message.result.requestId,
        region: message.result.region,
        tracks: tracks.map((track) => ({ ...track })),
        scopeGeneration: message.result.scopeGeneration,
        cancelEpoch: message.result.cancelEpoch,
        remainingTtlMs: ttl,
        candidate:
          message.result.status === 'READY' && message.result.region && ttl > 0
            ? {
                authEpoch,
                accessEventId: currentState.accessEventId ?? '',
                operationUUID: message.operationUUID,
                accessSequence: currentState.accessSequence,
                leaderEpoch: currentState.leaderEpoch,
                requestId: message.result.requestId,
                region: { ...message.result.region },
                tracks: tracks.map((track) => ({ ...track })),
                recommendationMessage: message.result.recommendationMessage,
                scopeGeneration: message.result.scopeGeneration,
                cancelEpoch: message.result.cancelEpoch,
                remainingTtlMs: ttl,
                receivedAt: performance.now(),
                sourceWorkerInstanceId: workerInstanceId,
                sourceStateRevision: stateRevision + 1,
              }
            : null,
        displayGrantedTabId: null,
      };
      ttlStartedAt = performance.now();
      notifyPorts();
      return;
    }
    if (message.type === 'DISPLAY_CLAIM_RESULT') {
      const registration = ports.get(message.tabId);
      const snapshot = stateSnapshot();
      const candidate = snapshot.candidate;
      const allowed = Boolean(
        registration?.port === port &&
        registration.active &&
        registration.mapEligible &&
        message.authEpoch === authEpoch &&
        bridgeCompatible &&
        message.workerInstanceId === workerInstanceId &&
        message.accessEventId === currentState.accessEventId &&
        message.operationUUID === currentState.operationUUID &&
        message.stateRevision === currentState.stateRevision &&
        message.mapEligibilityRevision >= 0 &&
        registration.mapEligibilityRevision === message.mapEligibilityRevision &&
        candidate &&
        candidate.accessEventId === message.accessEventId &&
        candidate.operationUUID === message.operationUUID &&
        candidate.leaderEpoch === message.leaderEpoch &&
        (candidate.sourceWorkerInstanceId !== workerInstanceId ||
          currentState.activeTabId === message.tabId) &&
        candidate.requestId === message.claim.requestId &&
        currentState.status === 'READY' &&
        currentState.displayGrantedTabId === null &&
        currentState.cancelMarker === null &&
        message.claim.displayAllowed,
      );
      if (!allowed) {
        post(port, { type: 'DISPLAY_DENIED', requestId: message.requestId });
        return;
      }
      currentState = { ...currentState, displayGrantedTabId: message.tabId };
      notifyPorts();
      post(port, { type: 'DISPLAY_GRANTED', requestId: message.requestId, state: stateSnapshot() });
      return;
    }
    if (message.type === 'CANCEL_PENDING') {
      applyCancelMarker(message.marker);
      post(port, { type: 'CANCEL_APPLIED', marker: message.marker });
      return;
    }
    if (message.type === 'CLEAR_CANCEL_MARKER') {
      const marker = currentState.cancelMarker;
      if (
        marker &&
        marker.authEpoch === message.marker.authEpoch &&
        marker.cancellationUUID === message.marker.cancellationUUID &&
        (message.confirmedScopeGeneration !== marker.scopeGeneration ||
          message.confirmedCancelEpoch >= marker.expectedCancelEpoch)
      ) {
        currentState = {
          ...currentState,
          cancelMarker: null,
          cancelEpoch: message.confirmedCancelEpoch,
          scopeGeneration: message.confirmedScopeGeneration,
        };
        publishBridge('CANCEL_ACK', {
          marker: { ...marker, resultCancelEpoch: message.confirmedCancelEpoch },
        });
        notifyPorts();
      }
      return;
    }
    if (message.type === 'AUTH_RESET') {
      if (!matchesAuthEpoch(authEpoch, message.authEpoch)) return;
      ports.forEach((registration) => registration.port.close());
      ports.clear();
      authEpoch = null;
      ttlStartedAt = 0;
      latestAccessSequence = 0;
      deferredBridgeAccess = null;
      currentState = resetLocationRecommendationState(currentState);
    }
  });
  port.start();
}

workerHost.onconnect = (event) => {
  const port = event.ports[0];
  if (!port) return;
  attachPort(port);
  if (!bridgeCompatible) initializeBridge();
};

setInterval(() => {
  const now = performance.now();
  let didChange = false;
  ports.forEach((registration, tabId) => {
    if (now - registration.heartbeatAt <= 20_000) return;
    ports.delete(tabId);
    registration.port.close();
    if (currentState.activeTabId === tabId) {
      currentState = {
        ...currentState,
        activeTabId: null,
        displayGrantedTabId: null,
        candidate: null,
        phase: currentState.phase === 'SAMPLING' ? 'ABORTED_UNKNOWN' : currentState.phase,
      };
      didChange = true;
    }
  });
  if (currentState.status === 'READY' && now - ttlStartedAt >= currentState.remainingTtlMs) {
    clearCandidate('EXPIRED');
    didChange = true;
  }
  if (didChange) notifyPorts();
}, 5_000);
