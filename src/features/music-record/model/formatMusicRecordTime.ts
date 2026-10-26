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
  const dayPeriod = part('dayPeriod').replace('AM', '오전').replace('PM', '오후');
  return `${part('year')}.${part('month')}.${part('day')}. ${dayPeriod} ${part('hour')}:${part('minute')}`;
}
