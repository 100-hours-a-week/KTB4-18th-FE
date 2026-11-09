import type { MusicPlayback } from './chatMusicTypes';
import { loadYouTubeApi, type YouTubePlayer } from './youtubeIframe';

export interface TimedPlayback {
  snapshot: MusicPlayback;
  receivedAt: number;
}
export interface RoomPlayerState {
  status: 'waiting' | 'loading' | 'playing' | 'paused' | 'buffering' | 'blocked' | 'error';
  message: string;
  position: number;
  volume: number;
  isMuted: boolean;
}
/** Server time calibrates at receipt; performance.now keeps wall-clock changes out of the timeline. */
export function playbackPosition(timed: TimedPlayback, now = performance.now()) {
  const s = timed.snapshot;
  if (s.state === 'IDLE') return 0;
  const elapsed =
    s.state === 'PLAYING'
      ? Math.max(0, (Date.parse(s.serverTime) - Date.parse(s.stateChangedAt)) / 1000) +
        Math.max(0, (now - timed.receivedAt) / 1000)
      : 0;
  return Math.min(
    s.durationMillis === null ? Infinity : s.durationMillis / 1000,
    Math.max(0, s.positionSeconds + elapsed),
  );
}
export class ChatMusicPlayer {
  private state: RoomPlayerState = {
    status: 'waiting',
    message: '',
    position: 0,
    volume: 70,
    isMuted: false,
  };
  private listeners = new Set<() => void>();
  private target: HTMLElement | undefined;
  private player: YouTubePlayer | undefined;
  private timed: TimedPlayback | null = null;
  private generation = 0;
  private isReady = false;
  private isConnecting = false;
  private isPlayerReady = false;
  private loadedItem: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readyTimeout: ReturnType<typeof setTimeout> | undefined;
  private lastAttempt = -Infinity;
  private lastSeek = -Infinity;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<RoomPlayerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  mount(target: HTMLElement) {
    this.target = target;
  }
  update(timed: TimedPlayback | null, isReady: boolean) {
    this.timed = timed;
    this.isReady = isReady;
    if (!isReady) {
      this.disconnect();
      return;
    }
    const s = timed?.snapshot;
    if (!s || s.state === 'IDLE') {
      this.disconnect();
      return;
    }
    if (!s.sourceVideoId || !s.durationMillis) {
      this.player?.stopVideo();
      this.loadedItem = undefined;
      this.publish({
        status: 'error',
        message: '이 곡의 재생 정보를 확인하지 못했어요. 최신 상태를 확인해 주세요.',
      });
      return;
    }
    if (!this.player && !this.isConnecting && this.state.status !== 'error') void this.connect();
    this.tick();
  }
  private async connect() {
    if (!this.target || !this.isReady) return;
    const generation = ++this.generation;
    this.isConnecting = true;
    this.publish({ status: 'loading', message: '' });
    const owns = () => generation === this.generation && this.isReady;
    try {
      const api = await loadYouTubeApi();
      if (!owns() || !this.target) return;
      const child = document.createElement('div');
      this.target.replaceChildren(child);
      this.readyTimeout = setTimeout(() => {
        if (owns()) this.fail('YouTube 플레이어에 연결하지 못했어요. 다시 시도해 주세요.');
      }, 15_000);
      this.player = new api.Player(child, {
        width: '100%',
        height: '100%',
        playerVars: {
          playsinline: 1,
          controls: 1,
          disablekb: 1,
          origin: window.location.origin,
          autoplay: 0,
        },
        events: {
          onReady: ({ target }) => {
            if (!owns()) return;
            this.player = target;
            clearTimeout(this.readyTimeout);
            this.isPlayerReady = true;
            this.isConnecting = false;
            this.applyVolume();
            this.tick();
            this.timer = setInterval(() => this.tick(), 1000);
          },
          onStateChange: ({ data }) => {
            if (!owns()) return;
            const state = this.timed?.snapshot.state;
            if (state === 'IDLE' || !this.loadedItem) return;
            if (data === 1 && state === 'PAUSED') {
              this.player?.pauseVideo();
              return;
            }
            if (this.state.status === 'error') return;
            if (this.state.status === 'blocked' && state === 'PLAYING' && data !== 1) return;
            if (data === 1) this.publish({ status: 'playing', message: '' });
            else if (data === 2) this.publish({ status: 'paused', message: '' });
            else if (data === 3)
              this.publish({ status: 'buffering', message: 'YouTube 영상을 불러오고 있어요.' });
            else if (data === 0)
              this.publish({ status: 'waiting', message: '서버의 다음 곡을 기다리고 있어요.' });
          },
          onAutoplayBlocked: () => {
            if (owns())
              this.publish({
                status: 'blocked',
                message: '브라우저가 자동재생을 차단했어요. 재생을 허용해 주세요.',
              });
          },
          onError: ({ data }) => {
            if (!owns()) return;
            const message = [100, 101, 150].includes(data)
              ? '이 YouTube 영상을 재생할 수 없어요. 다른 곡으로 건너뛸 수 있어요.'
              : data === 153
                ? 'YouTube에서 재생 환경을 확인하지 못했어요. 사이트 설정을 확인해 주세요.'
                : 'YouTube 재생에 문제가 생겼어요. 다시 시도해 주세요.';
            this.fail(message);
          },
        },
      });
    } catch {
      if (owns()) this.fail('YouTube에 연결하지 못했어요. 다시 시도해 주세요.');
    }
  }
  private fail(message: string) {
    clearTimeout(this.readyTimeout);
    this.isConnecting = false;
    this.publish({ status: 'error', message });
    if (this.isPlayerReady) this.player?.pauseVideo();
  }
  tick(force = false) {
    const p = this.player,
      timed = this.timed,
      s = timed?.snapshot;
    if (
      !p ||
      !this.isReady ||
      !this.isPlayerReady ||
      !timed ||
      !s?.current ||
      !s.sourceVideoId ||
      !s.durationMillis
    )
      return;
    const position = playbackPosition(timed);
    this.publish({ position });
    const changed = this.loadedItem !== s.current.queueItemId;
    if (changed) {
      this.loadedItem = s.current.queueItemId;
      this.lastSeek = -Infinity;
      this.lastAttempt = performance.now();
      this.publish({ status: 'loading', message: '' });
      const video = { videoId: s.sourceVideoId, startSeconds: position };
      if (s.state === 'PAUSED') p.cueVideoById(video);
      else p.loadVideoById(video);
      this.applyVolume();
      if (s.state === 'PAUSED') this.publish({ status: 'paused' });
      return;
    }
    if (this.state.status === 'error') return;
    if (
      force ||
      (Math.abs(p.getCurrentTime() - position) > 2 && performance.now() - this.lastSeek >= 5000)
    ) {
      this.lastSeek = performance.now();
      p.seekTo(position, true);
    }
    if (s.state === 'PAUSED') {
      if (Math.abs(p.getCurrentTime() - position) > 2) p.seekTo(position, true);
      if (p.getPlayerState() !== 2 && p.getPlayerState() !== 5) p.pauseVideo();
      this.publish({ status: 'paused', message: '' });
    } else if (position >= s.durationMillis / 1000) {
      p.pauseVideo();
      this.publish({ status: 'waiting', message: '서버의 다음 곡을 기다리고 있어요.' });
    } else if (
      (force || this.state.status !== 'blocked') &&
      p.getPlayerState() !== 1 &&
      p.getPlayerState() !== 3 &&
      (force || performance.now() - this.lastAttempt >= 3000)
    ) {
      this.lastAttempt = performance.now();
      p.playVideo();
    }
  }
  allowPlayback() {
    if (this.isReady) {
      this.publish({ status: 'loading', message: '' });
      this.tick(true);
    }
  }
  volume(value: number) {
    if (!Number.isFinite(value)) return;
    this.publish({ volume: Math.round(Math.max(0, Math.min(100, value))) });
    this.applyVolume();
  }
  mute() {
    this.publish({ isMuted: !this.state.isMuted });
    this.applyVolume();
  }
  private applyVolume() {
    if (!this.isPlayerReady || !this.player) return;
    this.player.setVolume(this.state.volume);
    if (this.state.isMuted || this.state.volume === 0) this.player.mute();
    else this.player.unMute();
  }
  retry() {
    this.disconnect();
    if (this.isReady) void this.connect();
  }
  private disconnect() {
    this.generation++;
    clearInterval(this.timer);
    clearTimeout(this.readyTimeout);
    this.player?.destroy();
    this.player = undefined;
    this.isConnecting = false;
    this.isPlayerReady = false;
    this.loadedItem = undefined;
    this.target?.replaceChildren();
    this.publish({ status: 'waiting', message: '', position: 0 });
  }
  dispose() {
    this.isReady = false;
    this.disconnect();
    this.target = undefined;
  }
}
