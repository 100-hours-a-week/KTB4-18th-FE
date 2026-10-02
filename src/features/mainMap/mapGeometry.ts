import type { MapGridDot } from './mapTypes';

export type GridBounds = {
  minColumn: number;
  minRow: number;
  width: number;
  height: number;
};

export function getGridBounds(gridDots: MapGridDot[]): GridBounds {
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

export function getMapViewport(width: number, height: number, bounds: GridBounds) {
  const scale = Math.min(width / bounds.width, height / bounds.height);

  return {
    scale,
    offsetX: (width - bounds.width * scale) / 2,
    offsetY: (height - bounds.height * scale) / 2,
  };
}

export function getMapDotPosition(
  dot: MapGridDot,
  bounds: GridBounds,
  viewport: { scale: number; offsetX: number; offsetY: number },
) {
  return {
    x: viewport.offsetX + (dot.gridColumn - bounds.minColumn + 0.5) * viewport.scale,
    y: viewport.offsetY + (dot.gridRow - bounds.minRow + 0.5) * viewport.scale,
  };
}
