import {
  LOCATION_RECOMMENDATION_BUILD_ID,
  LOCATION_RECOMMENDATION_PROTOCOL_MAJOR,
  LOCATION_RECOMMENDATION_PROTOCOL_MINOR,
  type LocationRecommendationCancelMarker,
  type LocationRecommendationDisplayClaim,
  type LocationRecommendationResult,
  type LocationRecommendationState,
  type WorkerClientMessage,
  type WorkerGrant,
  type WorkerServerMessage,
  type RecommendationPhase,
} from './locationRecommendationTypes';

type WorkerClientHandlers = {
  onState: (state: LocationRecommendationState, isInitial: boolean) => void;
  onGrant: (grant: WorkerGrant) => void;
  onGrantRevoked: (grant: WorkerGrant) => void;
  onDisabled: (reason: string) => void;
  onBridgeStatus: (compatible: boolean) => void;
};

type PendingGrant = {
  resolve: (grant: WorkerGrant) => void;
  reject: (reason: Error) => void;
  timer: number;
};

type PendingRequest<T> = {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  timer: number;
};

export function supportsLocationRecommendationPrimitives(): boolean {
  return (
    typeof SharedWorker === 'function' &&
    typeof BroadcastChannel === 'function' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.locks?.request === 'function'
  );
}

export class LocationRecommendationWorkerClient {
  private worker: SharedWorker | null = null;
  private port: MessagePort | null = null;
  private readonly pendingGrants = new Map<string, PendingGrant>();
  private readonly pendingValidation = new Map<string, PendingRequest<boolean>>();
  private readonly pendingAccessReservations = new Map<string, PendingRequest<boolean>>();
  private readonly pendingDisplay = new Map<
    string,
    PendingRequest<LocationRecommendationState | null>
  >();
  private isInitialSnapshot = true;
  private isClosed = false;
  private isBridgeCompatible = false;
  private mapEligibility = { eligible: false, isMapRoute: false, revision: 0 };
  private readonly bridgeWaiters = new Set<(compatible: boolean) => void>();
  readonly tabId: string;
  readonly authEpoch: string;
  private readonly handlers: WorkerClientHandlers;

  constructor(tabId: string, authEpoch: string, handlers: WorkerClientHandlers) {
    this.tabId = tabId;
    this.authEpoch = authEpoch;
    this.handlers = handlers;
  }

  connect(): boolean {
    if (!supportsLocationRecommendationPrimitives()) {
      this.handlers.onDisabled('required-browser-primitive-unavailable');
      return false;
    }
    try {
      this.worker = new SharedWorker(
        new URL('./locationRecommendation.worker.ts', import.meta.url),
        {
          type: 'module',
          name: `meomuneum:location-recommendation:${this.authEpoch}`,
        },
      );
      this.port = this.worker.port;
      this.port.addEventListener('message', this.handleMessage);
      this.port.start();
      this.registerPort();
      this.send({ type: 'GET_STATE', requestId: crypto.randomUUID(), authEpoch: this.authEpoch });
      return true;
    } catch {
      this.handlers.onDisabled('shared-worker-unavailable');
      this.close();
      return false;
    }
  }

  activate(accessEventId: string, operationUUID: string): Promise<WorkerGrant> {
    if (!this.port || this.isClosed) return Promise.reject(new Error('worker-unavailable'));
    return this.reconnectPort().then(() => {
      if (!this.port || this.isClosed || !this.isBridgeCompatible) {
        throw new Error('worker-unavailable');
      }
      return new Promise<WorkerGrant>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          this.pendingGrants.delete(accessEventId);
          reject(new Error('leader-grant-timeout'));
        }, 5_000);
        this.pendingGrants.set(accessEventId, { resolve, reject, timer });
        this.send({
          type: 'ACTIVATE',
          tabId: this.tabId,
          authEpoch: this.authEpoch,
          accessEventId,
          operationUUID,
        });
      });
    });
  }

  private async reconnectPort(): Promise<void> {
    const currentPort = this.port;
    currentPort?.removeEventListener('message', this.handleMessage);
    currentPort?.close();
    this.port = null;
    this.worker = null;
    this.isBridgeCompatible = false;
    this.bridgeWaiters.forEach((resolve) => resolve(false));
    this.bridgeWaiters.clear();
    this.worker = new SharedWorker(new URL('./locationRecommendation.worker.ts', import.meta.url), {
      type: 'module',
      name: `meomuneum:location-recommendation:${this.authEpoch}`,
    });
    this.port = this.worker.port;
    this.port.addEventListener('message', this.handleMessage);
    this.port.start();
    this.registerPort();
    this.send({ type: 'GET_STATE', requestId: crypto.randomUUID(), authEpoch: this.authEpoch });
    if (!(await this.waitForCompatibleBridge())) throw new Error('bridge-unavailable');
  }

  waitForCompatibleBridge(timeoutMs = 1_500): Promise<boolean> {
    if (this.isBridgeCompatible) return Promise.resolve(true);
    if (this.isClosed) return Promise.resolve(false);
    if (!this.port && !this.connect()) return Promise.resolve(false);
    return new Promise((resolve) => {
      let timer = 0;
      const waiter = (compatible: boolean) => {
        window.clearTimeout(timer);
        this.bridgeWaiters.delete(waiter);
        resolve(compatible);
      };
      this.bridgeWaiters.add(waiter);
      timer = window.setTimeout(() => {
        this.bridgeWaiters.delete(waiter);
        resolve(false);
      }, timeoutMs);
    });
  }

  validateGrant(grant: WorkerGrant): Promise<boolean> {
    return this.requestValidation(grant);
  }

  confirmAccessEvent(grant: WorkerGrant, accessSequence: number): Promise<boolean> {
    if (!this.port || this.isClosed) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = window.setTimeout(() => {
        this.pendingAccessReservations.delete(requestId);
        reject(new Error('access-event-reservation-timeout'));
      }, 2_000);
      this.pendingAccessReservations.set(requestId, { resolve, reject, timer });
      this.send({
        type: 'CONFIRM_ACCESS_EVENT',
        requestId,
        grant,
        authEpoch: this.authEpoch,
        accessSequence,
      });
    });
  }

  private requestValidation(grant: WorkerGrant): Promise<boolean> {
    if (!this.port || this.isClosed) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = window.setTimeout(() => {
        this.pendingValidation.delete(requestId);
        reject(new Error('leader-revalidation-timeout'));
      }, 2_000);
      this.pendingValidation.set(requestId, { resolve, reject, timer });
      this.send({ type: 'VALIDATE_GRANT', requestId, grant, authEpoch: this.authEpoch });
    });
  }

  setPhase(grant: WorkerGrant, phase: RecommendationPhase): void {
    this.send({ type: 'SET_PHASE', grant, phase, authEpoch: this.authEpoch });
  }

  updateResult(
    grant: WorkerGrant,
    operationUUID: string,
    result: LocationRecommendationResult,
  ): void {
    this.send({ type: 'UPDATE_RESULT', grant, operationUUID, result, authEpoch: this.authEpoch });
  }

  setMapEligibility(eligible: boolean, isMapRoute: boolean, mapEligibilityRevision: number): void {
    this.mapEligibility = { eligible, isMapRoute, revision: mapEligibilityRevision };
    this.sendMapEligibility();
  }

  private registerPort(): void {
    this.send({
      type: 'CONNECT',
      tabId: this.tabId,
      authEpoch: this.authEpoch,
      protocolMajor: LOCATION_RECOMMENDATION_PROTOCOL_MAJOR,
      protocolMinor: LOCATION_RECOMMENDATION_PROTOCOL_MINOR,
      buildId: LOCATION_RECOMMENDATION_BUILD_ID,
    });
    this.sendMapEligibility();
  }

  private sendMapEligibility(): void {
    this.send({
      type: 'SET_MAP_ELIGIBILITY',
      tabId: this.tabId,
      authEpoch: this.authEpoch,
      eligible: this.mapEligibility.eligible,
      isMapRoute: this.mapEligibility.isMapRoute,
      mapEligibilityRevision: this.mapEligibility.revision,
    });
  }

  requestDisplayGrant(input: {
    accessEventId: string;
    operationUUID: string;
    leaderEpoch: number;
    workerInstanceId: string;
    stateRevision: number;
    mapEligibilityRevision: number;
    claim: LocationRecommendationDisplayClaim;
  }): Promise<LocationRecommendationState | null> {
    if (!this.port || this.isClosed) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = window.setTimeout(() => {
        this.pendingDisplay.delete(requestId);
        reject(new Error('display-grant-timeout'));
      }, 2_000);
      this.pendingDisplay.set(requestId, { resolve, reject, timer });
      this.send({
        type: 'DISPLAY_CLAIM_RESULT',
        requestId,
        tabId: this.tabId,
        authEpoch: this.authEpoch,
        ...input,
      });
    });
  }

  cancelPending(marker: LocationRecommendationCancelMarker): void {
    this.send({ type: 'CANCEL_PENDING', marker });
  }

  clearCancelMarker(
    marker: LocationRecommendationCancelMarker,
    confirmedCancelEpoch: number,
    confirmedScopeGeneration: string,
  ): void {
    this.send({
      type: 'CLEAR_CANCEL_MARKER',
      marker,
      confirmedCancelEpoch,
      confirmedScopeGeneration,
    });
  }

  heartbeat(leaderEpoch: number): void {
    this.send({
      type: 'HEARTBEAT',
      tabId: this.tabId,
      authEpoch: this.authEpoch,
      leaderEpoch,
    });
  }

  deactivate(grant?: WorkerGrant): void {
    this.send({ type: 'DEACTIVATE', tabId: this.tabId, authEpoch: this.authEpoch, grant });
  }

  resetAuth(): void {
    this.send({ type: 'AUTH_RESET', authEpoch: this.authEpoch });
  }

  close(): void {
    this.isClosed = true;
    this.pendingGrants.forEach(({ reject, timer }) => {
      window.clearTimeout(timer);
      reject(new Error('worker-closed'));
    });
    this.pendingValidation.forEach(({ reject, timer }) => {
      window.clearTimeout(timer);
      reject(new Error('worker-closed'));
    });
    this.pendingAccessReservations.forEach(({ reject, timer }) => {
      window.clearTimeout(timer);
      reject(new Error('worker-closed'));
    });
    this.pendingDisplay.forEach(({ reject, timer }) => {
      window.clearTimeout(timer);
      reject(new Error('worker-closed'));
    });
    this.pendingGrants.clear();
    this.pendingValidation.clear();
    this.pendingAccessReservations.clear();
    this.pendingDisplay.clear();
    this.bridgeWaiters.forEach((resolve) => resolve(false));
    this.bridgeWaiters.clear();
    if (this.port) {
      this.port.removeEventListener('message', this.handleMessage);
      this.port.close();
      this.port = null;
    }
    this.worker = null;
  }

  private send(message: WorkerClientMessage): void {
    try {
      this.port?.postMessage(message);
    } catch {
      this.handlers.onDisabled('worker-communication-failed');
    }
  }

  private readonly handleMessage = (event: MessageEvent<WorkerServerMessage>) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'STATE_SNAPSHOT' || message.type === 'EMPTY_CACHE') {
      this.handlers.onState(message.state, this.isInitialSnapshot);
      this.isInitialSnapshot = false;
      return;
    }
    if (message.type === 'STATE_UPDATED') {
      this.handlers.onState(message.state, false);
      return;
    }
    if (message.type === 'LEADER_GRANTED') {
      const pending = this.pendingGrants.get(message.grant.accessEventId);
      if (pending) {
        window.clearTimeout(pending.timer);
        this.pendingGrants.delete(message.grant.accessEventId);
        pending.resolve(message.grant);
      }
      this.handlers.onGrant(message.grant);
      return;
    }
    if (message.type === 'LEADER_REVOKED') {
      this.handlers.onGrantRevoked(message.grant);
      return;
    }
    if (message.type === 'GRANT_VALIDATED') {
      const pending = this.pendingValidation.get(message.requestId);
      if (!pending) return;
      window.clearTimeout(pending.timer);
      this.pendingValidation.delete(message.requestId);
      pending.resolve(message.valid);
      return;
    }
    if (message.type === 'ACCESS_EVENT_RESERVED') {
      const pending = this.pendingAccessReservations.get(message.requestId);
      if (!pending) return;
      window.clearTimeout(pending.timer);
      this.pendingAccessReservations.delete(message.requestId);
      pending.resolve(message.reserved);
      return;
    }
    if (message.type === 'DISPLAY_GRANTED' || message.type === 'DISPLAY_DENIED') {
      const pending = this.pendingDisplay.get(message.requestId);
      if (!pending) return;
      window.clearTimeout(pending.timer);
      this.pendingDisplay.delete(message.requestId);
      pending.resolve(message.type === 'DISPLAY_GRANTED' ? message.state : null);
      return;
    }
    if (message.type === 'BRIDGE_STATUS') {
      this.isBridgeCompatible = message.compatible;
      this.handlers.onBridgeStatus(message.compatible);
      if (message.compatible) this.bridgeWaiters.forEach((resolve) => resolve(true));
      return;
    }
    if (message.type === 'FEATURE_DISABLED') {
      this.isBridgeCompatible = false;
      this.handlers.onDisabled(message.reason);
      this.handlers.onBridgeStatus(false);
      this.bridgeWaiters.forEach((resolve) => resolve(false));
    }
  };
}
