import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { YouTubeApi } from './youtubeIframe';
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
});
afterEach(() => {
  vi.useRealTimers();
  document
    .querySelectorAll('script[src="https://www.youtube.com/iframe_api"]')
    .forEach((s) => s.remove());
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
});
it('shares one script, chains the existing ready callback and restores it', async () => {
  const { loadYouTubeApi } = await import('./youtubeIframe');
  const previous = vi.fn();
  window.onYouTubeIframeAPIReady = previous;
  const a = loadYouTubeApi(),
    b = loadYouTubeApi();
  expect(a).toBe(b);
  expect(
    document.querySelectorAll('script[src="https://www.youtube.com/iframe_api"]'),
  ).toHaveLength(1);
  const api = { Player: vi.fn() } as unknown as YouTubeApi;
  window.YT = api;
  window.onYouTubeIframeAPIReady!();
  expect(await a).toBe(api);
  expect(previous).toHaveBeenCalledOnce();
  expect(window.onYouTubeIframeAPIReady).toBe(previous);
});
it('removes a failed script and allows an explicit retry after the load deadline', async () => {
  const { loadYouTubeApi } = await import('./youtubeIframe');
  const failed = loadYouTubeApi();
  const check = expect(failed).rejects.toThrow('timeout');
  await vi.advanceTimersByTimeAsync(15000);
  await check;
  expect(document.querySelector('script[src="https://www.youtube.com/iframe_api"]')).toBeNull();
  const retry = loadYouTubeApi();
  const checkRetry = expect(retry).rejects.toThrow('unavailable');
  document
    .querySelector('script[src="https://www.youtube.com/iframe_api"]')!
    .dispatchEvent(new Event('error'));
  await checkRetry;
});
