import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMusicRecordDate } from './formatMusicRecordDate';
import { formatMusicRecordTime } from './formatMusicRecordTime';

afterEach(() => vi.restoreAllMocks());

describe.each([formatMusicRecordDate, formatMusicRecordTime])('%s 날짜 표시', (format) => {
  it.each([
    ['2026-09-21T15:00:00Z', '2026.09.22. 오전 12:00'],
    ['2026-09-22T03:00:00Z', '2026.09.22. 오후 12:00'],
    ['2026-09-22T06:30:00Z', '2026.09.22. 오후 3:30'],
  ])('서울 시간대의 자정·정오·오후 표시: %s', (value, expected) => {
    expect(format(value)).toBe(expected);
  });

  it.each([
    ['AM', '오전'],
    ['PM', '오후'],
    ['오전', '오전'],
    ['오후', '오후'],
  ])('런타임의 %s 표기를 한국어로 표시', (period, expected) => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue([
      { type: 'year', value: '2026' },
      { type: 'month', value: '09' },
      { type: 'day', value: '22' },
      { type: 'dayPeriod', value: period },
      { type: 'hour', value: '3' },
      { type: 'minute', value: '30' },
    ]);
    expect(format('2026-09-22T06:30:00Z')).toBe(`2026.09.22. ${expected} 3:30`);
  });
});

it('없는 날짜와 잘못된 날짜의 대체 표시 유지', () => {
  for (const value of [null, undefined, 'invalid']) expect(formatMusicRecordDate(value)).toBe('—');
});
