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
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  items: { rank_no: number; music: Music }[];
  completed_at: string | null;
}
