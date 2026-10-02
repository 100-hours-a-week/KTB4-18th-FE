import type { ReactNode } from 'react';
import type { MapDot, MapGridDot } from './mapTypes';
import { getGridBounds } from './mapGeometry';

type ZoneMapCanvasProps = {
  children?: ReactNode;
  gridDots: MapGridDot[];
  items: MapDot[];
  isFallback: boolean;
  isIntro: boolean;
};

export function ZoneMapCanvas({
  children,
  gridDots = [],
  items = [],
  isFallback,
  isIntro,
}: ZoneMapCanvasProps) {
  const grid = getGridBounds(gridDots);
  const mapDotByCode = new Map(items.map((item) => [item.code, item]));

  return (
    <section
      className={`zone-map ${isIntro ? 'zone-map--intro' : ''}`}
      aria-label="대한민국 도트 지도"
    >
      <div className="zone-map__surface">
        <svg
          aria-hidden="true"
          className="zone-map__canvas"
          viewBox={`${grid.minColumn} ${grid.minRow} ${grid.width} ${grid.height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {gridDots.map((dot) => {
            const mapDot = mapDotByCode.get(dot.code);
            return (
              <g
                key={dot.code}
                data-zone-code={dot.code}
                data-map-dot-id={mapDot?.map_dot_id}
                className="zone-map__zone"
              >
                <circle
                  className="zone-map__dot"
                  cx={dot.gridColumn + 0.5}
                  cy={dot.gridRow + 0.5}
                  r="0.32"
                />
              </g>
            );
          })}
        </svg>
        {children}
      </div>
      {isFallback && <p className="zone-map__notice">지도 데이터를 다시 연결하는 중이에요.</p>}
    </section>
  );
}
