import { getHighResolutionArtworkUrl } from '../../../shared/albumArtwork';
import type { RecordMusicSummary } from '../api/musicRecordsApi';
import { useMusicPreview } from '../hooks/useMusicPreview';
import './MusicRecordHero.css';

type MusicRecordHeroProps = {
  recordId?: number;
  music: RecordMusicSummary;
  albumCoverUrl?: string | null;
  previewUrl?: string | null;
  previewTrackId?: string;
  isChangeDisabled?: boolean;
  onChange?: () => void;
};

export function MusicRecordHero({
  recordId,
  music,
  albumCoverUrl = music.album_cover_url,
  previewUrl,
  previewTrackId,
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
      <MusicRecordHeroActions
        key={JSON.stringify([recordId, previewTrackId ?? music.music_id, previewUrl])}
        previewUrl={previewUrl}
        isChangeDisabled={isChangeDisabled}
        onChange={onChange}
      />
    </article>
  );
}

function MusicRecordHeroActions({
  previewUrl,
  isChangeDisabled,
  onChange,
}: Pick<MusicRecordHeroProps, 'previewUrl' | 'isChangeDisabled' | 'onChange'>) {
  const preview = useMusicPreview();
  const isActive = preview.isLoading || preview.isPlaying;
  const playLabel = !previewUrl
    ? '미리 듣기 불가'
    : isActive
      ? '미리 듣기 일시정지'
      : '미리 듣기 재생';

  return (
    <div className="music-hero-actions">
      <button
        type="button"
        className="music-change-button music-hero-play-button"
        aria-label={playLabel}
        disabled={isChangeDisabled || !previewUrl}
        onClick={() => {
          if (previewUrl) void preview.toggle(previewUrl, previewUrl);
        }}
      >
        {preview.isPlaying ? (
          <span className="music-hero-waveform" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((bar) => (
              <span key={bar} />
            ))}
          </span>
        ) : (
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            {isActive ? <path d="M6 4h3v12H6zm5 0h3v12h-3z" /> : <path d="m7 4 9 6-9 6z" />}
          </svg>
        )}
      </button>
      <button
        type="button"
        className="music-change-button"
        disabled={isChangeDisabled}
        onClick={() => {
          preview.stop();
          onChange?.();
        }}
      >
        음악 변경
      </button>
      {preview.error && <p role="alert">{preview.error}</p>}
    </div>
  );
}
