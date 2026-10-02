import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAccessToken } from '../auth-login/api/authSession';
import { MusicRecordCreatePage } from './components/MusicRecordPages';

const artist =
  'Jordi Savall, Monica Huggett, Chiara Bianchini, Ton Koopman, Hopkinson Smith, Stephen Preston, Michel Henry, Claude Wassmer & Ku Ebbinge';
const title = 'Les Nations, Premier ordre "La Françoise": V. Sarabande';
const region = {
  sido: { region_id: 1, code: '11', name: '서울특별시' },
  sigungu: { region_id: 2, code: '11440', name: '마포구' },
};
let saveResponse: () => Promise<Response>;
let posts: RequestInit[];

describe('긴 아티스트명의 저장 및 오류 복구', () => {
  beforeEach(() => {
    posts = [];
    setAccessToken('test-access-token');
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (success: PositionCallback) =>
          success({
            coords: { latitude: 37.5, longitude: 127, accuracy: 10 },
          } as GeolocationPosition),
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/auth/token/csrf'))
          return Response.json({ data: { csrf_token: 'test-csrf-token' } });
        if (url.includes('/music/search'))
          return Response.json({
            data: {
              items: [
                {
                  music_id: null,
                  provider: 'ITUNES',
                  external_music_id: '123',
                  title,
                  artist_name: artist,
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
        if (url.endsWith('/locations/resolve'))
          return Response.json({
            data: {
              map_dot: { map_dot_id: 5, code: 'dot' },
              region,
              location_resolution_token: 'location-token',
              expires_in: 300,
            },
          });
        if (url.endsWith('/music-records') && init?.method === 'POST') {
          posts.push(init);
          return saveResponse();
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  async function openForm() {
    render(<MusicRecordCreatePage />);
    fireEvent.change(screen.getByRole('textbox', { name: '음악 검색' }), {
      target: { value: 'Les Nations' },
    });
    fireEvent.click(await screen.findByRole('button', { name: title + artist }));
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(screen.getByText(artist)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '장소 이름' }), {
      target: { value: '산책길' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '지금 느끼는 것 기록' }), {
      target: { value: '평온한 오후' },
    });
  }

  it('500 후 원문과 입력을 유지하고 버튼을 복구하며 중복 요청 없이 재시도한다', async () => {
    let finish: (response: Response) => void = () => undefined;
    saveResponse = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await openForm();
    const save = screen.getByRole('button', { name: '음악 기록 저장' });
    fireEvent.click(save);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled();
    fireEvent.click(save);
    expect(posts).toHaveLength(1);
    finish(Response.json({ message: 'internal server error', data: null }, { status: 500 }));
    expect(await screen.findByRole('alert')).toHaveTextContent('잠시 후 다시 시도해 주세요.');
    expect(save).toBeEnabled();
    expect(screen.getByText(artist)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '장소 이름' })).toHaveValue('산책길');
    expect(screen.getByRole('textbox', { name: '지금 느끼는 것 기록' })).toHaveValue('평온한 오후');

    saveResponse = async () => Response.json({ data: { record_id: 1 } }, { status: 201 });
    fireEvent.click(save);
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(JSON.parse(String(posts[1].body))).toEqual({
      music: { provider: 'ITUNES', external_music_id: '123' },
      location_resolution_token: 'location-token',
      custom_place_name: '산책길',
      emotion_memo: '평온한 오후',
    });
    await waitFor(() => expect(window.location.pathname).toBe('/music-records'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('비정상 메타데이터는 다른 곡 선택을 안내하고 작성 내용을 유지한다', async () => {
    saveResponse = async () =>
      Response.json({ message: 'music metadata invalid', data: null }, { status: 502 });
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: '음악 기록 저장' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('다른 곡을 선택해 주세요.');
    expect(screen.getByRole('button', { name: '음악 기록 저장' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: '장소 이름' })).toHaveValue('산책길');
    expect(screen.getByRole('textbox', { name: '지금 느끼는 것 기록' })).toHaveValue('평온한 오후');
    fireEvent.click(screen.getByRole('button', { name: '뒤로가기' }));
    expect(screen.getByRole('region', { name: '음악 검색 결과' })).toBeInTheDocument();
    expect(posts).toHaveLength(1);
  });
});
