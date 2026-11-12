import { useId, useRef, useState, type ReactNode } from 'react';
import { getGridBounds, getMapViewport } from './mapGeometry';
import type { MapDot, MapGridDot } from './mapTypes';
import { getHighResolutionArtworkUrl } from '../../shared/albumArtwork';

type ZoneMapCanvasProps = {
  children?: ReactNode;
  isIntro?: boolean;
  gridDots: MapGridDot[];
  items: MapDot[];
  isFallback: boolean;
};

export function ZoneMapCanvas({
  children,
  isIntro = false,
  gridDots = [],
  items = [],
  isFallback,
}: ZoneMapCanvasProps) {
  const grid = getGridBounds(gridDots);
  const mapDotByCode = new Map(items.map((item) => [item.code, item]));
  const instanceId = useId().replace(/:/g, '');
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const [viewport, setViewport] = useState({ zoom: 1, x: 0, y: 0 });
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const canInteract = !isIntro && gridDots.length > 0;
  const width = grid.width / viewport.zoom;
  const height = grid.height / viewport.zoom;

  function clampOffset(value: number, zoom: number) {
    const limit = (1 - 1 / zoom) / 2;
    return Math.max(-limit, Math.min(limit, value));
  }

  function changeZoom(delta: number) {
    drag.current = null;
    setViewport((previous) => {
      const zoom = Math.max(1, Math.min(3, previous.zoom + delta));
      return {
        zoom,
        x: clampOffset(previous.x, zoom),
        y: clampOffset(previous.y, zoom),
      };
    });
  }

  function moveMap(x: number, y: number) {
    setViewport((previous) => ({
      ...previous,
      x: clampOffset(previous.x + x, previous.zoom),
      y: clampOffset(previous.y + y, previous.zoom),
    }));
  }

  return (
    <section
      className={`zone-map ${isIntro ? 'zone-map--intro' : ''}`}
      aria-label="대한민국 도트 지도"
    >
      <div className="zone-map__surface">
        <svg
          role="img"
          aria-label="대한민국 음악 도트 지도"
          aria-describedby={canInteract ? `map-help-${instanceId}` : undefined}
          tabIndex={canInteract && viewport.zoom > 1 ? 0 : undefined}
          className={`zone-map__canvas ${canInteract && viewport.zoom > 1 ? 'zone-map__canvas--zoomed' : ''}`}
          viewBox={`${grid.minColumn + (grid.width - width) / 2 + viewport.x * grid.width} ${grid.minRow + (grid.height - height) / 2 + viewport.y * grid.height} ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={(event) => {
            if (!canInteract || viewport.zoom === 1 || !event.isPrimary || event.button !== 0)
              return;
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
          }}
          onPointerMove={(event) => {
            const previous = drag.current;
            if (!canInteract || !previous || previous.pointerId !== event.pointerId) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const { scale } = getMapViewport(bounds.width, bounds.height, {
              minColumn: 0,
              minRow: 0,
              width,
              height,
            });
            if (scale <= 0) return;
            moveMap(
              (previous.x - event.clientX) / scale / grid.width,
              (previous.y - event.clientY) / scale / grid.height,
            );
            drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onKeyDown={(event) => {
            if (!canInteract || viewport.zoom === 1) return;
            const steps: Record<string, [number, number]> = {
              ArrowLeft: [-0.1 / viewport.zoom, 0],
              ArrowRight: [0.1 / viewport.zoom, 0],
              ArrowUp: [0, -0.1 / viewport.zoom],
              ArrowDown: [0, 0.1 / viewport.zoom],
            };
            const step = steps[event.key];
            if (step) {
              event.preventDefault();
              moveMap(...step);
            }
          }}
        >
          {gridDots.map((dot) => {
            const mapDot = mapDotByCode.get(dot.code);
            const coverUrl = getHighResolutionArtworkUrl(mapDot?.album_cover_url ?? null);
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
        {children}
        {canInteract && (
          <div className="zone-map__zoom" role="group" aria-label="지도 확대·축소">
            <button
              type="button"
              aria-label="지도 확대"
              disabled={viewport.zoom === 3}
              onClick={() => changeZoom(0.5)}
            >
              <span aria-hidden="true">+</span>
            </button>
            <button
              type="button"
              className="zone-map__zoom-reset"
              aria-label="지도 원래 크기로"
              disabled={viewport.zoom === 1}
              onClick={() => {
                drag.current = null;
                setViewport({ zoom: 1, x: 0, y: 0 });
              }}
            >
              {Math.round(viewport.zoom * 100)}%
            </button>
            <button
              type="button"
              aria-label="지도 축소"
              disabled={viewport.zoom === 1}
              onClick={() => changeZoom(-0.5)}
            >
              <span aria-hidden="true">−</span>
            </button>
          </div>
        )}
        {canInteract && (
          <p id={`map-help-${instanceId}`} className="sr-only">
            확대 후 지도를 끌거나 지도에 초점을 맞추고 방향키로 이동할 수 있어요. 배율 버튼을 누르면
            원래 크기로 돌아갑니다.
          </p>
        )}
      </div>
      {isFallback && (
        <p className="zone-map__notice">지도를 연결하고 있어요. 잠시 후 다시 확인해 주세요.</p>
      )}
    </section>
  );
}
