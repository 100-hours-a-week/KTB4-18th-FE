import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAccessToken, setAccessToken } from '../auth-login/api/authSession';
import { fetchMapDots, invalidateMapDotsCache } from '../mainMap/mapApi';
import { deleteMusicRecord, MusicApiError, type MusicRecordDetail } from './api/musicRecordsApi';
import { MusicRecordDetailPage } from './components/MusicRecordDetailPage';
import { MusicRecordListPage } from './components/MusicRecordPages';

const detail: MusicRecordDetail = {
  record_id: 7,
  music: { music_id: 11, title: '밤편지', artist_name: '아이유', album_cover_url: null },
  map_dot_id: 5,
  region: {
    sido: { region_id: 1, code: '11', name: '서울특별시' },
    sigungu: { region_id: 2, code: '11440', name: '마포구' },
  },
  custom_place_name: '홍대',
  emotion_memo: '산책 중',
  created_at: '2026-09-22T06:30:00Z',
  updated_at: null,
};
const mapData = {
  items: [{ map_dot_id: 5, code: 'dot-5', album_cover_url: null, latest_recorded_at: null }],
};

describe('음악 기록 삭제', () => {
  let records: MusicRecordDetail[];
  let deleteResponse: () => Promise<Response>;

  beforeEach(() => {
    sessionStorage.clear();
    setAccessToken('test-access-token');
    window.history.replaceState(null, '', '/music-records/7');
    invalidateMapDotsCache();
    records = [detail];
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
          return Response.json({ data: { csrf_token: 'test-csrf' } });
        if (url.endsWith('/auth/token/refresh'))
          return Response.json({ message: 'unauthorized', data: null }, { status: 401 });
        if (url.endsWith('/music-records/7') && init?.method === 'DELETE') return deleteResponse();
        if (url.endsWith('/music-records/7')) return Response.json({ message: 'ok', data: detail });
        if (url.includes('/users/me/music-records'))
          return Response.json({ data: { items: records, has_next: false, next_cursor: null } });
        if (url.endsWith('/map-dots'))
          return Response.json({ data: mapData }, { headers: { ETag: 'before-delete' } });
        return Response.json({ message: 'unexpected request', data: null }, { status: 500 });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    clearAccessToken();
  });

  const deleteCalls = () =>
    vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'DELETE');
  async function openDelete() {
    const button = await screen.findByRole('button', { name: '기록 삭제' });
    button.focus();
    fireEvent.click(button);
    return screen.getByRole('dialog', { name: '음악 기록을 삭제할까요?' });
  }

  it('취소와 Escape는 요청을 보내지 않고 기록과 원래 포커스를 유지한다', async () => {
    render(<MusicRecordDetailPage recordId={7} />);
    await openDelete();
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(deleteCalls()).toHaveLength(0);
    expect(screen.getByRole('button', { name: '기록 삭제' })).toHaveFocus();
    const dialog = await openDelete();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
    expect(screen.getByText('밤편지')).toBeInTheDocument();
  });

  it('204 성공 후 목록으로 돌아가며 마지막 기록을 지우고 지도 캐시를 갱신한다', async () => {
    const signal = new AbortController().signal;
    await fetchMapDots(signal);
    const view = render(<MusicRecordDetailPage recordId={7} />);
    await openDelete();
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));
    await waitFor(() => expect(window.location.pathname).toBe('/music-records'));
    expect(deleteCalls()).toHaveLength(1);
    const [, options] = deleteCalls()[0];
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer test-access-token');
    expect(options?.body).toBeUndefined();
    view.unmount();
    render(<MusicRecordListPage />);
    expect(await screen.findByText('아직 기록한 음악이 없어요.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('기록이 삭제되었어요');
    await fetchMapDots(signal);
    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/map-dots'));
    expect(new Headers(calls.at(-1)?.[1]?.headers).has('If-None-Match')).toBe(false);
  });

  it('처리 중 중복 클릭·취소·수정을 막고 성공 전까지 기록을 유지한다', async () => {
    let resolveDelete!: (value: Response) => void;
    deleteResponse = () =>
      new Promise((resolve) => {
        resolveDelete = resolve;
      });
    render(<MusicRecordDetailPage recordId={7} />);
    const dialog = await openDelete();
    const confirm = screen.getByRole('button', { name: '삭제 확인' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(screen.getByRole('button', { name: '취소' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    expect(window.location.pathname).toBe('/music-records/7');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => resolveDelete(new Response(null, { status: 204 })));
    expect(window.location.pathname).toBe('/music-records');
  });

  it.each([
    [401, '다시 로그인'],
    [403, '본인이 작성한'],
    [500, '다시 시도'],
  ])('%i 실패 시 기록을 유지하고 복구 안내를 제공한다', async (status, message) => {
    deleteResponse = async () => Response.json({ message: 'failed', data: null }, { status });
    render(<MusicRecordDetailPage recordId={7} />);
    await openDelete();
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(records).toHaveLength(1);
    expect(window.location.pathname).toBe('/music-records/7');
    expect(screen.getByRole('button', { name: '삭제 확인' })).toBeEnabled();
  });

  it('이미 삭제된 404 기록은 성공으로 표시하지 않고 목록을 다시 조회한다', async () => {
    records = [];
    deleteResponse = async () =>
      Response.json({ message: 'music record not found', data: null }, { status: 404 });
    const view = render(<MusicRecordDetailPage recordId={7} />);
    await openDelete();
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));
    await waitFor(() => expect(window.location.pathname).toBe('/music-records'));
    view.unmount();
    render(<MusicRecordListPage />);
    expect(await screen.findByText('아직 기록한 음악이 없어요.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('이미 삭제되었거나 없는 기록');
  });

  it('204가 아닌 성공 응답은 삭제 성공으로 간주하지 않는다', async () => {
    deleteResponse = async () => Response.json({ message: 'ok', data: {} });
    await expect(deleteMusicRecord(7)).rejects.toBeInstanceOf(MusicApiError);
    expect(records).toHaveLength(1);
  });

  it('네트워크 오류 후 확인을 다시 누르면 정상 삭제할 수 있다', async () => {
    deleteResponse = async () => {
      throw new TypeError('network failed');
    };
    render(<MusicRecordDetailPage recordId={7} />);
    await openDelete();
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('다시 시도');
    deleteResponse = async () => new Response(null, { status: 204 });
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));
    await waitFor(() => expect(window.location.pathname).toBe('/music-records'));
    expect(deleteCalls()).toHaveLength(2);
  });

  it('페이지 이탈 후 늦은 삭제 응답이 사용자를 목록으로 강제 이동시키지 않는다', async () => {
    let resolveDelete!: (value: Response) => void;
    deleteResponse = () =>
      new Promise((resolve) => {
        resolveDelete = resolve;
      });
    const view = render(<MusicRecordDetailPage recordId={7} />);
    await openDelete();
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    view.unmount();
    window.history.replaceState(null, '', '/');
    await act(async () => resolveDelete(new Response(null, { status: 204 })));
    expect(window.location.pathname).toBe('/');
  });

  it('응답 제한 시간 초과는 삭제 성공으로 표시하지 않고 재시도를 안내한다', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    deleteResponse = async () => {
      const reason = new DOMException('request timed out', 'TimeoutError');
      controller.abort(reason);
      throw reason;
    };
    render(<MusicRecordDetailPage recordId={7} />);
    await openDelete();
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('삭제 응답 시간이 초과');
    expect(window.location.pathname).toBe('/music-records/7');
    expect(records).toHaveLength(1);
  });
});
