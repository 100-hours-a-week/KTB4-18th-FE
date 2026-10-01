import { useId, useState } from 'react';
import type { MapDot, MapGridDot } from './mapTypes';

type ZoneMapCanvasProps = {
  gridDots: MapGridDot[];
  items: MapDot[];
  isFallback: boolean;
};

function getGridBounds(gridDots: MapGridDot[]) {
  if (gridDots.length === 0) {
    return { minColumn: 0, minRow: 0, width: 1, height: 1 };
  }

  const columns = gridDots.map((dot) => dot.gridColumn);
  const rows = gridDots.map((dot) => dot.gridRow);
  const minColumn = Math.min(...columns);
  const minRow = Math.min(...rows);
  return {
    minColumn,
    minRow,
    width: Math.max(...columns) - minColumn + 1,
    height: Math.max(...rows) - minRow + 1,
  };
}

export function ZoneMapCanvas({ gridDots = [], items = [], isFallback }: ZoneMapCanvasProps) {
  const grid = getGridBounds(gridDots);
  const mapDotByCode = new Map(items.map((item) => [item.code, item]));
  const instanceId = useId().replace(/:/g, '');
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());

  return (
    <section className="zone-map" aria-label="대한민국 도트 지도">
      <svg
        aria-hidden="true"
        className="zone-map__canvas"
        viewBox={`${grid.minColumn} ${grid.minRow} ${grid.width} ${grid.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {gridDots.map((dot) => {
          const mapDot = mapDotByCode.get(dot.code);
          const coverUrl = mapDot?.album_cover_url;
          const imageKey = `${dot.code}:${coverUrl ?? ''}`;
          const showCover = Boolean(coverUrl) && !failedImages.has(imageKey);
          const centerX = dot.gridColumn + 0.5;
          const centerY = dot.gridRow + 0.5;
          const clipId = `zone-cover-${instanceId}-${dot.code}`;

          return (
            <g
              key={dot.code}
              data-zone-code={dot.code}
              data-map-dot-id={mapDot?.map_dot_id}
              className="zone-map__zone"
            >
              <circle className="zone-map__dot" cx={centerX} cy={centerY} r="0.32" />
              {showCover && (
                <>
                  <defs>
                    <clipPath id={clipId}>
                      <circle cx={centerX} cy={centerY} r="0.32" />
                    </clipPath>
                  </defs>
                  <image
                    href={coverUrl!}
                    x={centerX - 0.32}
                    y={centerY - 0.32}
                    width="0.64"
                    height="0.64"
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#${clipId})`}
                    onError={() => {
                      setFailedImages((previous) => new Set(previous).add(imageKey));
                    }}
                  />
                </>
              )}
            </g>
          );
        })}
      </svg>
      {isFallback && <p className="zone-map__notice">지도 데이터를 다시 연결하는 중이에요.</p>}
    </section>
  );
}
