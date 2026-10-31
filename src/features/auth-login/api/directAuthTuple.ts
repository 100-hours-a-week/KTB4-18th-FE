export function matchesDirectAuthTuple(
  value: unknown,
  tuple:
    | { flowId: string; startingEpoch: string; operationId?: string; recoveryOperationId?: string }
    | undefined,
  route: string,
): boolean {
  if (!value || typeof value !== 'object') return true;
  const data = value as Record<string, unknown>;
  if (route === 'currentOperation' && data.flow && typeof data.flow === 'object') {
    const flow = data.flow as { flowId: unknown };
    if (tuple && flow.flowId !== tuple.flowId) return false;
    if (data.operation && typeof data.operation === 'object') {
      const operation = data.operation as {
        flowId: unknown;
        operationId: unknown;
        startingEpoch: unknown;
      };
      if (operation.flowId !== flow.flowId) return false;
      if (
        tuple &&
        tuple.operationId === operation.operationId &&
        operation.startingEpoch !== tuple.startingEpoch
      )
        return false;
    }
  }
  if (!tuple) return true;
  for (const key of ['flowId', 'startingEpoch', 'operationId', 'recoveryOperationId'] as const) {
    if (
      data[key] !== undefined &&
      data[key] !== null &&
      tuple[key] !== undefined &&
      data[key] !== tuple[key]
    )
      return false;
  }
  if (
    route === 'rebootstrap' &&
    data.flow &&
    typeof data.flow === 'object' &&
    (data.flow as { flowId?: unknown }).flowId !== tuple.flowId
  )
    return false;
  if (
    route === 'logout' &&
    data.logoutReceipt &&
    typeof data.logoutReceipt === 'object' &&
    tuple.operationId &&
    (data.logoutReceipt as { operationId?: unknown }).operationId !== tuple.operationId
  )
    return false;
  return true;
}
