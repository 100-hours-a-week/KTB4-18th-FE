export interface MapGridDot {
  code: string;
  gridRow: number;
  gridColumn: number;
}

export interface MapDot {
  map_dot_id: number;
  code: string;
  album_cover_url: string | null;
  latest_recorded_at: string | null;
}

export interface MapDotsData {
  items: MapDot[];
}

export type MapLoadState =
  | { status: 'loading'; attempt: 1 | 2 }
  | { status: 'remote'; gridDots: MapGridDot[]; items: MapDot[] }
  | { status: 'fallback'; gridDots: MapGridDot[]; items: MapDot[] };
