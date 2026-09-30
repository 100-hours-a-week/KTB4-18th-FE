export interface Music {
  music_id: number;
  title: string;
  artist_name: string;
  album_cover_url: string | null;
  preview_url: string | null;
}

export interface Recommendation {
  recommendation_id: number;
  conversation_key: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';
  items: { rank_no: number; music: Music }[];
  completed_at: string | null;
}

export interface RecommendationAccepted {
  recommendation_id: number;
  conversation_key: string;
  status: 'PROCESSING';
}

export interface RecommendationStreamTrack {
  track_id: string;
  title: string;
  artist: string;
  artwork_url: string | null;
  preview_url: string | null;
  store_url: string | null;
  reason: string | null;
}
