import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ZoneMapCanvas } from './ZoneMapCanvas';

const gridDots = [{ code: 'KR-COAST-0001', gridRow: 0, gridColumn: 0 }];

describe('ZoneMapCanvas album covers', () => {
  it('clips a valid album cover to its dot', () => {
    const { container } = render(<ZoneMapCanvas
      gridDots={gridDots}
      items={[{
        map_dot_id: 1,
        code: 'KR-COAST-0001',
        album_cover_url: 'https://cdn.example.com/cover.jpg',
        latest_recorded_at: '2026-09-03T11:00:00Z',
      }]}
      isFallback={false}
    />);

    const image = container.querySelector('image');
    expect(image).toHaveAttribute('href', 'https://cdn.example.com/cover.jpg');
    expect(image?.getAttribute('clip-path')).toMatch(/^url\(#zone-cover-/);
    expect(container.querySelector('clipPath circle')).toBeInTheDocument();
  });

  it.each([null, ''])('keeps the fallback dot when the cover URL is %s', (coverUrl) => {
    const { container } = render(<ZoneMapCanvas
      gridDots={gridDots}
      items={[{
        map_dot_id: 1,
        code: 'KR-COAST-0001',
        album_cover_url: coverUrl,
        latest_recorded_at: null,
      }]}
      isFallback={false}
    />);
    expect(container.querySelector('image')).not.toBeInTheDocument();
    expect(container.querySelector('circle.zone-map__dot')).toBeInTheDocument();
  });

  it('keeps the fallback dot when the image cannot be loaded', () => {
    const { container } = render(<ZoneMapCanvas
      gridDots={gridDots}
      items={[{
        map_dot_id: 1,
        code: 'KR-COAST-0001',
        album_cover_url: 'https://cdn.example.com/missing.jpg',
        latest_recorded_at: null,
      }]}
      isFallback={false}
    />);
    fireEvent.error(container.querySelector('image')!);
    expect(container.querySelector('image')).not.toBeInTheDocument();
    expect(container.querySelector('circle.zone-map__dot')).toBeInTheDocument();
  });
});
