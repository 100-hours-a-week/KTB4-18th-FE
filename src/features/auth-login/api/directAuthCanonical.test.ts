import { expect, it } from 'vitest';
import { matchesCommittedLogout, matchesLiveLogin } from './directAuthCanonical';
import type { CurrentOperationLookup, TerminalOperationData } from './directAuthTypes';
const now = Date.now();
const source = { flowId: 'f', operationId: 'o', startingEpoch: '1', expiresAt: now + 10000 };
const terminal: TerminalOperationData = {
  flowId: 'f',
  operationId: 'o',
  startingEpoch: '1',
  status: 'SUCCEEDED',
  resultEpoch: '2',
  resultRevision: '3',
  reasonCode: null,
};
const current: CurrentOperationLookup = {
  flow: {
    flowId: 'f',
    flowEpoch: '2',
    revision: '3',
    authenticated: true,
    proofState: 'ACTIVE',
    lifecycle: 'AUTHENTICATED',
  },
  operation: {
    ...terminal,
    kind: 'LOGIN',
    clientExpiresAt: String(source.expiresAt),
    effectiveExpiresAt: String(source.expiresAt - 1),
    leaseExpiresAt: null,
    receiptExpiresAt: new Date(now + 10000).toISOString(),
  },
};
it('requires live exact canonical proof and terminal identity before token installation', () => {
  expect(matchesLiveLogin(current, source, terminal, now)).toBe(true);
  for (const changed of [
    { flowId: 'other' },
    { operationId: 'other' },
    { startingEpoch: '2' },
    { kind: 'REFRESH' },
    { resultEpoch: '3' },
    { resultRevision: '4' },
    { status: 'IN_PROGRESS' },
    { clientExpiresAt: String(source.expiresAt + 1) },
    { clientExpiresAt: null, effectiveExpiresAt: null },
    { effectiveExpiresAt: String(now) },
    { receiptExpiresAt: new Date(now).toISOString() },
  ])
    expect(
      matchesLiveLogin(
        {
          ...current,
          operation: { ...current.operation!, ...changed } as NonNullable<
            CurrentOperationLookup['operation']
          >,
        },
        source,
        terminal,
        now,
      ),
    ).toBe(false);
  for (const changed of [
    { authenticated: false },
    { proofState: 'REBOOTSTRAP_REQUIRED' },
    { revision: '4' },
    { lifecycle: 'ANONYMOUS' },
  ]) {
    expect(
      matchesLiveLogin(
        { ...current, flow: { ...current.flow, ...changed } as CurrentOperationLookup['flow'] },
        source,
        terminal,
        now,
      ),
    ).toBe(false);
  }
});
it('requires a distinct anonymous logout canonical and committed exact receipt', () => {
  const logout: CurrentOperationLookup = {
    ...current,
    flow: { ...current.flow, authenticated: false, lifecycle: 'ANONYMOUS' },
    operation: { ...current.operation!, kind: 'LOGOUT' },
  };
  const receipt = {
    operationId: 'o',
    committed: true,
    flowEpoch: '2',
    revision: '3',
    completedAt: new Date(now).toISOString(),
  };
  expect(matchesCommittedLogout(logout, source, receipt, now)).toBe(true);
  expect(matchesCommittedLogout(current, source, receipt, now)).toBe(false);
  expect(matchesCommittedLogout(logout, source, { ...receipt, committed: false }, now)).toBe(false);
  expect(matchesCommittedLogout(logout, source, { ...receipt, revision: '4' }, now)).toBe(false);
});
