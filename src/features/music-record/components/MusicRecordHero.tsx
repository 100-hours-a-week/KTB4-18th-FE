import { getHighResolutionArtworkUrl } from '../../../shared/albumArtwork';
import type { RecordMusicSummary } from '../api/musicRecordsApi';

type MusicRecordHeroProps = {
  recordId?: number;
  music: RecordMusicSummary;
  albumCoverUrl?: string | null;
  isChangeDisabled?: boolean;
  onChange?: () => void;
};

export function MusicRecordHero({
  recordId,
  music,
  albumCoverUrl = music.album_cover_url,
  isChangeDisabled,
  onChange,
}: MusicRecordHeroProps) {
  const coverUrl = getHighResolutionArtworkUrl(albumCoverUrl);

  return (
    <article className="music-selected-content" data-music-record-card={recordId}>
      <span
        className="music-record-card-background"
        data-music-record-part="background"
        aria-hidden="true"
      >
        {coverUrl && <img className="music-hero-backdrop" src={coverUrl} alt="" />}
      </span>
      {coverUrl ? (
        <img data-music-record-part="artwork" src={coverUrl} alt="" />
      ) : (
        <span
          className="music-cover-placeholder"
          data-music-record-part="artwork"
          aria-hidden="true"
        />
      )}
      <div>
        <p className="music-hero-eyebrow">그날의 한 곡</p>
        <strong data-music-record-part="title">{music.title}</strong>
        <span data-music-record-part="artist">{music.artist_name}</span>
      </div>
      <button
        type="button"
        className="music-change-button"
        disabled={isChangeDisabled}
        onClick={onChange}
      >
        음악 변경
      </button>
    </article>
  );
}
