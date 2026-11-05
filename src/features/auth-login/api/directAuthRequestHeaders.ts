import type { DirectAuthRoute } from './directAuthHttp';

export const headerNames: Partial<Record<DirectAuthRoute, string>> = {
  bootstrap: 'X-Auth-Flow-Operation-Id',
  login: 'X-Login-Operation-Id',
  refresh: 'X-Refresh-Operation-Id',
  logout: 'Idempotency-Key',
  rebootstrap: 'X-Auth-Rebootstrap-Operation-Id',
  refreshRecovery: 'X-Auth-Refresh-Recovery-Operation-Id',
};
