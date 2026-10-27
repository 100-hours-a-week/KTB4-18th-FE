import type { ProxyOptions } from 'vite';

// Match Chat routes before the Core catch-all, mirroring the public path-based routing.
export function createChatDevProxy(
  coreTarget: string,
  chatTarget = coreTarget,
): Record<string, ProxyOptions> {
  return {
    '/ws': { target: chatTarget, changeOrigin: true, ws: true },
    '^/api/v1/chat-rooms(?:/|\\?|$)': { target: chatTarget, changeOrigin: true },
    '^/api/v1/regions/[^/?]+/chat-room(?:\\?|$)': { target: chatTarget, changeOrigin: true },
    '/api': { target: coreTarget, changeOrigin: true },
  };
}
