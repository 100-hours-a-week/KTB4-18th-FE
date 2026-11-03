import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocationRecommendationTrackCarousel } from './components/LocationRecommendationTrackCarousel';
import { resolveItunesTrack } from './api/itunesTrackSearch';
import { useMusicPreview } from '../music-record/hooks/useMusicPreview';

vi.mock('./api/itunesTrackSearch', () => ({ resolveItunesTrack: vi.fn() }));

class TestAudio {
  static latest: TestAudio | null = null;
  currentTime = 0;
  preload = '';
  url = '';
  onended: ((this: GlobalEventHandlers, ev: Event) => unknown) | null = null;
  onerror: ((this: GlobalEventHandlers, ev: Event) => unknown) | null = null;
  ontimeupdate: ((this: GlobalEventHandlers, ev: Event) => unknown) | null = null;
  readonly play = vi.fn().mockResolvedValue(undefined);
  readonly pause = vi.fn();
  readonly load = vi.fn();
  readonly removeAttribute = vi.fn();

  constructor(url = '') {
    this.url = url;
    TestAudio.latest = this;
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const recommendationTrack = {
  trackId: 'track-1',
  title: '노래',
  artist: '가수',
  previewUrl: 'https://ai.example.com/preview.mp3',
  artworkUrl: 'https://ai.example.com/artwork.jpg',
  storeUrl: 'https://ai.example.com/store',
};

function renderCarousel() {
  return render(
    <LocationRecommendationTrackCarousel
      tracks={[recommendationTrack]}
      isPreviewAllowed
      preview={{
        activeTrack: null,
        isPlaying: false,
        isLoading: false,
        error: '',
        toggle: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(),
      }}
    />,
  );
}

describe('location recommendation previews', () => {
  it('stops user-started previews at 30 seconds', async () => {
    vi.stubGlobal('Audio', TestAudio as unknown as typeof Audio);
    const { result } = renderHook(() => useMusicPreview());

    await act(async () => {
      await result.current.toggle('track-1', 'https://example.com/preview.mp3');
    });

    const audio = TestAudio.latest;
    expect(audio?.play).toHaveBeenCalledOnce();
    expect(audio?.preload).toBe('none');
    expect(result.current.activeTrack).toBe('track-1');
    if (!audio) throw new Error('audio element was not created');
    audio.currentTime = 30;
    act(() => audio.ontimeupdate?.call(window, new Event('timeupdate')));

    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.removeAttribute).toHaveBeenCalledWith('src');
    expect(result.current.activeTrack).toBeNull();
    expect(result.current.isPlaying).toBe(false);
  });

  it('DEV discards AI media and exposes only the exact iTunes result', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('PROD', false);
    vi.mocked(resolveItunesTrack).mockResolvedValueOnce({
      ...recommendationTrack,
      previewUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a',
      artworkUrl: 'https://is1-ssl.mzstatic.com/artwork/600x600bb.jpg',
      storeUrl: 'https://music.apple.com/kr/song/example/1',
    });

    renderCarousel();

    expect(resolveItunesTrack).toHaveBeenCalledWith(recommendationTrack, expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: '미리 듣기: 노래' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Apple Music에서 보기' })).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Apple Music에서 보기' })).toHaveAttribute(
      'href',
      'https://music.apple.com/kr/song/example/1',
    );
  });

  it('production keeps AI HTTPS media and never performs an iTunes lookup', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);

    renderCarousel();

    expect(resolveItunesTrack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '미리 듣기: 노래' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Apple Music에서 보기' })).toHaveAttribute(
      'href',
      'https://ai.example.com/store',
    );
  });

  it('DEV lookup failure leaves AI media unavailable without fallback', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('PROD', false);
    vi.mocked(resolveItunesTrack).mockResolvedValueOnce({
      ...recommendationTrack,
      previewUrl: null,
      artworkUrl: null,
      storeUrl: null,
    });

    renderCarousel();

    expect(await screen.findByRole('button', { name: '미리 듣기: 노래' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Apple Music에서 보기' })).not.toBeInTheDocument();
  });
});
