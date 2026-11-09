import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMusicPlayer, playbackPosition } from './chatMusicPlayer';
import { loadYouTubeApi, type YouTubeOptions, type YouTubePlayer } from './youtubeIframe';
import { parsePlayback } from './chatMusicTypes';
import { queuePage, queueItem, deferred } from './chatMusicTestHelpers';
vi.mock('./youtubeIframe', () => ({ loadYouTubeApi: vi.fn() }));
let options: YouTubeOptions;
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
  vi.mocked(loadYouTubeApi).mockResolvedValue({
    Player: Player as unknown as import('./youtubeIframe').YouTubeApi['Player'],
  });
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
    vi.advanceTimersByTime(15000);
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
