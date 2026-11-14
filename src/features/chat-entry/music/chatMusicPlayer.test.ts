import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMusicPlayer, playbackPosition } from './chatMusicPlayer';
import {
  loadYouTubeApi,
  type YouTubeApi,
  type YouTubeOptions,
  type YouTubePlayer,
} from './youtubeIframe';
import { parsePlayback } from './chatMusicTypes';
import { queuePage, queueItem, deferred } from './chatMusicTestHelpers';
vi.mock('./youtubeIframe', () => ({ loadYouTubeApi: vi.fn() }));
let options: YouTubeOptions;
let sdk: YouTubeApi;
let apiPlayer: YouTubePlayer;
let player: ChatMusicPlayer;
let currentTime: number, nativeState: number;
function snapshot(version = 1, state = 'PLAYING', item = 99) {
  return parsePlayback({
    ...queuePage(version),
    state,
    current: queueItem(item, 'PLAYING'),
    source_video_id: 'abcdefghijk',
    duration_millis: 120000,
    current_queue_item_id: item,
    position_seconds: 10,
    state_changed_at: '2026-11-09T05:00:00Z',
    server_time: '2026-11-09T05:00:05Z',
  })!;
}
const timed = (s = snapshot()) => ({ snapshot: s, receivedAt: performance.now() });
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  currentTime = 15;
  nativeState = 1;
  apiPlayer = {
    loadVideoById: vi.fn(),
    cueVideoById: vi.fn(),
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    stopVideo: vi.fn(),
    seekTo: vi.fn(),
    getCurrentTime: () => currentTime,
    getPlayerState: () => nativeState,
    setVolume: vi.fn(),
    mute: vi.fn(),
    unMute: vi.fn(),
    destroy: vi.fn(),
  };
  class Player {
    constructor(_element: HTMLElement, o: YouTubeOptions) {
      options = o;
      return apiPlayer;
    }
  }
  sdk = { Player: Player as unknown as YouTubeApi['Player'] };
  vi.mocked(loadYouTubeApi).mockResolvedValue(sdk);
  player = new ChatMusicPlayer();
  player.mount(document.createElement('div'));
});
afterEach(() => {
  player.dispose();
  vi.useRealTimers();
});
async function ready() {
  await settle();
  options.events.onReady({ target: apiPlayer });
}
describe('server-authoritative YouTube follower', () => {
  it('estimates from server time, ignores device clock jumps, freezes paused position and clamps duration', () => {
    const t = timed();
    expect(playbackPosition(t)).toBe(15);
    vi.setSystemTime(new Date('2040-01-01'));
    expect(playbackPosition(t)).toBe(15);
    vi.advanceTimersByTime(3000);
    expect(playbackPosition(t)).toBe(18);
    expect(playbackPosition(timed(snapshot(2, 'PAUSED')))).toBe(10);
    expect(playbackPosition(t, t.receivedAt + 999999)).toBe(120);
  });
  it('loads pinned source at the room position, corrects only drift over2s and consumes equal-version sync', async () => {
    player.update(timed(), true);
    await ready();
    expect(apiPlayer.loadVideoById).toHaveBeenCalledWith({
      videoId: 'abcdefghijk',
      startSeconds: 15,
    });
    currentTime = 14;
    player.tick();
    expect(apiPlayer.seekTo).not.toHaveBeenCalled();
    currentTime = 1;
    player.tick();
    expect(apiPlayer.seekTo).toHaveBeenLastCalledWith(15, true);
    const sync = { ...snapshot(), serverTime: '2026-11-09T05:00:20Z' };
    currentTime = 20;
    vi.advanceTimersByTime(5000);
    player.update(timed(sync), true);
    expect(apiPlayer.seekTo).toHaveBeenLastCalledWith(30, true);
    player.update(timed(snapshot(2, 'PAUSED')), true);
    expect(apiPlayer.pauseVideo).toHaveBeenCalled();
    expect(player.getSnapshot().position).toBe(10);
    player.update(timed(snapshot(3, 'PLAYING', 100)), true);
    expect(apiPlayer.loadVideoById).toHaveBeenCalledTimes(2);
  });
  it('cues PAUSED on join and never resumes it when the iframe is clicked', async () => {
    player.update(timed(snapshot(1, 'PAUSED')), true);
    await ready();
    expect(apiPlayer.cueVideoById).toHaveBeenCalledWith({
      videoId: 'abcdefghijk',
      startSeconds: 10,
    });
    expect(apiPlayer.loadVideoById).not.toHaveBeenCalled();
    options.events.onStateChange({ data: 1 });
    expect(apiPlayer.pauseVideo).toHaveBeenCalled();
    expect(apiPlayer.playVideo).not.toHaveBeenCalled();
  });
  it('retains local settings without reloading or pausing when the same room snapshot is reapplied', async () => {
    const value = timed();
    player.update(value, true);
    await ready();
    player.volume(23);
    player.mute();
    player.update(value, true);
    expect(player.getSnapshot()).toMatchObject({ volume: 23, isMuted: true });
    expect(apiPlayer.loadVideoById).toHaveBeenCalledTimes(1);
    expect(apiPlayer.cueVideoById).not.toHaveBeenCalled();
    expect(apiPlayer.pauseVideo).not.toHaveBeenCalled();
    expect(apiPlayer.destroy).not.toHaveBeenCalled();
  });
  it('offers blocked autoplay recovery, keeps volume/mute local, and never treats ENDED as a room command', async () => {
    player.update(timed(), true);
    await ready();
    nativeState = 2;
    options.events.onAutoplayBlocked();
    options.events.onStateChange({ data: 2 });
    expect(player.getSnapshot().status).toBe('blocked');
    vi.advanceTimersByTime(5000);
    expect(apiPlayer.playVideo).not.toHaveBeenCalled();
    player.volume(23);
    player.mute();
    expect(apiPlayer.setVolume).toHaveBeenLastCalledWith(23);
    expect(apiPlayer.mute).toHaveBeenCalled();
    expect(player.getSnapshot().status).toBe('blocked');
    player.allowPlayback();
    expect(apiPlayer.playVideo).toHaveBeenCalledTimes(1);
    options.events.onStateChange({ data: 0 });
    expect(player.getSnapshot().message).toContain('다음 곡');
    player.tick();
    expect(apiPlayer.loadVideoById).toHaveBeenCalledTimes(1);
  });
  it('shows video errors without skipping, recovers on a new track and ignores old callbacks after disconnect', async () => {
    player.update(timed(), true);
    await ready();
    options.events.onError({ data: 150 });
    expect(player.getSnapshot().status).toBe('error');
    player.tick();
    expect(apiPlayer.loadVideoById).toHaveBeenCalledTimes(1);
    player.update(timed(snapshot(2, 'PLAYING', 100)), true);
    expect(apiPlayer.loadVideoById).toHaveBeenCalledTimes(2);
    const old = options;
    player.update(null, false);
    expect(apiPlayer.destroy).toHaveBeenCalledTimes(1);
    old.events.onReady({ target: apiPlayer });
    old.events.onStateChange({ data: 1 });
    old.events.onError({ data: 100 });
    expect(player.getSnapshot().status).toBe('waiting');
  });
  it('does not create a player for missing pin/IDLE and drops a late SDK load on exit', async () => {
    player.update(timed(parsePlayback(queuePage())!), true);
    expect(loadYouTubeApi).not.toHaveBeenCalled();
    const late = deferred<import('./youtubeIframe').YouTubeApi>();
    vi.mocked(loadYouTubeApi).mockReturnValue(late.promise);
    player.retry();
    player.dispose();
    late.resolve({ Player: vi.fn() as never });
    await settle();
    expect(player.getSnapshot().status).toBe('waiting');
  });
  it('keeps timeout retryable and retains personal settings across reconnect', async () => {
    player.update(timed(), true);
    await settle();
    await vi.advanceTimersByTimeAsync(30000);
    expect(player.getSnapshot().status).toBe('error');
    player.volume(0);
    player.mute();
    player.update(null, false);
    player.update(timed(snapshot(2)), true);
    await ready();
    expect(apiPlayer.setVolume).toHaveBeenLastCalledWith(0);
    expect(apiPlayer.mute).toHaveBeenCalled();
  });
});

it('passes a non-forcing caption hint without changing the other playback defaults', async () => {
  player.update(timed(), true);
  await settle();
  expect(options.playerVars).toMatchObject({
    cc_load_policy: 0,
    autoplay: 0,
    controls: 0,
    disablekb: 1,
  });
});

it('seeds the latest valid video during SDK bootstrap and waits for onReady before synchronized playback', async () => {
  const gate = deferred<YouTubeApi>();
  vi.mocked(loadYouTubeApi).mockReturnValue(gate.promise);
  player.update(timed(), true);
  const newer = snapshot(2, 'PLAYING', 100);
  newer.sourceVideoId = '12345678901';
  newer.current!.youtubeVideoId = '12345678901';
  player.update(timed(newer), true);
  gate.resolve(sdk);
  await settle();
  expect(options.videoId).toBe('12345678901');
  expect(options.playerVars.autoplay).toBe(0);
  expect(apiPlayer.loadVideoById).not.toHaveBeenCalled();
  await ready();
  expect(apiPlayer.loadVideoById).toHaveBeenCalledWith({
    videoId: '12345678901',
    startSeconds: 15,
  });
  expect(apiPlayer.cueVideoById).not.toHaveBeenCalled();
});

it('reconnects once on readiness timeout, preserving settings and rejecting stale callbacks', async () => {
  player.volume(23);
  player.mute();
  player.update(timed(), true);
  await settle();
  const first = options;
  await vi.advanceTimersByTimeAsync(15000);
  expect(apiPlayer.destroy).toHaveBeenCalledTimes(1);
  expect(loadYouTubeApi).toHaveBeenCalledTimes(2);
  expect(player.getSnapshot().status).toBe('loading');
  first.events.onReady({ target: apiPlayer });
  first.events.onError({ data: 150 });
  expect(apiPlayer.loadVideoById).not.toHaveBeenCalled();
  await ready();
  expect(apiPlayer.setVolume).toHaveBeenLastCalledWith(23);
  expect(apiPlayer.mute).toHaveBeenCalled();
  expect(apiPlayer.loadVideoById).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60000);
  expect(loadYouTubeApi).toHaveBeenCalledTimes(2);
});

it('limits readiness recovery and cancels retry when readiness or ownership ends', async () => {
  player.update(timed(), true);
  await settle();
  await vi.advanceTimersByTimeAsync(30000);
  expect(loadYouTubeApi).toHaveBeenCalledTimes(2);
  expect(player.getSnapshot().status).toBe('error');
  await vi.advanceTimersByTimeAsync(60000);
  expect(loadYouTubeApi).toHaveBeenCalledTimes(2);
  player.retry();
  await settle();
  expect(loadYouTubeApi).toHaveBeenCalledTimes(3);
  player.update(null, false);
  await vi.advanceTimersByTimeAsync(30000);
  expect(loadYouTubeApi).toHaveBeenCalledTimes(3);
  expect(player.getSnapshot().status).toBe('waiting');
});

it.each([101, 150, 153])('never automatically reconnects for YouTube error %i', async (code) => {
  player.update(timed(), true);
  await settle();
  options.events.onError({ data: code });
  await vi.advanceTimersByTimeAsync(60000);
  expect(loadYouTubeApi).toHaveBeenCalledTimes(1);
  expect(player.getSnapshot().status).toBe('error');
});

it('keeps a pending iframe throughout background time and gives foreground readiness a fresh grace', async () => {
  let visibility: DocumentVisibilityState = 'visible';
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => visibility === 'hidden');
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  player.update(timed(), true);
  await settle();
  await vi.advanceTimersByTimeAsync(14000);
  visibility = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(300000);
  expect(loadYouTubeApi).toHaveBeenCalledTimes(1);
  expect(apiPlayer.destroy).not.toHaveBeenCalled();
  expect(warning).not.toHaveBeenCalled();
  visibility = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(14999);
  expect(apiPlayer.destroy).not.toHaveBeenCalled();
  await ready();
  await vi.advanceTimersByTimeAsync(30000);
  expect(apiPlayer.destroy).not.toHaveBeenCalled();
  expect(loadYouTubeApi).toHaveBeenCalledTimes(1);
  warning.mockRestore();
  vi.restoreAllMocks();
});

it('waits without a timer when created hidden and cancels the foreground listener on disposal', async () => {
  let visibility: DocumentVisibilityState = 'hidden';
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => visibility === 'hidden');
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  player.update(timed(), true);
  await settle();
  await vi.advanceTimersByTimeAsync(60000);
  expect(loadYouTubeApi).toHaveBeenCalledTimes(1);
  player.dispose();
  visibility = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(60000);
  expect(loadYouTubeApi).toHaveBeenCalledTimes(1);
  expect(apiPlayer.destroy).toHaveBeenCalledTimes(1);
  vi.restoreAllMocks();
});

it('reuses the ready player for the next track and preserves local settings', async () => {
  player.update(timed(), true);
  await ready();
  player.volume(23);
  player.mute();
  player.update(timed(snapshot(2, 'PLAYING', 100)), true);
  expect(loadYouTubeApi).toHaveBeenCalledTimes(1);
  expect(apiPlayer.destroy).not.toHaveBeenCalled();
  expect(apiPlayer.loadVideoById).toHaveBeenCalledTimes(2);
  expect(player.getSnapshot()).toMatchObject({ volume: 23, isMuted: true });
});

it.each([
  [100, 'VIDEO_UNAVAILABLE'],
  [150, 'VIDEO_UNAVAILABLE'],
  [153, 'PLAYER_ENVIRONMENT_ERROR'],
  [5, 'PLAYER_ERROR'],
])(
  'logs provider failure %i without placing the reason or code in the UI message',
  async (code, reason) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    player.update(timed(), true);
    await ready();
    options.events.onError({ data: code as number });
    expect(warning).toHaveBeenLastCalledWith('[chat-music-player]', {
      reason,
      providerCode: code,
      visibility: 'visible',
    });
    expect(player.getSnapshot().message).toBe('음악 재생을 시작하지 못했어요. 다시 시도해 주세요.');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('abcdefghijk');
    warning.mockRestore();
  },
);

it('logs blocked autoplay separately and logs a bounded readiness timeout with the same generic UI', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  player.update(timed(), true);
  await ready();
  options.events.onAutoplayBlocked();
  options.events.onAutoplayBlocked();
  expect(warning).toHaveBeenCalledTimes(1);
  expect(warning).toHaveBeenLastCalledWith('[chat-music-player]', {
    reason: 'AUTOPLAY_BLOCKED',
    visibility: 'visible',
  });
  const generic = player.getSnapshot().message;
  player.retry();
  await settle();
  await vi.advanceTimersByTimeAsync(30000);
  expect(player.getSnapshot()).toMatchObject({ status: 'error', message: generic });
  expect(
    warning.mock.calls.filter(([, detail]) => detail.reason === 'PLAYER_READY_TIMEOUT'),
  ).toHaveLength(2);
  expect(loadYouTubeApi).toHaveBeenCalledTimes(3);
  warning.mockRestore();
});

it.each([
  ['YouTube API timeout', 'SDK_TIMEOUT'],
  ['sensitive request URL must not be logged', 'SDK_LOAD_FAILED'],
])('logs SDK failures safely: %s', async (message, reason) => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(loadYouTubeApi).mockRejectedValueOnce(new Error(message));
  player.update(timed(), true);
  await settle();
  expect(warning).toHaveBeenCalledWith('[chat-music-player]', { reason, visibility: 'visible' });
  expect(player.getSnapshot().message).toBe('음악 재생을 시작하지 못했어요. 다시 시도해 주세요.');
  expect(JSON.stringify(warning.mock.calls)).not.toContain(message);
  warning.mockRestore();
});
