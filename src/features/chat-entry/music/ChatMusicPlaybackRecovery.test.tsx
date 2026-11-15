import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatMusicPanel } from './ChatMusicPanel';
import { authenticatedFetchWithCurrentToken } from '../../auth-login/api/authSession';
import { loadYouTubeApi, type YouTubeOptions, type YouTubePlayer } from './youtubeIframe';
import {
  deferred,
  musicResponse,
  musicSession,
  musicToken,
  queuePage,
} from './chatMusicTestHelpers';

vi.mock('../../auth-login/api/authSession', async (original) => ({
  ...(await original<typeof import('../../auth-login/api/authSession')>()),
  getAccessToken: () => musicToken(),
  authenticatedFetchWithCurrentToken: vi.fn(),
}));
vi.mock('./youtubeIframe', () => ({ loadYouTubeApi: vi.fn() }));
let api: YouTubePlayer;
let instances: number;
const snapshot = (version = 1) => ({
  ...queuePage(version),
  source_video_id: 'abcdefghijk',
  duration_millis: 120000,
});
beforeEach(() => {
  vi.stubEnv('VITE_CHAT_MUSIC_QUEUE_ENABLED', 'true');
  vi.stubEnv('VITE_CHAT_MUSIC_PLAYER_ENABLED', 'true');
  instances = 0;
  api = {
    loadVideoById: vi.fn(),
    cueVideoById: vi.fn(),
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    stopVideo: vi.fn(),
    seekTo: vi.fn(),
    getCurrentTime: () => 1,
    getPlayerState: () => 1,
    setVolume: vi.fn(),
    mute: vi.fn(),
    unMute: vi.fn(),
    destroy: vi.fn(),
  };
  class Player {
    constructor(element: HTMLElement, options: YouTubeOptions) {
      instances++;
      const frame = document.createElement('iframe');
      frame.title = 'test player';
      element.replaceWith(frame);
      queueMicrotask(() => options.events.onReady({ target: api }));
      return api;
    }
  }
  vi.mocked(loadYouTubeApi).mockResolvedValue({
    Player: Player as unknown as import('./youtubeIframe').YouTubeApi['Player'],
  });
  vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValue(musicResponse(snapshot()));
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it('keeps the same iframe during foreground refresh and destroys it when transport ownership ends', async () => {
  const props = { session: musicSession(), isReady: true, request: { sequence: 0, query: '' } };
  const { container, rerender } = render(<ChatMusicPanel {...props} />);
  await waitFor(() => expect(api.loadVideoById).toHaveBeenCalledTimes(1));
  const frame = container.querySelector('.chat-room-youtube iframe');
  const pending = deferred<Response>();
  vi.mocked(authenticatedFetchWithCurrentToken).mockReturnValueOnce(pending.promise);
  fireEvent(document, new Event('visibilitychange'));
  expect(container.querySelector('.chat-room-youtube iframe')).toBe(frame);
  expect(api.destroy).not.toHaveBeenCalled();
  expect(container.querySelector('.chat-now-playing-controls button')).toBeDisabled();
  await act(async () => {
    pending.resolve(musicResponse(snapshot(2)));
    await pending.promise;
  });
  await waitFor(() =>
    expect(container.querySelector('.chat-now-playing-controls button')).toBeEnabled(),
  );
  expect(instances).toBe(1);
  expect(api.destroy).not.toHaveBeenCalled();
  expect(api.loadVideoById).toHaveBeenCalledTimes(1);
  rerender(<ChatMusicPanel {...props} isReady={false} />);
  expect(api.destroy).toHaveBeenCalledTimes(1);
});
