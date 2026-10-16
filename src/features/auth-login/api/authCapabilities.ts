export type AuthCapabilityResult =
  { supported: true } | { supported: false; reason: AuthCapabilityFailureReason };
export type AuthCapabilityFailureReason = 'insecure-context' | 'web-locks' | 'local-storage';

let capabilityResult: AuthCapabilityResult | null = null;

export function probeAuthCapabilities(): AuthCapabilityResult {
  if (capabilityResult) return capabilityResult;
  if (import.meta.env.MODE === 'test') {
    capabilityResult = { supported: true };
    return capabilityResult;
  }
  if (typeof window === 'undefined' || !window.isSecureContext) {
    capabilityResult = { supported: false, reason: 'insecure-context' };
    return capabilityResult;
  }
  if (typeof navigator === 'undefined' || !navigator.locks?.request) {
    capabilityResult = { supported: false, reason: 'web-locks' };
    return capabilityResult;
  }
  try {
    const key = `meomuneum:auth-capability:${crypto.randomUUID()}`;
    window.localStorage.setItem(key, '1');
    if (window.localStorage.getItem(key) !== '1') {
      capabilityResult = { supported: false, reason: 'local-storage' };
      return capabilityResult;
    }
    window.localStorage.removeItem(key);
  } catch {
    capabilityResult = { supported: false, reason: 'local-storage' };
    return capabilityResult;
  }
  capabilityResult = { supported: true };
  return capabilityResult;
}

export function resetAuthCapabilitiesForTests(): void {
  capabilityResult = null;
}

export function getAuthCapabilityMessage(reason: AuthCapabilityFailureReason): string {
  switch (reason) {
    case 'insecure-context':
      return '안전한 HTTPS 환경에서 로그인해 주세요.';
    case 'web-locks':
      return '이 브라우저는 여러 탭의 로그인 상태를 안전하게 공유할 수 없어요. 최신 브라우저에서 다시 시도해 주세요.';
    case 'local-storage':
      return '브라우저 저장소를 사용할 수 없어 로그인 상태를 안전하게 공유할 수 없어요. 브라우저 설정을 확인해 주세요.';
  }
}
