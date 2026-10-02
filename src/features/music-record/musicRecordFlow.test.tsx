import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMusicRecord,
  getMusicRecords,
  searchMusic,
  type Music,
  type MusicRecord,
  type MusicRecordDetail,
} from './api/musicRecordsApi';
import { MusicRecordCreatePage, MusicRecordListPage } from './components/MusicRecordPages';
import { MusicRecordDetailPage } from './components/MusicRecordDetailPage';
import { clearAccessToken, setAccessToken } from '../auth-login/api/authSession';

const region = {
  sido: { region_id: 1, code: '11', name: '서울특별시' },
  sigungu: { region_id: 2, code: '11440', name: '마포구' },
};
const music: Music = {
  music_id: null,
  provider: 'ITUNES',
  external_music_id: '123',
  title: '밤편지',
  artist_name: '아이유',
  album_cover_url: null,
  preview_url: null,
  youtube_video_id: null,
  is_queueable: false,
};
const summary = {
  music_id: 11,
  title: music.title,
  artist_name: music.artist_name,
  album_cover_url: null,
};

let records: MusicRecord[];
let detail: MusicRecordDetail;
let searchItems: Music[];
const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');

describe('원본 API 계약의 음악 기록 흐름', () => {
  beforeEach(() => {
    records = [];
    searchItems = [music];
    detail = {
      record_id: 1,
      music: summary,
      map_dot_id: 5,
      region,
      custom_place_name: '홍대',
      emotion_memo: '산책 중',
      created_at: '2026-09-22T06:30:00Z',
      updated_at: null,
    };
    setAccessToken('test-access-token');
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/v1/auth/token/csrf')) {
          return Response.json({
            message: 'csrf token issued',
            data: { csrf_token: 'test-csrf-token' },
          });
        }
        if (url.endsWith('/api/v1/locations/resolve')) {
          return Response.json({ message: 'location unavailable', data: null }, { status: 404 });
        }
        if (url.endsWith('/api/v1/music-records') && init?.method === 'POST') {
          const request = JSON.parse(String(init.body)) as {
            custom_place_name: string | null;
            emotion_memo: string | null;
          };
          records = [
            {
              ...detail,
              custom_place_name: request.custom_place_name,
              emotion_memo: request.emotion_memo,
            },
          ];
          return Response.json(
            {
              message: 'music record created',
              data: {
                record_id: 1,
                map_dot_id: 5,
                region,
                custom_place_name: request.custom_place_name,
                created_at: detail.created_at,
              },
            },
            { status: 201 },
          );
        }
        if (url.endsWith('/api/v1/music-records') && init?.method === 'DELETE') {
          const request = JSON.parse(String(init.body)) as { record_ids: number[] };
          records = records.filter((record) => !request.record_ids.includes(record.record_id));
          return new Response(null, { status: 204 });
        }
        if (url.endsWith('/api/v1/users/me/music-records')) {
          return Response.json({
            message: 'my music records retrieved',
            data: {
              items: records,
              next_cursor: null,
              has_next: false,
            },
          });
        }
        if (url.endsWith('/api/v1/music-records/1') && init?.method === 'PATCH') {
          const changes = JSON.parse(String(init.body)) as Partial<MusicRecordDetail>;
          detail = { ...detail, ...changes, updated_at: '2026-09-23T06:30:00Z' };
          return Response.json({
            message: 'music record updated',
            data: { record_id: 1, updated_at: detail.updated_at },
          });
        }
        if (url.endsWith('/api/v1/music-records/1')) {
          return Response.json({ message: 'music record retrieved', data: detail });
        }
        if (url.includes('/api/v1/music/search')) {
          return Response.json({
            message: 'music search completed',
            data: {
              items: searchItems,
              next_cursor: null,
              has_next: false,
            },
          });
        }
        return Response.json({ message: 'not found', data: null }, { status: 404 });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    if (originalGeolocation) Object.defineProperty(navigator, 'geolocation', originalGeolocation);
    else Reflect.deleteProperty(navigator, 'geolocation');
  });

  it('생성 요청은 음악 식별자와 위치 토큰만 전송하고 목록을 별도로 조회한다', async () => {
    const created = await createMusicRecord(music, 'location-token', '홍대', '산책 중');
    expect(created.record_id).toBe(1);
    const post = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, init]) => String(url).endsWith('/api/v1/music-records') && init?.method === 'POST',
      );
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      music: { provider: 'ITUNES', external_music_id: '123' },
      location_resolution_token: 'location-token',
      custom_place_name: '홍대',
      emotion_memo: '산책 중',
    });
    const page = await getMusicRecords();
    expect(page.items).toHaveLength(1);
    render(<MusicRecordListPage />);
    expect(await screen.findByRole('heading', { name: '밤편지' })).toBeInTheDocument();
    expect(screen.getByText('2026.09.22. 오후 3:30')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '밤편지 기록 상세 보기' })).toHaveAttribute(
      'href',
      '/music-records/1',
    );
    expect(screen.getByText('산책 중')).toBeInTheDocument();
  });

  it('리스트 휴지통은 삭제 선택 상태로 진입하고 확인 후 선택한 기록만 삭제한다', async () => {
    records = [
      {
        ...detail,
        record_id: 1,
        music: { ...summary, title: '밤편지' },
        emotion_memo: '산책 중',
      },
      {
        ...detail,
        record_id: 2,
        music: { ...summary, title: '가을 아침' },
        emotion_memo: '비 오는 날',
      },
    ];
    render(<MusicRecordListPage />);

    const trash = await screen.findByRole('button', { name: '삭제할 기록 선택' });
    expect(trash).not.toHaveClass('is-selecting');
    fireEvent.click(trash);
    expect(trash).toHaveClass('is-selecting');
    expect(screen.getByRole('status')).toHaveTextContent('삭제할 음악 기록 0곡');
    const recordButton = screen.getByRole('button', { name: '밤편지 기록 선택' });
    const metadataRow = recordButton.querySelector('.record-card-meta-row');
    expect(metadataRow).toContainElement(recordButton.querySelector('time'));
    expect(metadataRow).toContainElement(recordButton.querySelector('.record-select-indicator'));
    fireEvent.click(recordButton);
    expect(screen.getByRole('status')).toHaveTextContent('삭제할 음악 기록 1곡');
    fireEvent.click(screen.getByRole('button', { name: '선택한 기록 삭제 확인' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('선택한 1개의 기록을 삭제할까요?');
    expect(screen.getByRole('dialog')).toHaveTextContent(
      '삭제하면 지도에서 사라지고 되돌릴 수 없습니다.',
    );
    fireEvent.click(screen.getByRole('button', { name: '확인' }));

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: '밤편지 기록 상세 보기' })).toBeNull(),
    );
    expect(screen.getByRole('link', { name: '가을 아침 기록 상세 보기' })).toBeInTheDocument();
    const deletion = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(String(deletion?.[0])).toMatch(/\/api\/v1\/music-records$/);
    expect(JSON.parse(String(deletion?.[1]?.body))).toEqual({ record_ids: [1] });
  });

  it('삭제 확인 취소 시 선택을 유지하고 선택이 없으면 휴지통으로 일반 상태를 닫는다', async () => {
    records = [{ ...detail, record_id: 1 }];
    render(<MusicRecordListPage />);
    fireEvent.click(await screen.findByRole('button', { name: '삭제할 기록 선택' }));
    fireEvent.click(screen.getByRole('button', { name: '밤편지 기록 선택' }));
    fireEvent.click(screen.getByRole('button', { name: '선택한 기록 삭제 확인' }));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));

    expect(screen.getByRole('status')).toHaveTextContent('삭제할 음악 기록 1곡');
    expect(screen.getByRole('button', { name: '밤편지 기록 선택' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: '선택한 기록 삭제 확인' }));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    fireEvent.click(screen.getByRole('button', { name: '밤편지 기록 선택' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제 선택 종료' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '삭제할 기록 선택' })).not.toHaveClass(
      'is-selecting',
    );
    expect(screen.getByRole('link', { name: '밤편지 기록 상세 보기' })).toBeInTheDocument();
  });

  it('2자 이상 입력 후 검색하고 곡 선택·다음 이후에만 입력 화면을 표시한다', async () => {
    render(<MusicRecordCreatePage />);
    const back = screen.getByRole('button', { name: '뒤로가기' });
    expect(back.querySelector('img')).toHaveAttribute('src', '/icons/chatbot/Arrow-reft.svg');
    expect(back.querySelector('img')).toHaveAttribute('alt', '');
    const input = screen.getByRole('textbox', { name: '음악 검색' });
    fireEvent.change(input, { target: { value: '밤' } });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/music/search'))).toBe(
      false,
    );
    fireEvent.change(input, { target: { value: '밤편지' } });
    const result = await screen.findByRole('button', { name: /^밤편지아이유$/ });
    const searchUrl = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).includes('/music/search'))?.[0];
    expect(String(searchUrl)).toContain('query=%EB%B0%A4%ED%8E%B8%EC%A7%80');
    expect(String(searchUrl)).toContain('provider=ITUNES');
    expect(String(searchUrl)).toContain('size=20');
    const next = screen.getByRole('button', { name: '선택하기' });
    expect(next).toBeDisabled();
    fireEvent.click(result);
    expect(next).toBeEnabled();
    expect(screen.queryByRole('region', { name: '음악 기록 입력' })).not.toBeInTheDocument();
    fireEvent.click(next);
    expect(screen.getByRole('region', { name: '음악 기록 입력' })).toBeInTheDocument();
  });

  it('iTunes 검색 앨범 커버 URL을 680x680 이미지로 요청한다', async () => {
    searchItems = [
      {
        ...music,
        album_cover_url: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/cover/100x100bb.jpg',
      },
    ];

    const page = await searchMusic('밤편지');

    expect(page.items[0].album_cover_url).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/cover/680x680bb.jpg',
    );
  });

  it('커서 페이지의 선조회 지점이 누적 10번째에서 30번째로 이동한다', async () => {
    let onIntersect: IntersectionObserverCallback = () => undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          onIntersect = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const makeMusic = (number: number): Music => ({
      ...music,
      external_music_id: String(number),
      title: `곡 ${number}`,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.includes('/music/search')) {
          const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
          const page = cursor === 'next2' ? 2 : cursor === 'next' ? 1 : 0;
          return Promise.resolve(
            Response.json({
              data: {
                items: Array.from({ length: 20 }, (_, index) => makeMusic(page * 20 + index + 1)),
                next_cursor: page === 0 ? 'next' : page === 1 ? 'next2' : null,
                has_next: page < 2,
              },
            }),
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    render(<MusicRecordCreatePage />);
    fireEvent.change(screen.getByRole('textbox', { name: '음악 검색' }), {
      target: { value: '곡 제목' },
    });
    await screen.findByRole('button', { name: /^곡 20아이유$/ });
    const firstSentinel = screen.getByTestId('music-page-sentinel');
    expect(firstSentinel.parentElement).toContainElement(
      screen.getByRole('button', { name: /^곡 10아이유$/ }),
    );
    onIntersect(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    await screen.findByRole('button', { name: /^곡 40아이유$/ });
    expect(screen.getByTestId('music-page-sentinel').parentElement).toContainElement(
      screen.getByRole('button', { name: /^곡 30아이유$/ }),
    );
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/music/search')),
    ).toHaveLength(2);
    onIntersect(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/music/search')),
    ).toHaveLength(2);
    onIntersect(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    onIntersect(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/music/search')),
    ).toHaveLength(2);
    vi.stubGlobal('scrollY', 100);
    fireEvent.scroll(window);
    await screen.findByRole('button', { name: /^곡 60아이유$/ });
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/music/search')),
    ).toHaveLength(3);
  });

  it('커서 400 후 첫 페이지를 한 번만 재조회하고 새 커서로 다음 페이지를 읽는다', async () => {
    let onIntersect: IntersectionObserverCallback = () => undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          onIntersect = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    let firstPageCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const cursor = new URL(String(input), 'http://localhost').searchParams.get('cursor');
        if (cursor === 'broken')
          return Promise.resolve(
            Response.json({ message: 'search query required', data: null }, { status: 400 }),
          );
        if (cursor === 'fresh')
          return Promise.resolve(
            Response.json({
              data: {
                items: [{ ...music, external_music_id: 'new', title: '다음 곡' }],
                next_cursor: null,
                has_next: false,
              },
            }),
          );
        firstPageCount += 1;
        return Promise.resolve(
          Response.json({
            data: {
              items: Array.from({ length: 20 }, (_, index) => ({
                ...music,
                external_music_id: String(index),
                title: `곡 ${index}`,
              })),
              next_cursor: firstPageCount === 1 ? 'broken' : 'fresh',
              has_next: true,
            },
          }),
        );
      }),
    );
    render(<MusicRecordCreatePage />);
    fireEvent.change(screen.getByRole('textbox', { name: '음악 검색' }), {
      target: { value: '음악' },
    });
    await screen.findByRole('button', { name: /^곡 19아이유$/ });
    onIntersect(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    await waitFor(() => expect(firstPageCount).toBe(2));
    vi.stubGlobal('scrollY', 100);
    onIntersect(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(await screen.findByRole('button', { name: /^다음 곡아이유$/ })).toBeInTheDocument();
    expect(firstPageCount).toBe(2);
  });

  it('검색 중 입력을 한 글자로 줄이면 로딩 표시를 지우고 늦은 결과를 버린다', async () => {
    let completeSearch!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      completeSearch = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pending),
    );
    render(<MusicRecordCreatePage />);
    const input = screen.getByRole('textbox', { name: '음악 검색' });
    fireEvent.change(input, { target: { value: '음악' } });
    expect(await screen.findByRole('status')).toHaveTextContent('검색 중');
    fireEvent.change(input, { target: { value: '음' } });
    expect(screen.queryByText('검색 중…')).not.toBeInTheDocument();
    completeSearch(Response.json({ data: { items: [music], next_cursor: null, has_next: false } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('button', { name: /^밤편지아이유$/ })).not.toBeInTheDocument();
  });

  it('생성 폼 뒤로가기 취소는 입력을 보존하고 확인만 메인으로 이동한다', async () => {
    window.history.replaceState(null, '', '/music-records/new');
    render(<MusicRecordCreatePage />);
    fireEvent.change(screen.getByRole('textbox', { name: '음악 검색' }), {
      target: { value: '밤편지' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /^밤편지아이유$/ }));
    fireEvent.click(screen.getByRole('button', { name: '선택하기' }));
    const memo = await screen.findByRole('textbox', { name: '지금 느끼는 것 기록' });
    fireEvent.change(memo, { target: { value: '퇴근길 산책' } });
    expect((screen.getByLabelText('저장 날짜') as HTMLInputElement).value).toMatch(
      /^\d{4}\.\d{2}\.\d{2}\. (오전|오후) \d{1,2}:\d{2}$/,
    );

    const back = screen.getByRole('button', { name: '뒤로가기' });
    fireEvent.click(back);
    const dialog = screen.getByRole('dialog', {
      name: '작성 중인 기록이 사라집니다. 돌아가시겠어요?',
    });
    expect(screen.getByRole('button', { name: '취소' })).toHaveFocus();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'));
    expect(memo).toHaveValue('퇴근길 산책');
    await waitFor(() => expect(back).toHaveFocus());

    fireEvent.click(back);
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(window.location.pathname).toBe('/');
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url, init]) => String(url).endsWith('/api/v1/music-records') && init?.method === 'POST',
        ),
    ).toBe(false);
  });

  it('생성과 상세 메모는 199·200·201자 입력을 200자로 제한하고 카운터를 갱신한다', async () => {
    render(<MusicRecordCreatePage />);
    fireEvent.change(screen.getByRole('textbox', { name: '음악 검색' }), {
      target: { value: '밤편지' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /^밤편지아이유$/ }));
    fireEvent.click(screen.getByRole('button', { name: '선택하기' }));
    const createMemo = await screen.findByRole('textbox', { name: '지금 느끼는 것 기록' });
    for (const length of [199, 200, 201]) {
      fireEvent.change(createMemo, { target: { value: '가'.repeat(length) } });
      const expectedLength = Math.min(length, 200);
      expect(createMemo).toHaveValue('가'.repeat(expectedLength));
      expect(screen.getByText(`${expectedLength}/200`)).toBeInTheDocument();
    }

    cleanup();
    render(<MusicRecordDetailPage recordId={1} />);
    const detailMemo = await screen.findByRole('textbox', { name: '지금 느끼는 것 기록' });
    for (const length of [199, 200, 201]) {
      fireEvent.change(detailMemo, { target: { value: '나'.repeat(length) } });
      const expectedLength = Math.min(length, 200);
      expect(detailMemo).toHaveValue('나'.repeat(expectedLength));
      expect(screen.getByText(`${expectedLength}/200`)).toBeInTheDocument();
    }
  });

  it('위치 취득 실패는 생성 폼을 유지하고 POST 요청을 보내지 않는다', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (resolve: PositionCallback) =>
          resolve({
            coords: {
              latitude: 37.55,
              longitude: 126.92,
              accuracy: 50,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition),
      },
    });
    render(<MusicRecordCreatePage />);
    fireEvent.change(screen.getByRole('textbox', { name: '음악 검색' }), {
      target: { value: '밤편지' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /^밤편지아이유$/ }));
    fireEvent.click(screen.getByRole('button', { name: '선택하기' }));
    const place = await screen.findByRole('textbox', { name: '장소 이름' });
    fireEvent.change(place, { target: { value: '홍대' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '현재 위치에 해당하는 지역을 찾지 못했습니다',
    );
    expect(place).toHaveValue('홍대');
    expect(screen.getByRole('button', { name: '현재 위치 확인' })).toBeInTheDocument();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url, init]) => String(url).endsWith('/api/v1/music-records') && init?.method === 'POST',
        ),
    ).toBe(false);
  });

  it('위치 판정 요청에서 네트워크가 끊기면 저장 불명 상태로 오인하지 않는다', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (resolve: PositionCallback) =>
          resolve({
            coords: {
              latitude: 37.55,
              longitude: 126.92,
              accuracy: 50,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition),
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/auth/token/csrf'))
          return Promise.resolve(Response.json({ data: { csrf_token: 'test-csrf-token' } }));
        if (url.includes('/api/v1/music/search'))
          return Promise.resolve(
            Response.json({ data: { items: [music], next_cursor: null, has_next: false } }),
          );
        if (url.endsWith('/api/v1/locations/resolve'))
          return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve(Response.json({ data: null }, { status: 404 }));
      }),
    );
    render(<MusicRecordCreatePage />);
    fireEvent.change(screen.getByRole('textbox', { name: '음악 검색' }), {
      target: { value: '밤편지' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /^밤편지아이유$/ }));
    fireEvent.click(screen.getByRole('button', { name: '선택하기' }));
    const place = await screen.findByRole('textbox', { name: '장소 이름' });
    fireEvent.change(place, { target: { value: '홍대' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결하지 못했습니다');
    expect(
      screen.queryByRole('button', { name: '음악 기록 목록에서 확인' }),
    ).not.toBeInTheDocument();
    expect(place).toHaveValue('홍대');
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url, init]) => String(url).endsWith('/api/v1/music-records') && init?.method === 'POST',
        ),
    ).toBe(false);
  });

  it('생성 API가 500을 반환해도 오류와 함께 입력을 보존하고 다시 저장할 수 있다', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (resolve: PositionCallback) =>
          resolve({
            coords: {
              latitude: 37.55,
              longitude: 126.92,
              accuracy: 50,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition),
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/auth/token/csrf'))
          return Promise.resolve(Response.json({ data: { csrf_token: 'test-csrf-token' } }));
        if (url.includes('/api/v1/music/search'))
          return Promise.resolve(
            Response.json({ data: { items: [music], next_cursor: null, has_next: false } }),
          );
        if (url.endsWith('/api/v1/locations/resolve'))
          return Promise.resolve(
            Response.json({
              data: {
                map_dot: { map_dot_id: 5, code: 'abc' },
                region,
                location_resolution_token: 'location-token',
                expires_in: 60,
              },
            }),
          );
        if (url.endsWith('/api/v1/music-records'))
          return Promise.resolve(
            Response.json({ message: 'save failed', data: null }, { status: 500 }),
          );
        return Promise.resolve(Response.json({ data: null }, { status: 404 }));
      }),
    );
    render(<MusicRecordCreatePage />);
    fireEvent.change(screen.getByRole('textbox', { name: '음악 검색' }), {
      target: { value: '밤편지' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /^밤편지아이유$/ }));
    fireEvent.click(screen.getByRole('button', { name: '선택하기' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '장소 이름' }), {
      target: { value: '홍대' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '지금 느끼는 것 기록' }), {
      target: { value: '공연을 기다리는 중' },
    });
    fireEvent.click(await screen.findByRole('button', { name: '현재 위치 확인' }));
    await screen.findByDisplayValue('서울특별시 마포구');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '서버에서 기록을 저장하지 못했습니다',
    );
    expect(screen.getByRole('textbox', { name: '장소 이름' })).toHaveValue('홍대');
    expect(screen.getByRole('textbox', { name: '지금 느끼는 것 기록' })).toHaveValue(
      '공연을 기다리는 중',
    );
    expect(screen.getByRole('button', { name: '저장' })).toBeEnabled();
    expect(window.location.pathname).not.toBe('/music-records');
  });

  it('생성 POST 응답을 잃으면 중복 저장을 막고 목록 확인을 안내한다', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (resolve: PositionCallback) =>
          resolve({
            coords: {
              latitude: 37.55,
              longitude: 126.92,
              accuracy: 50,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition),
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/v1/auth/token/csrf'))
          return Promise.resolve(Response.json({ data: { csrf_token: 'test-csrf-token' } }));
        if (url.includes('/api/v1/music/search'))
          return Promise.resolve(
            Response.json({ data: { items: [music], next_cursor: null, has_next: false } }),
          );
        if (url.endsWith('/api/v1/locations/resolve'))
          return Promise.resolve(
            Response.json({
              data: {
                map_dot: { map_dot_id: 5, code: 'abc' },
                region,
                location_resolution_token: 'location-token',
                expires_in: 60,
              },
            }),
          );
        if (url.endsWith('/api/v1/music-records') && init?.method === 'POST')
          return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve(Response.json({ data: null }, { status: 404 }));
      }),
    );
    render(<MusicRecordCreatePage />);
    fireEvent.change(screen.getByRole('textbox', { name: '음악 검색' }), {
      target: { value: '밤편지' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /^밤편지아이유$/ }));
    fireEvent.click(screen.getByRole('button', { name: '선택하기' }));
    const place = await screen.findByRole('textbox', { name: '장소 이름' });
    fireEvent.change(place, { target: { value: '홍대' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('저장 결과를 확인하지 못했습니다');
    expect(screen.getByRole('button', { name: '음악 기록 목록에서 확인' })).toBeInTheDocument();
    expect(place).toHaveValue('홍대');
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url, init]) => String(url).endsWith('/api/v1/music-records') && init?.method === 'POST',
        ),
    ).toHaveLength(1);
  });

  it('저장 전 인증 토큰 갱신 실패는 불명확한 저장 결과로 표시하지 않는다', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (resolve: PositionCallback) =>
          resolve({
            coords: {
              latitude: 37.55,
              longitude: 126.92,
              accuracy: 50,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition),
      },
    });
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/token/csrf'))
        return Promise.resolve(Response.json({ data: { csrf_token: 'test-csrf-token' } }));
      if (url.endsWith('/api/v1/auth/token/refresh') && init?.method === 'POST')
        return Promise.reject(new TypeError('Failed to fetch'));
      if (url.includes('/api/v1/music/search'))
        return Promise.resolve(
          Response.json({ data: { items: [music], next_cursor: null, has_next: false } }),
        );
      if (url.endsWith('/api/v1/locations/resolve'))
        return Promise.resolve(
          Response.json({
            data: {
              map_dot: { map_dot_id: 5, code: 'abc' },
              region,
              location_resolution_token: 'location-token',
              expires_in: 60,
            },
          }),
        );
      return Promise.resolve(Response.json({ data: null }, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MusicRecordCreatePage />);
    fireEvent.change(screen.getByRole('textbox', { name: '음악 검색' }), {
      target: { value: '밤편지' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /^밤편지아이유$/ }));
    fireEvent.click(screen.getByRole('button', { name: '선택하기' }));
    await screen.findByRole('button', { name: '현재 위치 확인' });
    fireEvent.click(screen.getByRole('button', { name: '현재 위치 확인' }));
    await screen.findByDisplayValue('서울특별시 마포구');
    clearAccessToken();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('인증을 확인하지 못했습니다');
    expect(
      screen.queryByRole('button', { name: '음악 기록 목록에서 확인' }),
    ).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).endsWith('/api/v1/music-records') && init?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('생성 요청 중에는 이탈 확인을 열지 않고 저장 완료 흐름을 보호한다', async () => {
    let completeCreate!: (response: Response) => void;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (resolve: PositionCallback) =>
          resolve({
            coords: {
              latitude: 37.55,
              longitude: 126.92,
              accuracy: 50,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition),
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/v1/auth/token/csrf'))
          return Promise.resolve(Response.json({ data: { csrf_token: 'test-csrf-token' } }));
        if (url.includes('/api/v1/music/search'))
          return Promise.resolve(
            Response.json({ data: { items: [music], next_cursor: null, has_next: false } }),
          );
        if (url.endsWith('/api/v1/locations/resolve'))
          return Promise.resolve(
            Response.json({
              data: {
                map_dot: { map_dot_id: 5, code: 'abc' },
                region,
                location_resolution_token: 'location-token',
                expires_in: 60,
              },
            }),
          );
        if (url.endsWith('/api/v1/music-records') && init?.method === 'POST')
          return new Promise<Response>((resolve) => {
            completeCreate = resolve;
          });
        return Promise.resolve(Response.json({ data: null }, { status: 404 }));
      }),
    );
    window.history.replaceState(null, '', '/music-records/new');
    render(<MusicRecordCreatePage />);
    fireEvent.change(screen.getByRole('textbox', { name: '음악 검색' }), {
      target: { value: '밤편지' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /^밤편지아이유$/ }));
    fireEvent.click(screen.getByRole('button', { name: '선택하기' }));
    fireEvent.click(await screen.findByRole('button', { name: '현재 위치 확인' }));
    await screen.findByDisplayValue('서울특별시 마포구');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '뒤로가기' })).toBeDisabled());
    expect(document.querySelector('dialog')).not.toHaveAttribute('open');

    completeCreate(
      Response.json(
        {
          data: {
            record_id: 1,
            map_dot_id: 5,
            region,
            custom_place_name: null,
            created_at: '2026-09-22T06:30:00Z',
          },
        },
        { status: 201 },
      ),
    );
    await waitFor(() => expect(window.location.pathname).toBe('/music-records'));
  });

  it('변경된 상세 뒤로가기는 취소와 확인을 구분한다', async () => {
    window.history.replaceState(null, '', '/music-records/1');
    render(<MusicRecordDetailPage recordId={1} />);
    const memo = await screen.findByRole('textbox', { name: '지금 느끼는 것 기록' });
    fireEvent.change(memo, { target: { value: '새로운 기록' } });
    const back = screen.getByRole('button', { name: '음악 기록 목록으로 돌아가기' });
    fireEvent.click(back);
    const dialog = screen.getByRole('dialog', {
      name: '작성 중인 기록이 사라집니다. 돌아가시겠어요?',
    });
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(memo).toHaveValue('새로운 기록');
    await waitFor(() => expect(back).toHaveFocus());
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);

    fireEvent.click(back);
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(window.location.pathname).toBe('/music-records');
    expect(dialog).not.toHaveAttribute('open');
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('변경 없는 상세 뒤로가기는 경고 없이 목록으로 이동한다', async () => {
    window.history.replaceState(null, '', '/music-records/1');
    render(<MusicRecordDetailPage recordId={1} />);
    await screen.findByRole('textbox', { name: '지금 느끼는 것 기록' });
    fireEvent.click(screen.getByRole('button', { name: '음악 기록 목록으로 돌아가기' }));
    expect(window.location.pathname).toBe('/music-records');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('상세 화면에서 변경 전에는 저장할 수 없고 메모만 PATCH한다', async () => {
    window.history.replaceState(null, '', '/music-records/1');
    render(<MusicRecordDetailPage recordId={1} />);
    const back = screen.getByRole('button', { name: '음악 기록 목록으로 돌아가기' });
    expect(back.querySelector('img')).toHaveAttribute('src', '/icons/chatbot/Arrow-reft.svg');
    expect(back.querySelector('img')).toHaveAttribute('alt', '');
    const save = await screen.findByRole('button', { name: '저장' });
    expect(save).toBeDisabled();
    expect(screen.getByRole('button', { name: '음악 변경' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '변경' })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('서울특별시 마포구')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByRole('textbox', { name: '지금 느끼는 것 기록' }), {
      target: { value: '새로운 기분' },
    });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(detail.emotion_memo).toBe('새로운 기분'));
    const patch = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, init]) => String(url).endsWith('/music-records/1') && init?.method === 'PATCH',
      );
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ emotion_memo: '새로운 기분' });
    await waitFor(() => expect(window.location.pathname).toBe('/music-records'));
  });

  it('상세 조회가 실패하면 오류를 알리고 편집 폼을 표시하지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/music-records/1'))
          return Promise.resolve(
            Response.json({ message: 'record unavailable', data: null }, { status: 500 }),
          );
        if (url.endsWith('/api/v1/auth/token/csrf'))
          return Promise.resolve(Response.json({ data: { csrf_token: 'test-csrf-token' } }));
        return Promise.resolve(Response.json({ data: null }, { status: 404 }));
      }),
    );
    render(<MusicRecordDetailPage recordId={1} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('record unavailable');
    expect(screen.queryByRole('textbox', { name: '장소 이름' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '지금 느끼는 것 기록' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '저장' })).not.toBeInTheDocument();
  });

  it('상세 created_at이 누락되면 날짜를 대시로 표시한다', async () => {
    const detailWithoutDate = { ...detail, created_at: undefined as unknown as string };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/music-records/1'))
          return Promise.resolve(Response.json({ data: detailWithoutDate }));
        if (url.endsWith('/api/v1/auth/token/csrf'))
          return Promise.resolve(Response.json({ data: { csrf_token: 'test-csrf-token' } }));
        return Promise.resolve(Response.json({ data: null }, { status: 404 }));
      }),
    );
    render(<MusicRecordDetailPage recordId={1} />);

    expect(await screen.findByDisplayValue('—')).toBeInTheDocument();
  });

  it('상세 PATCH가 실패하면 오류를 표시하고 입력을 보존해 다시 저장할 수 있다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/v1/music-records/1') && init?.method === 'PATCH')
          return Promise.resolve(
            Response.json({ message: 'save failed', data: null }, { status: 500 }),
          );
        if (url.endsWith('/api/v1/music-records/1'))
          return Promise.resolve(Response.json({ message: 'record retrieved', data: detail }));
        if (url.endsWith('/api/v1/auth/token/csrf'))
          return Promise.resolve(Response.json({ data: { csrf_token: 'test-csrf-token' } }));
        return Promise.resolve(Response.json({ data: null }, { status: 404 }));
      }),
    );
    render(<MusicRecordDetailPage recordId={1} />);
    const memo = await screen.findByRole('textbox', { name: '지금 느끼는 것 기록' });
    fireEvent.change(memo, { target: { value: '기록을 보존합니다' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '저장하지 못했어요. 다시 시도해 주세요.',
    );
    expect(memo).toHaveValue('기록을 보존합니다');
    expect(screen.getByRole('button', { name: '저장' })).toBeEnabled();
    expect(window.location.pathname).not.toBe('/music-records');
  });
});
