export function isDirectAuthEnabled(env = import.meta.env): boolean {
  if (env.VITE_AUTH_DIRECT_V2_ENABLED !== 'true') return false;
  return (
    env.DEV === true ||
    (env.PROD === true &&
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
