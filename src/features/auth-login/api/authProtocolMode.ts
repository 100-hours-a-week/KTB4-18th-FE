export function isDirectAuthEnabled(env = import.meta.env): boolean {
  if (env.MODE === 'test' && env.VITE_AUTH_DIRECT_V2_ENABLED === undefined) return false;
  if (env.VITE_AUTH_DIRECT_V2_ENABLED === 'false') return false;
  return (
    (env.DEV === true && env.VITE_AUTH_DIRECT_V2_ENABLED !== 'false') ||
    (env.PROD === true &&
      env.VITE_AUTH_DIRECT_V2_ENABLED === 'true' &&
      env.VITE_AUTH_DIRECT_V2_REFRESH_VERIFIED === 'true' &&
      env.VITE_AUTH_DIRECT_V2_SOURCE_RECOVERY_VERIFIED === 'true' &&
      env.VITE_AUTH_DIRECT_V2_REBOOTSTRAP_VERIFIED === 'true')
  );
}

export function isDirectRefreshVerified(env = import.meta.env): boolean {
  return isDirectAuthEnabled(env) && env.VITE_AUTH_DIRECT_V2_REFRESH_VERIFIED === 'true';
}

export function isDirectSourceRecoveryVerified(env = import.meta.env): boolean {
  return isDirectAuthEnabled(env) && env.VITE_AUTH_DIRECT_V2_SOURCE_RECOVERY_VERIFIED === 'true';
}

export function isDirectRebootstrapVerified(env = import.meta.env): boolean {
  return isDirectAuthEnabled(env) && env.VITE_AUTH_DIRECT_V2_REBOOTSTRAP_VERIFIED === 'true';
}
