import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ZoneMapCanvas } from './ZoneMapCanvas';

const gridDots = [{ code: 'KR-COAST-0001', gridRow: 0, gridColumn: 0 }];

afterEach(cleanup);

describe('ZoneMapCanvas zoom controls', () => {
  const zoomGrid = [
    { code: 'north', gridRow: 0, gridColumn: 0 },
    { code: 'south', gridRow: 19, gridColumn: 9 },
  ];

  it('zooms the SVG within limits and restores the whole map after moving', () => {
    render(<ZoneMapCanvas gridDots={zoomGrid} items={[]} isFallback={false} />);
    const map = screen.getByRole('img', { name: '대한민국 음악 도트 지도' });
    const zoomIn = screen.getByRole('button', { name: '지도 확대' });
    const zoomOut = screen.getByRole('button', { name: '지도 축소' });
    expect(map).toHaveAttribute('viewBox', '0 0 10 20');
    expect(zoomOut).toBeDisabled();
    for (let i = 0; i < 8; i++) fireEvent.click(zoomIn);
    expect(zoomIn).toBeDisabled();
    expect(screen.getByRole('button', { name: '지도 원래 크기로' })).toHaveTextContent('300%');
    const zoomedBox = map.getAttribute('viewBox');
    fireEvent.keyDown(map, { key: 'ArrowRight' });
    expect(map.getAttribute('viewBox')).not.toBe(zoomedBox);
    for (let i = 0; i < 50; i++) fireEvent.keyDown(map, { key: 'ArrowRight' });
    const [x, , width] = map.getAttribute('viewBox')!.split(' ').map(Number);
    expect(x + width).toBeCloseTo(10);
    fireEvent.click(zoomOut);
    const [reducedX, , reducedWidth] = map.getAttribute('viewBox')!.split(' ').map(Number);
    expect(reducedX + reducedWidth).toBeCloseTo(10);
    fireEvent.click(screen.getByRole('button', { name: '지도 원래 크기로' }));
    expect(map).toHaveAttribute('viewBox', '0 0 10 20');
    expect(map).not.toHaveAttribute('tabindex');
    expect(zoomOut).toBeDisabled();
    fireEvent.click(zoomIn);
    fireEvent.click(zoomOut);
    expect(map).toHaveAttribute('viewBox', '0 0 10 20');
  });

  it('shows controls only after intro with a nonempty grid, including fallback data', () => {
    const { rerender } = render(
      <ZoneMapCanvas gridDots={zoomGrid} items={[]} isFallback={false} isIntro />,
    );
    expect(screen.queryByRole('group', { name: '지도 확대·축소' })).not.toBeInTheDocument();
    rerender(<ZoneMapCanvas gridDots={[]} items={[]} isFallback={true} />);
    expect(screen.queryByRole('group', { name: '지도 확대·축소' })).not.toBeInTheDocument();
    rerender(<ZoneMapCanvas gridDots={zoomGrid} items={[]} isFallback={true} />);
    expect(screen.getByRole('button', { name: '지도 확대' })).toBeEnabled();
  });
});

describe('ZoneMapCanvas album covers', () => {
  it('clips a valid album cover to its dot', () => {
    const { container } = render(
      <ZoneMapCanvas
        gridDots={gridDots}
        items={[
          {
            map_dot_id: 1,
            code: 'KR-COAST-0001',
            album_cover_url: 'https://is1-ssl.mzstatic.com/image/thumb/cover/100x100bb.jpg',
            latest_recorded_at: '2026-09-03T11:00:00Z',
          },
        ]}
        isFallback={false}
      />,
    );

    const image = container.querySelector('image');
    expect(image).toHaveAttribute(
      'href',
      'https://is1-ssl.mzstatic.com/image/thumb/cover/680x680bb.jpg',
    );
    expect(image?.getAttribute('clip-path')).toMatch(/^url\(#zone-cover-/);
    expect(container.querySelector('clipPath circle')).toBeInTheDocument();
  });

  it.each([null, ''])('keeps the fallback dot when the cover URL is %s', (coverUrl) => {
    const { container } = render(
      <ZoneMapCanvas
        gridDots={gridDots}
        items={[
          {
            map_dot_id: 1,
            code: 'KR-COAST-0001',
            album_cover_url: coverUrl,
            latest_recorded_at: null,
          },
        ]}
        isFallback={false}
      />,
    );
    expect(container.querySelector('image')).not.toBeInTheDocument();
    expect(container.querySelector('circle.zone-map__dot')).toBeInTheDocument();
  });

  it('keeps the fallback dot when the image cannot be loaded', () => {
    const { container } = render(
      <ZoneMapCanvas
        gridDots={gridDots}
        items={[
          {
            map_dot_id: 1,
            code: 'KR-COAST-0001',
            album_cover_url: 'https://cdn.example.com/missing.jpg',
            latest_recorded_at: null,
          },
        ]}
        isFallback={false}
      />,
    );
    fireEvent.error(container.querySelector('image')!);
    expect(container.querySelector('image')).not.toBeInTheDocument();
    expect(container.querySelector('circle.zone-map__dot')).toBeInTheDocument();
  });
});
