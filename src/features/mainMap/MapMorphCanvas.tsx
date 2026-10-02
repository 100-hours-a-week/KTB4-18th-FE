import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapGridDot } from './mapTypes';
import { getGridBounds, getMapDotPosition, getMapViewport } from './mapGeometry';

type MapMorphCanvasProps = {
  gridDots: MapGridDot[];
  isActive: boolean;
  onComplete: () => void;
};

type CanvasSize = {
  width: number;
  height: number;
  pixelRatio: number;
  circleScale: number;
};

const INTRO_DOT_COUNT = 1050;
const HOLD_DURATION = 250;
const MORPH_DURATION = 1350;
const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function seededValue(index: number) {
  let value = Math.imul(index + 1, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function getIntroPoint(index: number, width: number, height: number, circleScale: number) {
  const maximumRadius = 122 * circleScale;
  const radius = Math.sqrt(seededValue(index)) * maximumRadius;
  const angle = index * GOLDEN_ANGLE;
  return {
    x: width / 2 + Math.cos(angle) * radius,
    y: height / 2 + Math.sin(angle) * radius,
  };
}

export function MapMorphCanvas({ gridDots, isActive, onComplete }: MapMorphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  const animationStartRef = useRef<number | null>(null);
  const [size, setSize] = useState<CanvasSize>({
    width: 0,
    height: 0,
    pixelRatio: 1,
    circleScale: 1,
  });
  const bounds = useMemo(() => getGridBounds(gridDots), [gridDots]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const updateSize = () => {
      const { width, height } = surface.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const circleScale = Math.min(1, width / 256, height / 256);
      setSize((current) => {
        if (
          current.width === width &&
          current.height === height &&
          current.pixelRatio === pixelRatio &&
          current.circleScale === circleScale
        ) {
          return current;
        }
        return { width, height, pixelRatio, circleScale };
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.width = Math.round(size.width * size.pixelRatio);
    canvas.height = Math.round(size.height * size.pixelRatio);
    context.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);

    const viewport = getMapViewport(size.width, size.height, bounds);
    const dotCount = gridDots.length || INTRO_DOT_COUNT;
    const dotColor = getComputedStyle(canvas).getPropertyValue('--map-dot-color').trim();
    context.fillStyle = dotColor || '#d4d4d4';
    let animationFrame = 0;
    let completed = false;

    const draw = (timestamp: number) => {
      if (isActive && animationStartRef.current === null) animationStartRef.current = timestamp;
      const elapsed =
        isActive && animationStartRef.current !== null
          ? Math.max(0, timestamp - animationStartRef.current - HOLD_DURATION)
          : 0;
      const progress = isActive ? Math.min(1, elapsed / MORPH_DURATION) : 0;
      const easedProgress = progress * progress * (3 - 2 * progress);

      context.clearRect(0, 0, size.width, size.height);
      for (let index = 0; index < dotCount; index += 1) {
        const start = getIntroPoint(index, size.width, size.height, size.circleScale);
        const dot = gridDots[index];
        const target = dot ? getMapDotPosition(dot, bounds, viewport) : start;
        const x = start.x + (target.x - start.x) * easedProgress;
        const y = start.y + (target.y - start.y) * easedProgress;
        const targetRadius = dot ? viewport.scale * 0.32 : 2.8 * size.circleScale;
        const radius =
          2.8 * size.circleScale + (targetRadius - 2.8 * size.circleScale) * easedProgress;

        context.beginPath();
        context.arc(x, y, radius, 0, TAU);
        context.fill();
      }

      if (!isActive) return;

      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(draw);
        return;
      }

      if (!completed) {
        completed = true;
        onCompleteRef.current();
      }
    };

    animationFrame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [bounds, gridDots, isActive, size]);

  return (
    <div className="map-morph" ref={surfaceRef} aria-hidden="true">
      <canvas className="map-morph__dots" ref={canvasRef} />
    </div>
  );
}
