import './MusicRecordRegionFilter.css';

type MusicRecordRegionFilterProps = {
  regions: { code: string; name: string }[];
  selectedSidoCode: string | null;
  isDisabled: boolean;
  isLoading: boolean;
  error: string;
  onSelect: (code: string | null) => void;
};

export function MusicRecordRegionFilter({
  regions,
  selectedSidoCode,
  isDisabled,
  isLoading,
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
      {regions.length > 0 && isLoading && (
        <p className="music-record-region-filter-message">지역 필터를 불러오는 중…</p>
      )}
      {error && (
        <p role="alert" className="music-record-region-filter-message">
          {error}
        </p>
      )}
    </div>
  );
}
