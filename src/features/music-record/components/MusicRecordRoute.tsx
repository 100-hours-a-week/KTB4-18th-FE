import { MusicRecordDetailPage } from './MusicRecordDetailPage';
import { MusicRecordListPage } from './MusicRecordPages';

type MusicRecordRouteProps = { recordId?: number };

export default function MusicRecordRoute({ recordId }: MusicRecordRouteProps) {
  return recordId === undefined ? (
    <MusicRecordListPage />
  ) : (
    <MusicRecordDetailPage recordId={recordId} />
  );
}
