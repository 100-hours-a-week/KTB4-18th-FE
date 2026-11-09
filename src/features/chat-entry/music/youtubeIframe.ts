export interface YouTubePlayer {
  loadVideoById(video: { videoId: string; startSeconds: number }): void;
  cueVideoById(video: { videoId: string; startSeconds: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
}
export interface YouTubeOptions {
  width: string;
  height: string;
  playerVars: Record<string, string | number>;
  events: {
    onReady(event: { target: YouTubePlayer }): void;
    onStateChange(event: { data: number }): void;
    onAutoplayBlocked(): void;
    onError(event: { data: number }): void;
  };
}
export interface YouTubeApi {
  Player: new (element: HTMLElement, options: YouTubeOptions) => YouTubePlayer;
}
declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let loading: Promise<YouTubeApi> | undefined;
/** One shared SDK load; failure is retryable. No access token or user data reaches YouTube. */
export function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise<YouTubeApi>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      script.onerror = null;
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previous;
      if (error) {
        script.remove();
        reject(error);
      } else resolve(window.YT!);
    };
    const ready = () => {
      try {
        previous?.();
      } finally {
        finish(window.YT?.Player ? undefined : new Error('YouTube API unavailable'));
      }
    };
    const timeout = setTimeout(() => finish(new Error('YouTube API timeout')), 15_000);
    window.onYouTubeIframeAPIReady = ready;
    script.onerror = () => finish(new Error('YouTube API unavailable'));
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}
