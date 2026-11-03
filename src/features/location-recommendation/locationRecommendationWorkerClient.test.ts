import { describe, expect, it, vi } from 'vitest';
import { LocationRecommendationWorkerClient } from './locationRecommendationWorkerClient';
import {
  hasUnclaimedReadyCandidate,
  isCompatibleBridgeProtocol,
  matchesAuthEpoch,
  matchesWorkerGrant,
  resetLocationRecommendationState,
  shouldAcceptBridgeAccessEvent,
  shouldAcceptBridgeCandidate,
  shouldAcceptDeferredBridgeAccessEvent,
  type LocationRecommendationState,
  type WorkerGrant,
} from './locationRecommendationTypes';

const grant: WorkerGrant = {
  tabId: '123e4567-e89b-42d3-a456-426614174000',
  accessEventId: '223e4567-e89b-42d3-a456-426614174001',
  operationUUID: '323e4567-e89b-42d3-a456-426614174002',
  leaderEpoch: 2,
  workerInstanceId: '423e4567-e89b-42d3-a456-426614174003',
};

const state: LocationRecommendationState = {
  authEpoch: 'auth-epoch',
  workerInstanceId: grant.workerInstanceId,
  stateRevision: 4,
  activeTabId: grant.tabId,
  leaderEpoch: grant.leaderEpoch,
  accessEventId: grant.accessEventId,
  operationUUID: grant.operationUUID,
  accessSequence: 4,
  phase: 'REQUEST_SENT',
  status: 'READY',
  requestId: '523e4567-e89b-42d3-a456-426614174004',
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
  scopeGeneration: '623e4567-e89b-42d3-a456-426614174005',
  cancelEpoch: 1,
  remainingTtlMs: 60_000,
  displayGrantedTabId: grant.tabId,
  cancelMarker: null,
  candidate: {
    authEpoch: 'auth-epoch',
    accessEventId: grant.accessEventId,
    operationUUID: grant.operationUUID,
    accessSequence: 4,
    leaderEpoch: grant.leaderEpoch,
    requestId: '523e4567-e89b-42d3-a456-426614174004',
    region: { regionId: 1, code: '11110', name: '종로구', sidoName: '서울특별시' },
    tracks: [],
    scopeGeneration: '623e4567-e89b-42d3-a456-426614174005',
    cancelEpoch: 1,
    remainingTtlMs: 60_000,
    receivedAt: 1,
    sourceWorkerInstanceId: grant.workerInstanceId,
    sourceStateRevision: 4,
  },
};

describe('worker ownership guards', () => {
  it('requires the current bridge minor before exchanging sequenced events', () => {
    expect(isCompatibleBridgeProtocol(1, 1)).toBe(true);
    expect(isCompatibleBridgeProtocol(1, 0)).toBe(false);
    expect(isCompatibleBridgeProtocol(2, 1)).toBe(false);
  });

  it('rejects stale bridge access events and candidates without comparing worker revisions', () => {
    const current = {
      accessEventId: '723e4567-e89b-42d3-a456-426614174006',
      operationUUID: '823e4567-e89b-42d3-a456-426614174007',
      accessSequence: 9,
    };
    const stale = {
      accessEventId: grant.accessEventId,
      operationUUID: grant.operationUUID,
      accessSequence: 8,
      sourceStateRevision: 99_999,
    };

    expect(shouldAcceptBridgeAccessEvent(current, stale)).toBe(false);
    expect(shouldAcceptBridgeCandidate(current, stale)).toBe(false);
    expect(shouldAcceptBridgeCandidate(current, current)).toBe(true);
    expect(shouldAcceptBridgeAccessEvent(current, { ...current, accessSequence: 10 })).toBe(true);
    expect(
      shouldAcceptBridgeAccessEvent(current, { ...current, accessEventId: grant.accessEventId }),
    ).toBe(false);
  });

  it('does not let an older bridge candidate replace a local event awaiting sequence confirmation', () => {
    const pendingLocalEvent = {
      accessEventId: '923e4567-e89b-42d3-a456-426614174008',
      operationUUID: 'a23e4567-e89b-42d3-a456-426614174009',
      accessSequence: null,
    };
    const previousCandidate = {
      accessEventId: grant.accessEventId,
      operationUUID: grant.operationUUID,
      accessSequence: 4,
    };

    expect(shouldAcceptBridgeCandidate(pendingLocalEvent, previousCandidate)).toBe(false);
    expect(
      shouldAcceptBridgeCandidate(pendingLocalEvent, {
        ...pendingLocalEvent,
        accessSequence: 5,
      }),
    ).toBe(true);
  });

  it('applies the deferred winning event after the unreserved local tab deactivates', () => {
    const localLoser = {
      accessEventId: '923e4567-e89b-42d3-a456-426614174008',
      operationUUID: 'a23e4567-e89b-42d3-a456-426614174009',
      accessSequence: null,
    };
    const deferredWinner = {
      accessEventId: 'b23e4567-e89b-42d3-a456-426614174010',
      operationUUID: 'c23e4567-e89b-42d3-a456-426614174011',
      accessSequence: 5,
    };

    expect(shouldAcceptDeferredBridgeAccessEvent(localLoser, deferredWinner, 5)).toBe(true);
    expect(shouldAcceptDeferredBridgeAccessEvent(localLoser, deferredWinner, 4)).toBe(false);
  });

  it('accepts auth reset only for the matching epoch and clears cached recommendation data', () => {
    expect(matchesAuthEpoch('auth-epoch', 'auth-epoch')).toBe(true);
    expect(matchesAuthEpoch('auth-epoch', 'another-epoch')).toBe(false);
    expect(matchesAuthEpoch(null, 'auth-epoch')).toBe(false);

    const reset = resetLocationRecommendationState(state);
    expect(reset).toMatchObject({
      authEpoch: '',
      activeTabId: null,
      accessEventId: null,
      accessSequence: null,
      operationUUID: null,
      status: null,
      requestId: null,
      tracks: [],
      candidate: null,
      cancelMarker: null,
    });
  });

  it('retains an unclaimed READY candidate while map eligibility is unavailable', () => {
    expect(hasUnclaimedReadyCandidate(state)).toBe(false);
    expect(
      hasUnclaimedReadyCandidate({
        ...state,
        displayGrantedTabId: null,
        candidate: { ...state.candidate!, tracks: [] },
      }),
    ).toBe(true);
    expect(
      hasUnclaimedReadyCandidate({ ...state, displayGrantedTabId: null, status: 'PROCESSING' }),
    ).toBe(false);
  });

  it('matches a grant only when every ownership field still agrees', () => {
    expect(matchesWorkerGrant(grant, grant)).toBe(true);
    expect(matchesWorkerGrant(grant, { ...grant, leaderEpoch: grant.leaderEpoch + 1 })).toBe(false);
    expect(
      matchesWorkerGrant(grant, {
        ...grant,
        operationUUID: '523e4567-e89b-42d3-a456-426614174004',
      }),
    ).toBe(false);
    expect(matchesWorkerGrant(null, grant)).toBe(false);
  });

  it('includes the expected grant in stale deactivation requests', () => {
    const client = new LocationRecommendationWorkerClient(grant.tabId, 'auth-epoch', {
      onState: vi.fn(),
      onGrant: vi.fn(),
      onGrantRevoked: vi.fn(),
      onDisabled: vi.fn(),
      onBridgeStatus: vi.fn(),
    });
    const postMessage = vi.fn();
    (client as unknown as { port: Pick<MessagePort, 'postMessage'> | null }).port = {
      postMessage,
    };

    client.deactivate(grant);

    expect(postMessage).toHaveBeenCalledWith({
      type: 'DEACTIVATE',
      tabId: grant.tabId,
      authEpoch: 'auth-epoch',
      grant,
    });
  });

  it('fans out only the coordinate-free cancellation tombstone to the worker', () => {
    const client = new LocationRecommendationWorkerClient(grant.tabId, 'auth-epoch', {
      onState: vi.fn(),
      onGrant: vi.fn(),
      onGrantRevoked: vi.fn(),
      onDisabled: vi.fn(),
      onBridgeStatus: vi.fn(),
    });
    const postMessage = vi.fn();
    (client as unknown as { port: Pick<MessagePort, 'postMessage'> | null }).port = {
      postMessage,
    };
    const marker = {
      authEpoch: 'auth-epoch',
      scopeGeneration: state.scopeGeneration as string,
      cancellationUUID: '723e4567-e89b-42d3-a456-426614174006',
      targetRequestId: state.requestId as string,
      expectedCancelEpoch: state.cancelEpoch as number,
      createdAt: 1,
    };

    client.cancelPending(marker);

    expect(postMessage).toHaveBeenCalledWith({ type: 'CANCEL_PENDING', marker });
    expect(marker).not.toHaveProperty('latitude');
    expect(marker).not.toHaveProperty('longitude');
  });
});
