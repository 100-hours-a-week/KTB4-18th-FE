export const QUEUE_LOGOUT_PENDING_STORAGE = 'meomuneum:queue-logout-pending';
export const LOGOUT_CLEANUP_STATE_CHANGED_EVENT = 'meomuneum:logout-cleanup-state-changed';

const LOGOUT_CLEANUP_CHANNEL = 'meomuneum:logout-cleanup-state';
const PENDING_VALUE = 'pending';

type CleanupMessage = { type: 'pending' | 'complete' };

let cleanupPendingInMemory = false;
let cleanupChannel: BroadcastChannel | null = null;

function emitState(pending: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(LOGOUT_CLEANUP_STATE_CHANGED_EVENT, { detail: { pending } }),
  );
}

function postMessage(message: CleanupMessage): void {
  try {
    cleanupChannel?.postMessage(message);
  } catch {
    // The local gate remains authoritative when peer notification is unavailable.
  }
}

function persistSessionPending(): void {
  try {
    window.sessionStorage.setItem(QUEUE_LOGOUT_PENDING_STORAGE, PENDING_VALUE);
  } catch {
    // The in-memory gate protects this document until cleanup completes.
  }
}

function markPendingFromPeer(): void {
  cleanupPendingInMemory = true;
  persistSessionPending();
  emitState(true);
}

function acknowledgePeerCompletion(): void {
  try {
    if (window.localStorage.getItem(QUEUE_LOGOUT_PENDING_STORAGE) === PENDING_VALUE) return;
    window.sessionStorage.removeItem(QUEUE_LOGOUT_PENDING_STORAGE);
    cleanupPendingInMemory = false;
    emitState(false);
  } catch {
    cleanupPendingInMemory = true;
    emitState(true);
  }
}

if (typeof window !== 'undefined') {
  try {
    if (typeof BroadcastChannel === 'function') {
      cleanupChannel = new BroadcastChannel(LOGOUT_CLEANUP_CHANNEL);
      cleanupChannel.addEventListener('message', (event: MessageEvent<CleanupMessage>) => {
        if (event.data?.type === 'pending') markPendingFromPeer();
        if (event.data?.type === 'complete') acknowledgePeerCompletion();
      });
    }
  } catch {
    cleanupChannel = null;
  }

  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== QUEUE_LOGOUT_PENDING_STORAGE) return;
    if (event.newValue === PENDING_VALUE) markPendingFromPeer();
    else if (event.newValue === null) acknowledgePeerCompletion();
  });
}

export function beginLogoutCleanupGate(): void {
  cleanupPendingInMemory = true;
  try {
    window.localStorage.setItem(QUEUE_LOGOUT_PENDING_STORAGE, PENDING_VALUE);
  } catch {
    // Keep the synchronous latch set even when persistent storage is unavailable.
  }
  persistSessionPending();
  postMessage({ type: 'pending' });
  emitState(true);
}

export function isLogoutCleanupPending(): boolean {
  if (cleanupPendingInMemory) return true;
  try {
    const localPending = window.localStorage.getItem(QUEUE_LOGOUT_PENDING_STORAGE);
    const sessionPending = window.sessionStorage.getItem(QUEUE_LOGOUT_PENDING_STORAGE);
    if (localPending === PENDING_VALUE || sessionPending === PENDING_VALUE) {
      cleanupPendingInMemory = true;
      return true;
    }
    return false;
  } catch {
    cleanupPendingInMemory = true;
    return true;
  }
}

export function completeLogoutCleanupGate(): void {
  try {
    window.localStorage.removeItem(QUEUE_LOGOUT_PENDING_STORAGE);
    window.sessionStorage.removeItem(QUEUE_LOGOUT_PENDING_STORAGE);
  } catch {
    cleanupPendingInMemory = true;
    emitState(true);
    throw new Error('Logout cleanup state could not be cleared');
  }
  cleanupPendingInMemory = false;
  postMessage({ type: 'complete' });
  emitState(false);
}

export function resetLogoutCleanupGateForTests(): void {
  cleanupPendingInMemory = false;
  try {
    window.localStorage.removeItem(QUEUE_LOGOUT_PENDING_STORAGE);
    window.sessionStorage.removeItem(QUEUE_LOGOUT_PENDING_STORAGE);
  } catch {
    // Test cleanup must not mask a storage-failure scenario.
  }
}
