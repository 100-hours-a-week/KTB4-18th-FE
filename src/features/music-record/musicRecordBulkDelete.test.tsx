import { StrictMode } from 'react';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAccessToken, setAccessToken } from '../auth-login/api/authSession';
import { fetchMapDots, invalidateMapDotsCache } from '../mainMap/mapApi';
import { MusicRecordListPage } from './components/MusicRecordPages';
import { deleteMusicRecords, MusicApiError, type MusicRecord } from './api/musicRecordsApi';

const record = (id: number): MusicRecord => ({
  record_id: id,
  music: { music_id: 11, title: `노래 ${id}`, artist_name: '가수', album_cover_url: null },
  map_dot_id: 5,
  region: {
    sido: { region_id: 1, code: '11', name: '서울특별시' },
    sigungu: { region_id: 2, code: '11440', name: '마포구' },
  },
  custom_place_name: '홍대',
  emotion_memo: null,
  created_at: '2026-09-22T06:30:00Z',
});

describe('음악 기록 다중 선택 삭제', () => {
  let records: MusicRecord[];
  let deleteResponse: () => Promise<Response>;
  let hasNext: boolean;
  beforeEach(() => {
    sessionStorage.clear();
    setAccessToken('test-access-token');
    window.history.replaceState(null, '', '/music-records');
    invalidateMapDotsCache();
    records = [record(7), record(8)];
    hasNext = false;
    deleteResponse = async () => {
      records = [];
      return new Response(null, { status: 204 });
    };
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
      this.querySelector<HTMLButtonElement>('button')?.focus();
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/auth/token/csrf'))
          return Response.json({ data: { csrf_token: 'csrf' } });
        if (url.endsWith('/auth/token/refresh'))
          return Response.json({ message: 'unauthorized', data: null }, { status: 401 });
        if (url.endsWith('/music-records') && init?.method === 'DELETE') return deleteResponse();
        if (url.includes('/users/me/music-records'))
          return Response.json({
            data: {
              items: url.includes('cursor=') ? [record(9)] : records,
              next_cursor: hasNext && !url.includes('cursor=') ? 'next' : null,
              has_next: hasNext && !url.includes('cursor='),
            },
          });
        if (url.endsWith('/map-dots'))
          return Response.json({ data: { items: [] } }, { headers: { ETag: 'before' } });
        return Response.json({ message: 'unexpected', data: null }, { status: 500 });
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
  const deleteCalls = () =>
    vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'DELETE');
  const enter = async () => {
    const button = await screen.findByRole('button', { name: '삭제할 기록 선택' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
  };
  const select = (id: number) =>
    fireEvent.click(screen.getByRole('button', { name: `노래 ${id} 기록 선택` }));
  const confirm = () => {
    fireEvent.click(screen.getByRole('button', { name: '선택한 기록 삭제 확인' }));
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
  };

  it.each([
    ['music_record_deleted', '기록이 삭제되었어요'],
    ['music_record_updated', '기록이 수정되었어요'],
  ])('%s 완료 안내를 한 번만 표시하고 3초 뒤 숨긴다', async (flag, message) => {
    vi.useFakeTimers();
    sessionStorage.setItem(flag, '1');
    const view = render(
      <StrictMode>
        <MusicRecordListPage />
      </StrictMode>,
    );
    const back = screen.getByRole('link', { name: '메인으로 돌아가기' });
    back.focus();
    await act(async () => {});

    const toast = screen.getByRole('status');
    expect(toast).toHaveClass('music-record-toast');
    expect(toast).toHaveTextContent(message);
    expect(toast).toHaveAttribute('aria-live', 'polite');
    expect(toast).toHaveAttribute('aria-atomic', 'true');
    expect(toast.closest('.music-list-content')).toBeNull();
    expect(back).toHaveFocus();
    expect(sessionStorage.getItem(flag)).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(2_999));
    expect(screen.getByText(message)).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryByText(message)).not.toBeInTheDocument();

    view.unmount();
    await act(async () => {
      render(<MusicRecordListPage />);
    });
    expect(screen.queryByText(message)).not.toBeInTheDocument();
  });

  it('연속으로 같은 개수를 삭제해도 마지막 완료 시점부터 3초간 표시한다', async () => {
    vi.useFakeTimers();
    deleteResponse = async () => {
      records = records.slice(1);
      return new Response(null, { status: 204 });
    };
    await act(async () => {
      render(<MusicRecordListPage />);
    });
    const remove = async (id: number) => {
      fireEvent.click(screen.getByRole('button', { name: '삭제할 기록 선택' }));
      select(id);
      fireEvent.click(screen.getByRole('button', { name: '선택한 기록 삭제 확인' }));
      await act(async () => fireEvent.click(screen.getByRole('button', { name: '확인' })));
    };
    await remove(7);
    expect(screen.getByText('1개의 기록이 삭제되었어요')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    await remove(8);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByText('1개의 기록이 삭제되었어요')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1_999));
    expect(screen.getByText('1개의 기록이 삭제되었어요')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryByText('1개의 기록이 삭제되었어요')).not.toBeInTheDocument();
  });

  it('다른 작업 완료 메시지로 갱신하고 화면을 벗어나면 타이머를 정리한다', async () => {
    vi.useFakeTimers();
    sessionStorage.setItem('music_record_updated', '1');
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<MusicRecordListPage />);
    });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    fireEvent.click(screen.getByRole('button', { name: '삭제할 기록 선택' }));
    select(7);
    select(8);
    fireEvent.click(screen.getByRole('button', { name: '선택한 기록 삭제 확인' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '확인' })));
    expect(screen.queryByText('기록이 수정되었어요')).not.toBeInTheDocument();
    expect(screen.getByText('2개의 기록이 삭제되었어요')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByText('2개의 기록이 삭제되었어요')).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      render(<MusicRecordListPage />);
    });
    expect(screen.queryByText('2개의 기록이 삭제되었어요')).not.toBeInTheDocument();
  });

  it('선택 표시와 해제, 모드 취소를 제공하며 상세로 이동하지 않는다', async () => {
    render(<MusicRecordListPage />);
    await enter();
    expect(screen.queryByText('기록하기')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '삭제 선택 종료' })).toBeEnabled();
    select(7);
    select(8);
    expect(screen.getByRole('button', { name: '노래 7 기록 선택' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '노래 7 기록 선택' })).toHaveClass('selected');
    expect(screen.getByRole('status')).toHaveTextContent('삭제할 음악 기록 2곡');
    expect(window.location.pathname).toBe('/music-records');
    select(7);
    expect(screen.getByRole('button', { name: '노래 7 기록 선택' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    select(8);
    fireEvent.click(screen.getByRole('button', { name: '삭제 선택 종료' }));
    expect(screen.getByRole('link', { name: '노래 7 기록 상세 보기' })).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
  });

  it('확인 취소는 요청하지 않고 선택과 포커스를 유지한다', async () => {
    render(<MusicRecordListPage />);
    await enter();
    select(7);
    const trigger = screen.getByRole('button', { name: '선택한 기록 삭제 확인' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(trigger).toHaveFocus();
    expect(deleteCalls()).toHaveLength(0);
    expect(screen.getByRole('button', { name: '노래 7 기록 선택' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('선택 ID만 한 요청으로 삭제하고 캐시와 빈 목록을 갱신한다', async () => {
    await fetchMapDots(new AbortController().signal);
    render(<MusicRecordListPage />);
    await enter();
    select(7);
    select(8);
    confirm();
    await screen.findByText('아직 기록한 음악이 없어요.');
    expect(screen.getByText('2개의 기록이 삭제되었어요')).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(1);
    const options = deleteCalls()[0][1]!;
    expect(JSON.parse(options.body as string)).toEqual({ record_ids: [7, 8] });
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-access-token');
    await fetchMapDots(new AbortController().signal);
    const maps = vi
      .mocked(fetch)
      .mock.calls.filter(([input]) => String(input).endsWith('/map-dots'));
    expect(new Headers(maps.at(-1)![1]?.headers).has('If-None-Match')).toBe(false);
  });

  it('처리 중 선택 변경, 취소와 중복 삭제를 차단한다', async () => {
    let resolve!: (value: Response) => void;
    deleteResponse = () =>
      new Promise((done) => {
        resolve = done;
      });
    render(<MusicRecordListPage />);
    await enter();
    select(7);
    confirm();
    const pending = screen.getByRole('button', { name: '삭제 중…' });
    fireEvent.click(pending);
    expect(pending).toBeDisabled();
    expect(screen.getByRole('button', { name: '노래 8 기록 선택' })).toBeDisabled();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    await act(async () => resolve(new Response(null, { status: 204 })));
    await screen.findByText('1개의 기록이 삭제되었어요');
  });

  it.each([401, 403, 404, 500])('%s 오류에서는 기록과 선택을 유지한다', async (status) => {
    deleteResponse = async () => Response.json({ message: 'error', data: null }, { status });
    render(<MusicRecordListPage />);
    await enter();
    select(7);
    confirm();
    await screen.findByRole('alert');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '노래 7 기록 선택' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByText('1개의 기록이 삭제되었어요')).not.toBeInTheDocument();
  });

  it('더 불러온 기록도 기존 선택을 유지하며 함께 선택한다', async () => {
    hasNext = true;
    render(<MusicRecordListPage />);
    await enter();
    select(7);
    fireEvent.click(screen.getByRole('button', { name: '더 불러오기' }));
    await screen.findByRole('button', { name: '노래 9 기록 선택' });
    select(9);
    expect(screen.getByText('삭제할 음악 기록 2곡')).toBeInTheDocument();
  });

  it('최대 100개 이후 새 선택을 막고 선택 해제는 허용한다', async () => {
    records = Array.from({ length: 101 }, (_, index) => record(index + 1));
    render(<MusicRecordListPage />);
    await enter();
    const cards = screen.getAllByRole('button', { name: /^노래 \d+ 기록 선택$/ });
    for (const card of cards.slice(0, 100)) fireEvent.click(card);
    expect(screen.getByRole('button', { name: '노래 101 기록 선택' })).toBeDisabled();
    select(1);
    expect(screen.getByRole('button', { name: '노래 101 기록 선택' })).toBeEnabled();
  });

  it('204 이외 성공 응답을 성공으로 오인하지 않는다', async () => {
    deleteResponse = async () => Response.json({ data: {} });
    await expect(deleteMusicRecords([7])).rejects.toBeInstanceOf(MusicApiError);
  });

  it('시간 초과 시 삭제를 단정하지 않고 재조회 방법을 안내한다', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    deleteResponse = async () => {
      controller.abort(new DOMException('timeout', 'TimeoutError'));
      throw controller.signal.reason;
    };
    render(<MusicRecordListPage />);
    await enter();
    select(7);
    confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('목록을 새로고침해 결과를 확인');
    fireEvent.click(screen.getAllByRole('button', { name: '취소' }).at(-1)!);
    fireEvent.click(screen.getByRole('button', { name: '목록 새로고침' }));
    await waitFor(() => expect(screen.getByText('삭제할 음악 기록 0곡')).toBeInTheDocument());
    expect(screen.getByText('노래 7')).toBeInTheDocument();
  });

  it('페이지 이탈 후 응답으로 다른 화면을 변경하지 않는다', async () => {
    let resolve!: (value: Response) => void;
    deleteResponse = () =>
      new Promise((done) => {
        resolve = done;
      });
    const view = render(<MusicRecordListPage />);
    await enter();
    select(7);
    confirm();
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    view.unmount();
    window.history.replaceState(null, '', '/mypage');
    await act(async () => resolve(new Response(null, { status: 204 })));
    expect(window.location.pathname).toBe('/mypage');
    expect(screen.queryByText('1개의 기록이 삭제되었어요')).not.toBeInTheDocument();
  });
});
