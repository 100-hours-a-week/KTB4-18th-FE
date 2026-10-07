import { describe, expect, it } from 'vitest';

import { getHighResolutionArtworkUrl } from './albumArtwork';

describe('getHighResolutionArtworkUrl', () => {
  it('requests iTunes artwork at 680x680', () => {
    expect(
      getHighResolutionArtworkUrl(
        'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/cover/100x100bb.jpg',
      ),
    ).toBe('https://is1-ssl.mzstatic.com/image/thumb/Music/v4/cover/680x680bb.jpg');
  });

  it('keeps already high-resolution or unversioned URLs unchanged', () => {
    const highResolutionUrl = 'https://is1-ssl.mzstatic.com/image/thumb/cover/680x680bb.jpg';
    const unversionedUrl = 'https://cdn.example.com/cover.jpg';

    expect(getHighResolutionArtworkUrl(highResolutionUrl)).toBe(highResolutionUrl);
    expect(getHighResolutionArtworkUrl(unversionedUrl)).toBe(unversionedUrl);
  });

  it('keeps a missing artwork URL empty', () => {
    expect(getHighResolutionArtworkUrl(null)).toBeNull();
  });
});
