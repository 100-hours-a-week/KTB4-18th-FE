export function formatMusicRecordTime(utc: string): string {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(utc));
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? '';
  return `${part('year')}.${part('month')}.${part('day')}. ${part('dayPeriod')} ${part('hour')}:${part('minute')}`;
}
