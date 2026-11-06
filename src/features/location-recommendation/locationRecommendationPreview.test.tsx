import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocationRecommendationTrackCarousel } from './components/LocationRecommendationTrackCarousel';
import type { LocationRecommendationTrack } from './locationRecommendationTypes';
import { useMusicPreview } from '../music-record/hooks/useMusicPreview';

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

function renderCarousel(track: LocationRecommendationTrack = recommendationTrack) {
  const toggle = vi.fn().mockResolvedValue(undefined);
  const result = render(
    <LocationRecommendationTrackCarousel
      tracks={[track]}
      isPreviewAllowed
      preview={{
        activeTrack: null,
        isPlaying: false,
        isLoading: false,
        error: '',
        toggle,
        stop: vi.fn(),
      }}
    />,
  );
  return { ...result, toggle };
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
    expect(result.current.activeTrack).toBe('track-1');
    if (!audio) throw new Error('audio element was not created');
    audio.currentTime = 30;
    act(() => audio.ontimeupdate?.call(window, new Event('timeupdate')));

    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.removeAttribute).toHaveBeenCalledWith('src');
    expect(result.current.activeTrack).toBeNull();
    expect(result.current.isPlaying).toBe(false);
  });

  it('uses the supplied local mock media without calling the iTunes Search API', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('PROD', false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const localMockTrack = {
      ...recommendationTrack,
      previewUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a',
      artworkUrl: 'https://is1-ssl.mzstatic.com/artwork/680x680bb.jpg',
      storeUrl: 'https://music.apple.com/kr/song/example/1',
    };

    const { container, toggle } = renderCarousel(localMockTrack);

    expect(fetchMock).not.toHaveBeenCalled();
    const previewButton = screen.getByRole('button', { name: '미리 듣기: 노래' });
    expect(previewButton).toBeEnabled();
    expect(container.querySelector('.location-recommendation-carousel__artwork')).toHaveAttribute(
      'src',
      localMockTrack.artworkUrl,
    );
    fireEvent.click(previewButton);
    expect(toggle).toHaveBeenCalledWith(localMockTrack.trackId, localMockTrack.previewUrl);
    expect(previewButton.querySelector('img')).toHaveAttribute(
      'src',
      '/icons/location-recommendation/play.svg',
    );
    expect(screen.queryByRole('link', { name: 'Apple Music에서 보기' })).not.toBeInTheDocument();
    expect(screen.queryByText('iTunes에서 제공')).not.toBeInTheDocument();
  });

  it('uses the saved stop icon while a preview is playing', () => {
    render(
      <LocationRecommendationTrackCarousel
        tracks={[recommendationTrack]}
        isPreviewAllowed
        preview={{
          activeTrack: 'track-1',
          isPlaying: true,
          isLoading: false,
          error: '',
          toggle: vi.fn().mockResolvedValue(undefined),
          stop: vi.fn(),
        }}
      />,
    );

    const stopButton = screen.getByRole('button', { name: '미리 듣기 중지: 노래' });
    expect(stopButton.querySelector('img')).toHaveAttribute(
      'src',
      '/icons/location-recommendation/stop.svg',
    );
  });

  it('production keeps the AI-provided media URLs', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { container, toggle } = renderCarousel();

    expect(container.querySelector('.location-recommendation-carousel__artwork')).toHaveAttribute(
      'src',
      recommendationTrack.artworkUrl,
    );
    fireEvent.click(screen.getByRole('button', { name: '미리 듣기: 노래' }));
    expect(toggle).toHaveBeenCalledWith(
      recommendationTrack.trackId,
      recommendationTrack.previewUrl,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disables previews when the supplied track has no preview URL', () => {
    const { toggle } = renderCarousel({
      ...recommendationTrack,
      previewUrl: null,
    });
    const previewButton = screen.getByRole('button', { name: '미리 듣기: 노래' });
    expect(previewButton).toBeDisabled();
    fireEvent.click(previewButton);
    expect(toggle).not.toHaveBeenCalled();
  });
});
