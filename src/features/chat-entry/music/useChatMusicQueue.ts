import { useEffect, useState, useSyncExternalStore } from 'react';
import { ChatMusicQueueController } from './chatMusicQueueController';
import type { ChatMusicEvent, ChatMusicSession } from './chatMusicTypes';

export function useChatMusicQueue(
  session: ChatMusicSession,
  isReady: boolean,
  event?: ChatMusicEvent,
) {
  const [controller] = useState(() => new ChatMusicQueueController(session));
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    controller.connect(session, isReady);
    return () => controller.pause();
  }, [controller, session, isReady]);
  useEffect(() => {
    controller.hint(event);
  }, [controller, event, isReady]);
  useEffect(() => {
    const online = () => controller.setNetworkAvailable(true);
    const offline = () => controller.setNetworkAvailable(false);
    const visible = () => {
      if (document.visibilityState === 'visible') controller.recover();
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [controller]);
  useEffect(() => () => controller.dispose(), [controller]);
  return { state, controller };
}
