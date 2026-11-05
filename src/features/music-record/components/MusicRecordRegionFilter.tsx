import './MusicRecordRegionFilter.css';
import { MusicRegionFilterSkeleton } from '../../../components/RouteLoadSkeleton';

type MusicRecordRegionFilterProps = {
  regions: { code: string; name: string }[];
  selectedSidoCode: string | null;
  isDisabled: boolean;
  isSkeletonVisible: boolean;
  error: string;
  onSelect: (code: string | null) => void;
};

export function MusicRecordRegionFilter({
  regions,
  selectedSidoCode,
  isDisabled,
  isSkeletonVisible,
  error,
  onSelect,
}: MusicRecordRegionFilterProps) {
  return (
    <div className="music-record-region-filter">
      {regions.length > 0 && (
        <div
          className="music-record-region-filter-row"
          role="group"
          aria-label="음악 기록 지역 필터"
        >
          {[{ code: null, name: '전국' }, ...regions].map(({ code, name }) => (
            <button
              key={code ?? 'nationwide'}
              type="button"
              className="music-record-region-filter-button"
              aria-pressed={selectedSidoCode === code}
              disabled={isDisabled}
              onClick={() => {
                if (!isDisabled) onSelect(code);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {isSkeletonVisible && <MusicRegionFilterSkeleton />}
      {error && (
        <p role="alert" className="music-record-region-filter-message">
          {error}
        </p>
      )}
    </div>
  );
}
