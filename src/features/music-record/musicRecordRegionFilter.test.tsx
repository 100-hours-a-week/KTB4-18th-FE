import { StrictMode, useEffect, useState } from 'react';

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../App';
import {
  AUTH_EXPIRED_EVENT,
  setAccessToken,
  clearAccessToken,
} from '../auth-login/api/authSession';
import { MusicRecordCreatePage, MusicRecordListPage } from './components/MusicRecordPages';
import { MusicRecordDetailPage } from './components/MusicRecordDetailPage';
import { musicRecordFilterPath } from './model/musicRecordFilterPath';
import { readRouteLocation, ROUTE_CHANGE_EVENT } from '../../shared/navigation';
import { useMusicRecordRegionFilter } from './hooks/useMusicRecordRegionFilter';
import { getAllMusicRecords, MusicApiError, type MusicRecord } from './api/musicRecordsApi';

vi.mock('./api/musicRecordsApi', async (importOriginal) => {
  const api = await importOriginal<typeof import('./api/musicRecordsApi')>();
  return { ...api, getAllMusicRecords: vi.fn(api.getAllMusicRecords) };
});

const record = (id: number, code = '11', name = '서울특별시'): MusicRecord => ({
  record_id: id,
  music: { music_id: id, title: `노래 ${id}`, artist_name: '가수', album_cover_url: null },
  map_dot_id: id,
  region: {
    sido: { region_id: id, code, name },
    sigungu: { region_id: id, code: `${code}001`, name: '동네' },
  },
  custom_place_name: null,
  emotion_memo: null,
  created_at: '2026-09-22T06:30:00Z',
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

let pages: MusicRecord[][];
let deleteStatus: number;
let deletedIds: number[];

beforeEach(async () => {
  window.history.replaceState(null, '', '/music-records');
  sessionStorage.clear();
  setAccessToken('test-token');
  pages = [
    [record(1), record(2)],
    [record(3, '28', '인천광역시'), record(4)],
    [record(5, '50', '제주특별자치도')],
  ];
  deleteStatus = 204;
  deletedIds = [];
  const actual =
    await vi.importActual<typeof import('./api/musicRecordsApi')>('./api/musicRecordsApi');
  vi.mocked(getAllMusicRecords).mockReset().mockImplementation(actual.getAllMusicRecords);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname.endsWith('/auth/token/csrf'))
        return Response.json({ data: { csrf_token: 'csrf' } });
      if (url.pathname.endsWith('/music-records') && init?.method === 'DELETE') {
        if (deleteStatus !== 204) return Response.json({ data: null }, { status: deleteStatus });
        deletedIds = (JSON.parse(String(init.body)) as { record_ids: number[] }).record_ids;
        pages = pages.map((page) => page.filter((item) => !deletedIds.includes(item.record_id)));
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/users/me/music-records')) {
        const index = Number(url.searchParams.get('cursor') ?? 0);
        return Response.json({
          data: {
            items: pages[index] ?? [],
            next_cursor: index + 1 < pages.length ? String(index + 1) : null,
            has_next: index + 1 < pages.length,
          },
        });
      }
      if (url.pathname.endsWith('/music/search')) {
        return Response.json({
          data: {
            items: [
              {
                music_id: null,
                provider: 'ITUNES',
                external_music_id: '123',
                title: '새 음악',
                artist_name: '가수',
                album_cover_url: null,
                preview_url: null,
                youtube_video_id: null,
                is_queueable: false,
              },
            ],
            next_cursor: null,
            has_next: false,
          },
        });
      }
      if (url.pathname.endsWith('/music-records/1')) {
        if (init?.method === 'DELETE') return new Response(null, { status: deleteStatus });
        return Response.json({ data: { ...record(1), updated_at: null } });
      }
      return Response.json({ data: null }, { status: 401 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearAccessToken();
});

const ready = async () => {
  const nationwide = await screen.findByRole('button', { name: '전국' });
  await waitFor(() => expect(nationwide).toBeEnabled());
  return nationwide;
};
const flush = async () => {
  await act(async () => {});
};
const tick = async (time: number) => {
  await act(async () => vi.advanceTimersByTimeAsync(time));
};
const deleteRecord = async (id: number) => {
  fireEvent.click(screen.getByRole('button', { name: '삭제할 기록 선택' }));
  fireEvent.click(screen.getByRole('button', { name: `노래 ${id} 기록 선택` }));
  fireEvent.click(screen.getByRole('button', { name: '선택한 기록 삭제 확인' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '확인' })));
};

describe('음악 기록 지역 필터 목록', () => {
  it('전체 페이지에서 존재하는 지역을 code순으로 유일화하고 전국 pagination을 보존한다', async () => {
    render(<MusicRecordListPage />);
    const nationwide = await ready();
    const group = screen.getByRole('group', { name: '음악 기록 지역 필터' });
    expect([...group.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      '전국',
      '서울',
      '인천',
      '제주',
    ]);
    expect(nationwide).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('검색 결과 2곡')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '인천' }));
    expect(screen.getByRole('link', { name: '노래 3 기록 상세 보기' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '노래 1 기록 상세 보기' })).not.toBeInTheDocument();
    expect(screen.getByText('검색 결과 1곡')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '더 불러오기' })).not.toBeInTheDocument();
    fireEvent.click(nationwide);
    expect(screen.getByText('검색 결과 2곡')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '더 불러오기' }));
    await screen.findByText('검색 결과 4곡');
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('?cursor=1'))).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '서울' }));
    expect(screen.getByText('검색 결과 3곡')).toBeInTheDocument();
    fireEvent.click(nationwide);
    expect(screen.getByText('검색 결과 4곡')).toBeInTheDocument();
  });

  it('빈 기록에는 가짜 전국/지역 버튼을 표시하지 않는다', async () => {
    pages = [[]];
    render(<MusicRecordListPage />);
    await screen.findByText('아직 기록한 음악이 없어요.');
    expect(screen.queryByRole('group', { name: '음악 기록 지역 필터' })).not.toBeInTheDocument();
  });

  it('모든 시도 짧은 이름과 알 수 없는 이름을 실제 데이터에서 표시한다', async () => {
    pages = [
      [record(1, '43', '충청북도'), record(2, '52', '전북특별자치도'), record(3, '99', '새 지역')],
    ];
    render(<MusicRecordListPage />);
    await ready();
    expect(screen.getByRole('button', { name: '충북' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '전북' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새 지역' })).toBeInTheDocument();
  });

  it('삭제 선택 중 전환을 잠그고 마지막 지역 삭제 성공 후 전국으로 복귀한다', async () => {
    render(<MusicRecordListPage />);
    const nationwide = await ready();
    fireEvent.click(screen.getByRole('button', { name: '인천' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제할 기록 선택' }));
    expect(nationwide).toBeDisabled();
    fireEvent.click(nationwide);
    expect(screen.getByRole('button', { name: '인천' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '노래 3 기록 선택' }));
    fireEvent.click(screen.getByRole('button', { name: '선택한 기록 삭제 확인' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '확인' })));
    await waitFor(() => expect(nationwide).toBeEnabled());
    expect(deletedIds).toEqual([3]);
    expect(nationwide).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '인천' })).not.toBeInTheDocument();
    expect(screen.getByText('1개의 기록이 삭제되었어요')).toBeInTheDocument();
    expect(vi.mocked(getAllMusicRecords)).toHaveBeenCalledTimes(2);
  });

  it('삭제 성공을 재조회 실패로 바꾸거나 삭제한 기록을 복원하지 않는다', async () => {
    vi.useFakeTimers();
    render(<MusicRecordListPage />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '인천' }));
    vi.mocked(getAllMusicRecords).mockRejectedValue(new MusicApiError(500, '실패'));
    await deleteRecord(3);
    expect(screen.getByRole('button', { name: '전국' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '인천' })).not.toBeInTheDocument();
    expect(screen.getByText('1개의 기록이 삭제되었어요')).toBeInTheDocument();
    await tick(6_000);
    expect(screen.getByText('지역 필터를 불러오지 못했어요.')).toBeInTheDocument();
    expect(
      screen.queryByText('기록을 삭제하지 못했어요. 다시 시도해 주세요.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '노래 3 기록 상세 보기' })).not.toBeInTheDocument();
  });

  it('삭제 실패 후 기존 새로고침이 snapshot도 갱신하고 사라진 지역을 해제한다', async () => {
    render(<MusicRecordListPage />);
    const nationwide = await ready();
    fireEvent.click(screen.getByRole('button', { name: '인천' }));
    deleteStatus = 404;
    await deleteRecord(3);
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    pages = [[record(1)]];
    fireEvent.click(screen.getByRole('button', { name: '목록 새로고침' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '인천' })).not.toBeInTheDocument(),
    );
    expect(nationwide).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('삭제할 음악 기록 0곡')).toBeInTheDocument();
    expect(vi.mocked(getAllMusicRecords)).toHaveBeenCalledTimes(2);
  });

  it('전국 또는 snapshot 로딩 동안 전환을 잠그고 키보드로 native 버튼을 사용할 수 있다', async () => {
    render(<MusicRecordListPage />);
    const nationwide = await ready();
    nationwide.focus();
    expect(nationwide).toHaveFocus();
    const pending = deferred<MusicRecord[]>();
    vi.mocked(getAllMusicRecords).mockReturnValue(pending.promise);
    deleteStatus = 404;
    await deleteRecord(1);
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    fireEvent.click(screen.getByRole('button', { name: '목록 새로고침' }));
    expect(nationwide).toBeDisabled();
    await act(async () => pending.resolve(pages.flat()));
    expect(nationwide).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '삭제 선택 종료' }));
    expect(nationwide).toBeEnabled();
  });

  it('snapshot 후속 페이지 인증 실패의 부분 결과를 노출하지 않는다', async () => {
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).includes('?cursor=1')) return Response.json({ data: null }, { status: 403 });
      return original(url, init);
    });
    render(<MusicRecordListPage />);
    await screen.findByText('지역 필터를 불러오지 못했어요.');
    expect(screen.getByText('검색 결과 2곡')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '음악 기록 지역 필터' })).not.toBeInTheDocument();
    expect(vi.mocked(getAllMusicRecords)).toHaveBeenCalledTimes(1);
  });
});

describe('지역 snapshot 재시도와 응답 세대', () => {
  beforeEach(() => vi.useFakeTimers());

  it('1초/2초/3초 뒤 정확히 세 번 더 시도하고 빈 전국에서도 최종 오류를 표시한다', async () => {
    pages = [[]];
    vi.mocked(getAllMusicRecords).mockRejectedValue(new MusicApiError(500, '일시 실패'));
    render(<MusicRecordListPage />);
    await flush();
    expect(getAllMusicRecords).toHaveBeenCalledTimes(1);
    await tick(999);
    expect(getAllMusicRecords).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(getAllMusicRecords).toHaveBeenCalledTimes(2);
    await tick(1_999);
    expect(getAllMusicRecords).toHaveBeenCalledTimes(2);
    await tick(1);
    expect(getAllMusicRecords).toHaveBeenCalledTimes(3);
    await tick(2_999);
    expect(getAllMusicRecords).toHaveBeenCalledTimes(3);
    await tick(1);
    expect(getAllMusicRecords).toHaveBeenCalledTimes(4);
    expect(screen.getByRole('alert')).toHaveTextContent('지역 필터를 불러오지 못했어요.');
    expect(screen.queryByRole('button', { name: '전국' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /재시도/ })).not.toBeInTheDocument();
    await tick(30_000);
    expect(getAllMusicRecords).toHaveBeenCalledTimes(4);
  });

  it.each([1, 2, 3])(
    '%i번째 추가 시도 성공에서 오류와 loading을 해제하고 추가 시도를 멈춘다',
    async (retry) => {
      const mock = vi.mocked(getAllMusicRecords).mockReset();
      for (let index = 0; index < retry; index += 1)
        mock.mockRejectedValueOnce(new Error('일시 실패'));
      mock.mockResolvedValue([record(3, '28', '인천광역시')]);
      const { result } = renderHook(useMusicRecordRegionFilter);
      await flush();
      expect(result.current.isSnapshotLoading).toBe(true);
      for (let index = 1; index <= retry; index += 1) await tick(index * 1_000);
      expect(result.current.regions).toEqual([{ code: '28', name: '인천' }]);
      expect(result.current.isSnapshotLoading).toBe(false);
      expect(result.current.snapshotError).toBe('');
      await tick(30_000);
      expect(mock).toHaveBeenCalledTimes(retry + 1);
    },
  );

  it.each([401, 403])('%i는 재시도 없이 오류로 종료한다', async (status) => {
    vi.mocked(getAllMusicRecords).mockRejectedValue(new MusicApiError(status, '권한 실패'));
    const { result } = renderHook(useMusicRecordRegionFilter);
    await flush();
    await tick(30_000);
    expect(getAllMusicRecords).toHaveBeenCalledTimes(1);
    expect(result.current.isSnapshotLoading).toBe(false);
    expect(result.current.regions).toEqual([]);
    expect(result.current.snapshotError).toBe('지역 필터를 불러오지 못했어요.');
  });

  it('새 요청 후 오래된 성공/실패가 상태나 후속 요청을 만들지 않는다', async () => {
    const stale = deferred<MusicRecord[]>();
    vi.mocked(getAllMusicRecords)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValue([record(2, '28', '인천광역시')]);
    const { result } = renderHook(useMusicRecordRegionFilter);
    await flush();
    await act(async () => result.current.refreshSnapshot());
    await act(async () => stale.reject(new Error('오래된 실패')));
    await tick(30_000);
    expect(getAllMusicRecords).toHaveBeenCalledTimes(2);
    expect(result.current.regions).toEqual([{ code: '28', name: '인천' }]);
    const oldSuccess = deferred<MusicRecord[]>();
    vi.mocked(getAllMusicRecords)
      .mockReturnValueOnce(oldSuccess.promise)
      .mockResolvedValue([record(5, '50', '제주특별자치도')]);
    await act(async () => result.current.refreshSnapshot());
    await act(async () => result.current.refreshSnapshot());
    await act(async () => oldSuccess.resolve([record(1)]));
    expect(result.current.regions).toEqual([{ code: '50', name: '제주' }]);
  });

  it('삭제 성공은 이전 재시도 타이머를 취소하고 삭제 IDs를 즉시 제거한다', async () => {
    vi.mocked(getAllMusicRecords)
      .mockResolvedValueOnce([record(1), record(3, '28', '인천광역시')])
      .mockRejectedValueOnce(new Error('이전 실패'))
      .mockResolvedValue([record(1)]);
    const { result } = renderHook(useMusicRecordRegionFilter);
    await flush();
    act(() => result.current.setSelectedSidoCode('28'));
    await act(async () => result.current.refreshSnapshot());
    await act(async () => result.current.removeFromSnapshot([3]));
    expect(result.current.selectedSidoCode).toBe(null);
    expect(result.current.regions).toEqual([{ code: '11', name: '서울' }]);
    await tick(30_000);
    expect(getAllMusicRecords).toHaveBeenCalledTimes(3);
  });

  it('삭제 성공 후 오래된 응답은 삭제 기록을 복원하지 않는다', async () => {
    const stale = deferred<MusicRecord[]>();
    vi.mocked(getAllMusicRecords)
      .mockResolvedValueOnce([record(1), record(3, '28', '인천광역시')])
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValue([record(1)]);
    const { result } = renderHook(useMusicRecordRegionFilter);
    await flush();
    await act(async () => result.current.refreshSnapshot());
    await act(async () => result.current.removeFromSnapshot([3]));
    await act(async () => stale.resolve([record(1), record(3, '28', '인천광역시')]));
    expect(result.current.regions).toEqual([{ code: '11', name: '서울' }]);
  });

  it('unmount는 대기 타이머를 취소하고 진행 중 실패도 추가 요청을 시작하지 않는다', async () => {
    vi.mocked(getAllMusicRecords).mockRejectedValue(new Error('실패'));
    const first = renderHook(useMusicRecordRegionFilter);
    await flush();
    first.unmount();
    await tick(30_000);
    expect(getAllMusicRecords).toHaveBeenCalledTimes(1);
    const pending = deferred<MusicRecord[]>();
    vi.mocked(getAllMusicRecords).mockReturnValue(pending.promise);
    const second = renderHook(useMusicRecordRegionFilter);
    await flush();
    second.unmount();
    await act(async () => pending.reject(new Error('언마운트 이후 실패')));
    await tick(30_000);
    expect(getAllMusicRecords).toHaveBeenCalledTimes(2);
  });

  it('StrictMode cleanup의 초기 작업을 무효화하고 최신 작업만 시작한다', async () => {
    vi.mocked(getAllMusicRecords).mockResolvedValue([record(1)]);
    const { result, unmount } = renderHook(useMusicRecordRegionFilter, { wrapper: StrictMode });
    await flush();
    expect(getAllMusicRecords).toHaveBeenCalledTimes(1);
    expect(result.current.regions).toEqual([{ code: '11', name: '서울' }]);
    vi.mocked(getAllMusicRecords).mockRejectedValue(new Error('실패'));
    await act(async () => result.current.refreshSnapshot());
    unmount();
    await tick(30_000);
    expect(getAllMusicRecords).toHaveBeenCalledTimes(2);
  });
});

function RecordRoutes() {
  const [route, setRoute] = useState(readRouteLocation);
  useEffect(() => {
    const update = () => setRoute(readRouteLocation());
    window.addEventListener(ROUTE_CHANGE_EVENT, update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener(ROUTE_CHANGE_EVENT, update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  if (route.pathname === '/music-records/new') return <MusicRecordCreatePage />;
  if (route.pathname === '/music-records/1') return <MusicRecordDetailPage recordId={1} />;
  return <MusicRecordListPage />;
}
const openSeoulDetail = async () => {
  render(<RecordRoutes />);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '서울' }));
  const link = screen.getByRole('link', { name: '노래 1 기록 상세 보기' });
  expect(link).toHaveAttribute('href', '/music-records/1?sido=11');
  fireEvent.click(link);
  await screen.findByRole('button', { name: '음악 변경' });
};
const expectSeoulList = async () => {
  await ready();
  expect(screen.getByRole('button', { name: '서울' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('검색 결과 3곡')).toBeInTheDocument();
  expect(window.location.search).toBe('?sido=11');
};
describe('상세 왕복 지역 선택 회귀', () => {
  it('상세 돌아가기와 목록 재마운트에서 서울 선택을 유지한다', async () => {
    await openSeoulDetail();
    fireEvent.click(screen.getByRole('button', { name: '음악 기록 목록으로 돌아가기' }));
    await expectSeoulList();
    cleanup();
    render(<MusicRecordListPage />);
    await expectSeoulList();
  });
  it('브라우저 뒤로가기로 선택한 목록을 복원한다', async () => {
    await openSeoulDetail();
    act(() => window.history.back());
    await expectSeoulList();
  });
  it.each(['save', 'delete', 'missing'] as const)('%s 완료 후 지역을 유지한다', async (action) => {
    await openSeoulDetail();
    if (action === 'save') {
      fireEvent.change(screen.getByPlaceholderText('장소 이름 (선택)'), {
        target: { value: '산책' },
      });
      fireEvent.click(screen.getByRole('button', { name: '저장' }));
    } else {
      if (action === 'missing') deleteStatus = 404;
      fireEvent.click(screen.getByRole('button', { name: '기록 삭제' }));
      fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));
    }
    await expectSeoulList();
  });
  it('음악 변경 검색에서 상세로 돌아와도 목록 지역을 유지한다', async () => {
    await openSeoulDetail();
    fireEvent.click(screen.getByRole('button', { name: '음악 변경' }));
    expect(new URLSearchParams(window.location.search).get('replaceRecordId')).toBe('1');
    expect(new URLSearchParams(window.location.search).get('sido')).toBe('11');
    fireEvent.click(screen.getByRole('button', { name: '음악 기록 상세로 돌아가기' }));
    await screen.findByRole('button', { name: '음악 변경' });
    fireEvent.click(screen.getByRole('button', { name: '음악 기록 목록으로 돌아가기' }));
    await expectSeoulList();
  });
  it('검색한 음악 선택 후 상세와 목록 복귀도 지역을 유지한다', async () => {
    await openSeoulDetail();
    fireEvent.click(screen.getByRole('button', { name: '음악 변경' }));
    fireEvent.change(screen.getByPlaceholderText('곡 제목, 아티스트 검색'), {
      target: { value: '새 음악' },
    });
    fireEvent.click(
      within(await screen.findByRole('group', { name: '새 음악 가수' })).getAllByRole('button')[0],
    );
    fireEvent.click(screen.getByRole('button', { name: '이 곡으로 변경' }));
    await screen.findByRole('button', { name: '음악 변경' });
    expect(window.location.search).toBe('?sido=11');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await expectSeoulList();
  });
  it('경로의 기존 query/hash와 특수문자 지역을 안전하게 보존한다', () => {
    const path = musicRecordFilterPath(
      '/music-records/new?replaceRecordId=1&other=x#details',
      'a&b',
    );
    const url = new URL(path, window.location.origin);
    expect(url.searchParams.get('sido')).toBe('a&b');
    expect(url.searchParams.get('replaceRecordId')).toBe('1');
    expect(url.searchParams.get('other')).toBe('x');
    expect(url.hash).toBe('#details');
    expect(musicRecordFilterPath(path, null)).toBe(
      '/music-records/new?replaceRecordId=1&other=x#details',
    );
  });
  it('선택과 전국 해제가 다른 query/hash/state를 보존하고 history를 늘리지 않고 변경 시 라우트를 동기화한다', async () => {
    const state = { meomuneumPreviousRoute: '/my', extra: 7 };
    window.history.replaceState(state, '', '/music-records?tab=recent#records');
    const length = window.history.length;
    const routeEvent = vi.fn();
    window.addEventListener(ROUTE_CHANGE_EVENT, routeEvent);
    render(<MusicRecordListPage />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '서울' }));
    expect(new URLSearchParams(window.location.search).get('sido')).toBe('11');
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('recent');
    expect(window.location.hash).toBe('#records');
    expect(window.history.state).toEqual(state);
    expect(window.history.length).toBe(length);
    expect(routeEvent).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '전국' }));
    expect(window.location.search).toBe('?tab=recent');
    expect(window.location.hash).toBe('#records');
    expect(window.history.state).toEqual(state);
    expect(routeEvent).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '전국' }));
    expect(routeEvent).toHaveBeenCalledTimes(2);
    window.removeEventListener(ROUTE_CHANGE_EVENT, routeEvent);
  });
  it.each(['resolve', 'reject'] as const)(
    'snapshot %s 전에도 URL 선택을 유지한다',
    async (outcome) => {
      window.history.replaceState(null, '', '/music-records?sido=11');
      const pending = deferred<MusicRecord[]>();
      vi.mocked(getAllMusicRecords).mockReturnValue(pending.promise);
      const { result } = renderHook(useMusicRecordRegionFilter);
      expect(result.current.selectedSidoCode).toBe('11');
      await flush();
      expect(window.location.search).toBe('?sido=11');
      if (outcome === 'resolve') await act(async () => pending.resolve(pages.flat()));
      else await act(async () => pending.reject(new MusicApiError(403, '실패')));
      expect(result.current.selectedSidoCode).toBe('11');
      expect(window.location.search).toBe('?sido=11');
    },
  );
  it('지역 선택 후 실제 App 인증 만료 리다이렉트가 지역을 포함한 returnTo를 보존한다', async () => {
    setAccessToken(
      `test.${window.btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`,
    );
    render(<App />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '서울' }));
    await act(async () => window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT)));
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    expect(new URLSearchParams(window.location.search).get('returnTo')).toBe(
      '/music-records?sido=11',
    );
    expect(screen.getByLabelText('이메일')).toBeInTheDocument();
  });
  it('없는 URL 지역은 성공 snapshot 검증 후에만 전국으로 정리한다', async () => {
    window.history.replaceState(null, '', '/music-records?tab=recent&sido=99#records');
    const pending = deferred<MusicRecord[]>();
    vi.mocked(getAllMusicRecords).mockReturnValue(pending.promise);
    const { result } = renderHook(useMusicRecordRegionFilter);
    await flush();
    expect(result.current.selectedSidoCode).toBe('99');
    await act(async () => pending.resolve(pages.flat()));
    expect(result.current.selectedSidoCode).toBe(null);
    expect(window.location.search).toBe('?tab=recent');
    expect(window.location.hash).toBe('#records');
  });
});
