import { consumeLogoutQueueReset } from './loginQueuePersistence';

export const QUEUE_FLOW_LOCK = 'meomuneum:queue-flow';
const QUEUE_CHANNEL = 'meomuneum:queue-state';

export type QueueSignal = {
  type:
    | 'queue-login-complete'
    | 'queue-attempt-consumed'
    | 'queue-cancel-requested'
    | 'queue-cancel-unconfirmed'
    | 'queue-create-cancelled'
    | 'queue-logout-reset';
  queueGeneration: string;
  resetEventId?: string;
};

let activeCreateController: AbortController | null = null;

export function registerActiveCreateController(controller: AbortController): void {
  activeCreateController = controller;
}

export function clearActiveCreateController(controller: AbortController): void {
  if (activeCreateController === controller) activeCreateController = null;
}

export function abortActiveCreate(): void {
  activeCreateController?.abort();
}

export function publishQueueSignal(signal: QueueSignal): void {
  try {
    const channel = new BroadcastChannel(QUEUE_CHANNEL);
    channel.postMessage(signal);
    channel.close();
  } catch {
    try {
      localStorage.setItem(
        `meomuneum:queue-signal:${signal.queueGeneration}`,
        JSON.stringify(signal),
      );
      localStorage.removeItem(`meomuneum:queue-signal:${signal.queueGeneration}`);
    } catch {
      // Peers can still observe the shared queue status on their next poll.
    }
  }
}

export function subscribeQueueSignals(handler: (signal: QueueSignal) => void): () => void {
  const deliver = (signal: QueueSignal) => {
    if (signal.type === 'queue-cancel-requested' || signal.type === 'queue-create-cancelled') {
      abortActiveCreate();
    }
    if (signal.type === 'queue-logout-reset') {
      if (!consumeLogoutQueueReset(signal.resetEventId, signal.queueGeneration)) return;
      abortActiveCreate();
    }
    handler(signal);
  };
  const onStorage = (event: StorageEvent) => {
    if (!event.key?.startsWith('meomuneum:queue-signal:') || !event.newValue) return;
    try {
      deliver(JSON.parse(event.newValue) as QueueSignal);
    } catch {
      // Ignore malformed same-origin events.
    }
  };
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(QUEUE_CHANNEL);
    channel.addEventListener('message', (event: MessageEvent<QueueSignal>) => deliver(event.data));
  } catch {
    channel = null;
  }
  window.addEventListener('storage', onStorage);
  return () => {
    channel?.close();
    window.removeEventListener('storage', onStorage);
  };
}
