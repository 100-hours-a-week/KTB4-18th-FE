import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMusicRecord, getMusicRecords, type Music, type MusicRecord, type MusicRecordDetail,
} from './api/musicRecordsApi';
import { MusicRecordCreatePage, MusicRecordListPage } from './components/MusicRecordPages';
import { MusicRecordDetailPage } from './components/MusicRecordDetailPage';

const region = {
  sido: { region_id: 1, code: '11', name: '서울특별시' },
  sigungu: { region_id: 2, code: '11440', name: '마포구' },
};
const music: Music = {
  music_id: null, provider: 'ITUNES', external_music_id: '123', title: '밤편지',
  artist_name: '아이유', album_cover_url: null, preview_url: null,
  youtube_video_id: null, is_queueable: false,
};
const summary = { music_id: 11, title: music.title, artist_name: music.artist_name, album_cover_url: null };

let records: MusicRecord[];
let detail: MusicRecordDetail;

describe('원본 API 계약의 음악 기록 흐름', () => {
  beforeEach(() => {
    records = [];
    detail = {
      record_id: 1, music: summary, map_dot_id: 5, region,
      custom_place_name: '홍대', emotion_memo: '산책 중',
      created_at: '2026-09-22T06:30:00Z', updated_at: null,
    };
    sessionStorage.setItem('access_token', 'test-access-token');
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/token/csrf')) {
        return Response.json({ message: 'csrf token issued', data: { csrf_token: 'test-csrf-token' } });
      }
      if (url.endsWith('/api/v1/music-records') && init?.method === 'POST') {
        const request = JSON.parse(String(init.body)) as { custom_place_name: string | null; emotion_memo: string | null };
        records = [{ ...detail, custom_place_name: request.custom_place_name, emotion_memo: request.emotion_memo }];
        return Response.json({ message: 'music record created', data: {
          record_id: 1, map_dot_id: 5, region, custom_place_name: request.custom_place_name,
          created_at: detail.created_at,
        } }, { status: 201 });
      }
      if (url.endsWith('/api/v1/users/me/music-records')) {
        return Response.json({ message: 'my music records retrieved', data: {
          items: records, next_cursor: null, has_next: false,
        } });
      }
      if (url.endsWith('/api/v1/music-records/1') && init?.method === 'PATCH') {
        const changes = JSON.parse(String(init.body)) as Partial<MusicRecordDetail>;
        detail = { ...detail, ...changes, updated_at: '2026-09-23T06:30:00Z' };
        return Response.json({ message: 'music record updated', data: { record_id: 1, updated_at: detail.updated_at } });
      }
      if (url.endsWith('/api/v1/music-records/1')) {
        return Response.json({ message: 'music record retrieved', data: detail });
      }
      if (url.includes('/api/v1/music/search')) {
        return Response.json({ message: 'music search completed', data: {
          items: [music], next_cursor: null, has_next: false,
        } });
      }
      return Response.json({ message: 'not found', data: null }, { status: 404 });
    }));
  });

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });

  it('생성 요청은 음악 식별자와 위치 토큰만 전송하고 목록을 별도로 조회한다', async () => {
    const created = await createMusicRecord(music, 'location-token', '홍대', '산책 중');
    expect(created.record_id).toBe(1);
    const post = vi.mocked(fetch).mock.calls.find(([url, init]) =>
      String(url).endsWith('/api/v1/music-records') && init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      music: { provider: 'ITUNES', external_music_id: '123' },
      location_resolution_token: 'location-token', custom_place_name: '홍대', emotion_memo: '산책 중',
    });
    const page = await getMusicRecords();
    expect(page.items).toHaveLength(1);
    render(<MusicRecordListPage />);
    expect(await screen.findByRole('heading', { name: '밤편지' })).toBeInTheDocument();
    expect(screen.getByText('2026.09.22. 오후 3:30')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '밤편지 기록 상세 보기' }))
      .toHaveAttribute('href', '/music-records/1');
  });

  it('2자 이상 입력 후 검색하고 곡 선택·다음 이후에만 입력 화면을 표시한다', async () => {
    render(<MusicRecordCreatePage />);
    const input = screen.getByRole('textbox', { name: '음악 검색' });
    fireEvent.change(input, { target: { value: '밤' } });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/music/search'))).toBe(false);
    fireEvent.change(input, { target: { value: '밤편지' } });
    const result = await screen.findByRole('button', { name: /밤편지/ });
    const searchUrl = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/music/search'))?.[0];
    expect(String(searchUrl)).toContain('query=%EB%B0%A4%ED%8E%B8%EC%A7%80');
    expect(String(searchUrl)).toContain('provider=ITUNES');
    expect(String(searchUrl)).toContain('size=20');
    const next = screen.getByRole('button', { name: '다음' });
    expect(next).toBeDisabled();
    fireEvent.click(result);
    expect(next).toBeEnabled();
    expect(screen.queryByRole('region', { name: '음악 기록 입력' })).not.toBeInTheDocument();
    fireEvent.click(next);
    expect(screen.getByRole('region', { name: '음악 기록 입력' })).toBeInTheDocument();
  });

  it('커서 페이지의 선조회 지점이 누적 10번째에서 30번째로 이동한다', async () => {
    let onIntersect: IntersectionObserverCallback = () => undefined;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { onIntersect = callback; }
      observe() {}
      disconnect() {}
    });
    const makeMusic = (number: number): Music => ({
      ...music, external_music_id: String(number), title: `곡 ${number}`,
    });
    vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.includes('/music/search')) {
        const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
        const page = cursor === 'next2' ? 2 : cursor === 'next' ? 1 : 0;
        return Promise.resolve(Response.json({ data: {
          items: Array.from({ length: 20 }, (_, index) => makeMusic(page * 20 + index + 1)),
          next_cursor: page === 0 ? 'next' : page === 1 ? 'next2' : null,
          has_next: page < 2,
        } }));
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<MusicRecordCreatePage />);
    fireEvent.change(screen.getByRole('textbox', { name: '음악 검색' }), { target: { value: '곡 제목' } });
    await screen.findByRole('button', { name: /곡 20/ });
    const firstSentinel = screen.getByTestId('music-page-sentinel');
    expect(firstSentinel.parentElement).toContainElement(screen.getByRole('button', { name: /곡 10/ }));
    onIntersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await screen.findByRole('button', { name: /곡 40/ });
    expect(screen.getByTestId('music-page-sentinel').parentElement)
      .toContainElement(screen.getByRole('button', { name: /곡 30/ }));
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/music/search'))).toHaveLength(2);
    onIntersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/music/search'))).toHaveLength(2);
    onIntersect([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    onIntersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/music/search'))).toHaveLength(2);
    vi.stubGlobal('scrollY', 100);
    fireEvent.scroll(window);
    await screen.findByRole('button', { name: /곡 60/ });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/music/search'))).toHaveLength(3);
  });

  it('커서 400 후 첫 페이지를 한 번만 재조회하고 새 커서로 다음 페이지를 읽는다', async () => {
    let onIntersect: IntersectionObserverCallback = () => undefined;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { onIntersect = callback; }
      observe() {}
      disconnect() {}
    });
    let firstPageCount = 0;
    vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
      const cursor = new URL(String(input), 'http://localhost').searchParams.get('cursor');
      if (cursor === 'broken') return Promise.resolve(Response.json({ message: 'search query required', data: null }, { status: 400 }));
      if (cursor === 'fresh') return Promise.resolve(Response.json({ data: {
        items: [{ ...music, external_music_id: 'new', title: '다음 곡' }],
        next_cursor: null, has_next: false,
      } }));
      firstPageCount += 1;
      return Promise.resolve(Response.json({ data: {
        items: Array.from({ length: 20 }, (_, index) => ({ ...music, external_music_id: String(index), title: `곡 ${index}` })),
        next_cursor: firstPageCount === 1 ? 'broken' : 'fresh', has_next: true,
      } }));
    }));
    render(<MusicRecordCreatePage />);
    fireEvent.change(screen.getByRole('textbox', { name: '음악 검색' }), { target: { value: '음악' } });
    await screen.findByRole('button', { name: /곡 19/ });
    onIntersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await waitFor(() => expect(firstPageCount).toBe(2));
    vi.stubGlobal('scrollY', 100);
    onIntersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(await screen.findByRole('button', { name: /다음 곡/ })).toBeInTheDocument();
    expect(firstPageCount).toBe(2);
  });

  it('검색 중 입력을 한 글자로 줄이면 로딩 표시를 지우고 늦은 결과를 버린다', async () => {
    let completeSearch!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { completeSearch = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => pending));
    render(<MusicRecordCreatePage />);
    const input = screen.getByRole('textbox', { name: '음악 검색' });
    fireEvent.change(input, { target: { value: '음악' } });
    expect(await screen.findByRole('status')).toHaveTextContent('검색 중');
    fireEvent.change(input, { target: { value: '음' } });
    expect(screen.queryByText('검색 중…')).not.toBeInTheDocument();
    completeSearch(Response.json({ data: { items: [music], next_cursor: null, has_next: false } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('button', { name: /밤편지/ })).not.toBeInTheDocument();
  });

  it('상세 화면에서 변경 전에는 저장할 수 없고 메모만 PATCH한다', async () => {
    render(<MusicRecordDetailPage recordId={1} />);
    const save = await screen.findByRole('button', { name: '저장' });
    expect(save).toBeDisabled();
    expect(screen.queryByRole('button', { name: '변경' })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('서울특별시 마포구')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByRole('textbox', { name: '지금 느끼는 것 기록' }), {
      target: { value: '새로운 기분' },
    });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(detail.emotion_memo).toBe('새로운 기분'));
    const patch = vi.mocked(fetch).mock.calls.find(([url, init]) =>
      String(url).endsWith('/music-records/1') && init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ emotion_memo: '새로운 기분' });
  });
});
