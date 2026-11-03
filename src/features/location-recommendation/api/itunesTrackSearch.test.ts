import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocationRecommendationTrack } from '../locationRecommendationTypes';
import { resolveItunesTrack } from './itunesTrackSearch';

const track: LocationRecommendationTrack = {
  trackId: '1635469851',
  title: 'Hype Boy',
  artist: 'NewJeans',
  previewUrl: null,
  artworkUrl: null,
  storeUrl: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('iTunes recommendation track lookup', () => {
  it('fills preview, artwork, and store links from the exact iTunes song result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          resultCount: 1,
          results: [
            {
              trackId: 1635469851,
              kind: 'song',
              trackName: 'Hype Boy',
              artistName: 'NewJeans',
              previewUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a',
              artworkUrl100: 'https://is1-ssl.mzstatic.com/artwork/100x100bb.jpg',
              trackViewUrl: 'https://music.apple.com/kr/song/hype-boy/1',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveItunesTrack(track, new AbortController().signal);
    const requestUrl = new URL(fetchMock.mock.calls[0][0].toString());

    expect(requestUrl.origin + requestUrl.pathname).toBe('https://itunes.apple.com/search');
    expect(requestUrl.searchParams.get('term')).toBe('NewJeans Hype Boy');
    expect(requestUrl.searchParams.get('entity')).toBe('song');
    expect(requestUrl.searchParams.get('country')).toBeNull();
    expect(resolved.previewUrl).toBe('https://audio-ssl.itunes.apple.com/preview.m4a');
    expect(resolved.artworkUrl).toBe('https://is1-ssl.mzstatic.com/artwork/600x600bb.jpg');
    expect(resolved.storeUrl).toBe('https://music.apple.com/kr/song/hype-boy/1');
  });

  it('uses the Apple track id when the localized catalog title differs', async () => {
    const koreanTrack: LocationRecommendationTrack = {
      ...track,
      trackId: '1480802550',
      title: '어떻게 이별까지 사랑하겠어, 널 사랑하는 거지',
      artist: 'AKMU',
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          resultCount: 1,
          results: [
            {
              trackId: 1480802550,
              kind: 'song',
              trackName: "How can I love the heartbreak, you're the one I love",
              artistName: 'AKMU',
              previewUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveItunesTrack(koreanTrack, new AbortController().signal);

    expect(resolved.previewUrl).toBe('https://audio-ssl.itunes.apple.com/preview.m4a');
  });

  it('does not fall back to recommendation media when iTunes has no exact title and artist match', async () => {
    const aiTrack = {
      ...track,
      previewUrl: 'https://ai.example.com/preview.mp3',
      artworkUrl: 'https://ai.example.com/artwork.jpg',
      storeUrl: 'https://ai.example.com/store',
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          resultCount: 1,
          results: [
            {
              kind: 'song',
              trackName: 'Hype Boy (Remix)',
              artistName: 'NewJeans',
              previewUrl: 'https://audio-ssl.itunes.apple.com/other.m4a',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveItunesTrack(aiTrack, new AbortController().signal)).resolves.toEqual({
      ...aiTrack,
      previewUrl: null,
      artworkUrl: null,
      storeUrl: null,
    });
  });

  it('rejects a title-only match and ambiguous exact title-and-artist matches', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        results: [
          {
            kind: 'song',
            trackName: 'Hype Boy',
            artistName: 'Other Artist',
            previewUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a',
          },
          {
            kind: 'song',
            trackName: 'Hype Boy',
            artistName: 'NewJeans',
            previewUrl: 'https://audio-ssl.itunes.apple.com/one.m4a',
          },
          {
            kind: 'song',
            trackName: 'Hype Boy',
            artistName: 'NewJeans',
            previewUrl: 'https://audio-ssl.itunes.apple.com/two.m4a',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveItunesTrack(track, new AbortController().signal)).resolves.toMatchObject({
      previewUrl: null,
      artworkUrl: null,
      storeUrl: null,
    });
  });

  it('only accepts HTTPS media from the field-specific Apple host allowlists', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        results: [
          {
            trackId: 1635469851,
            kind: 'song',
            trackName: 'Hype Boy',
            artistName: 'NewJeans',
            previewUrl: 'http://audio-ssl.itunes.apple.com/preview.m4a',
            artworkUrl100: 'https://evil-mzstatic.com/artwork.jpg',
            trackViewUrl: 'https://music.apple.com:8443/kr/song/hype-boy/1',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveItunesTrack(track, new AbortController().signal)).resolves.toMatchObject({
      previewUrl: null,
      artworkUrl: null,
      storeUrl: null,
    });
  });

  it('does not preserve AI media when iTunes lookup fails', async () => {
    const aiTrack = {
      ...track,
      previewUrl: 'https://ai.example.com/preview.mp3',
      artworkUrl: 'https://ai.example.com/artwork.jpg',
      storeUrl: 'https://ai.example.com/store',
    };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unavailable')));

    await expect(resolveItunesTrack(aiTrack, new AbortController().signal)).resolves.toMatchObject({
      previewUrl: null,
      artworkUrl: null,
      storeUrl: null,
    });
  });
});
