export type ExpiryFields = {
  clientExpiresAt: string | null;
  effectiveExpiresAt: string | null;
};

export function isSafeExpiry(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]*$/.test(value) &&
    (value.length < 16 || (value.length === 16 && value <= '9007199254740991'))
  );
}

export function validExpiryState(route: string, status: number, data: unknown): boolean {
  if (!data || typeof data !== 'object') return true;
  const root = data as Record<string, unknown>;
  const value = route === 'currentOperation' ? root.operation : root;
  if (!value || typeof value !== 'object') return true;
  if (
    !(route === 'currentOperation' && status === 200) &&
    !(
      ['refreshRecoveryStatus', 'refreshRecoveryCurrent'].includes(route) &&
      (status === 200 || (status === 409 && root.status === 'LEASE_EXPIRED'))
    )
  )
    return true;
  const item = value as Record<string, unknown>;
  const bothNull = item.clientExpiresAt === null && item.effectiveExpiresAt === null;
  const bothValid = isSafeExpiry(item.clientExpiresAt) && isSafeExpiry(item.effectiveExpiresAt);
  if (route === 'currentOperation' && item.kind !== 'REFRESH') return bothNull;
  if (['NONE', 'NOT_RECEIVED', 'EXPIRED'].includes(String(item.status))) return bothNull;
  return bothNull || (bothValid && Number(item.effectiveExpiresAt) <= Number(item.clientExpiresAt));
}
