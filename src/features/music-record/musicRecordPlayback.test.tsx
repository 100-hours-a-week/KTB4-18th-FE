import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMusicRecord,
  registerSelectedMusic,
  searchMusic,
  type Music,
  type MusicRecordDetail,
} from './api/musicRecordsApi';
import { MusicRecordCreatePage } from './components/MusicRecordPages';
import { MusicRecordDetailPage } from './components/MusicRecordDetailPage';

vi.mock('./api/musicRecordsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api/musicRecordsApi')>()),
  getMusicRecord: vi.fn(),
  searchMusic: vi.fn(),
  registerSelectedMusic: vi.fn(),
}));

const previewUrl = 'https://example.com/preview.m4a';
const music: Music = {
  music_id: 12,
  provider: 'ITUNES',
  external_music_id: '123',
  title: '밤편지',
  artist_name: '아이유',
  album_cover_url: null,
  preview_url: previewUrl,
  youtube_video_id: null,
  is_queueable: false,
};
const detail: MusicRecordDetail = {
  record_id: 1,
  music,
  preview_url: previewUrl,
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

class PreviewAudio {
  static instances: PreviewAudio[] = [];
  play = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  pause = vi.fn();
  removeAttribute = vi.fn();
  load = vi.fn();
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    PreviewAudio.instances.push(this);
  }
}

describe('음악 기록 화면의 카드 미리 듣기 연결', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    PreviewAudio.instances = [];
    vi.stubGlobal('Audio', PreviewAudio);
    vi.mocked(getMusicRecord).mockResolvedValue(detail);
    vi.mocked(searchMusic).mockResolvedValue({
      items: [music],
      next_cursor: null,
      has_next: false,
    });
    vi.mocked(registerSelectedMusic).mockResolvedValue({ ...music, music_id: 12 });
    sessionStorage.clear();
    window.history.replaceState(null, '', '/music-records/1');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('생성 화면에서 선택한 곡의 URL로 재생하고 카드 버튼 안에 열 막대를 표시한다', async () => {
    render(<MusicRecordCreatePage />);
    fireEvent.change(screen.getByRole('textbox', { name: '음악 검색' }), {
      target: { value: '아이유' },
    });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    fireEvent.click(screen.getByRole('button', { name: '밤편지아이유' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '선택하기' })));
    expect(screen.getByRole('region', { name: '음악 기록 입력' })).toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: '미리 듣기 재생' })));

    const pause = screen.getByRole('button', { name: '미리 듣기 일시정지' });
    expect(pause.querySelectorAll('.music-hero-waveform > span')).toHaveLength(10);
    expect(PreviewAudio.instances[0].url).toBe(previewUrl);
    expect(PreviewAudio.instances[0].play).toHaveBeenCalledOnce();
    fireEvent.click(pause);
    expect(screen.getByRole('button', { name: '미리 듣기 재생' })).toBeEnabled();
    expect(document.querySelector('.music-hero-waveform')).toBeNull();
  });

  it('상세 응답의 preview_url로 재생하고 열 막대를 표시한다', async () => {
    await act(async () => render(<MusicRecordDetailPage recordId={1} />));
    expect(screen.getByRole('button', { name: '미리 듣기 재생' })).toBeEnabled();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: '미리 듣기 재생' })));

    expect(PreviewAudio.instances[0].url).toBe(previewUrl);
    const pause = screen.getByRole('button', { name: '미리 듣기 일시정지' });
    expect(pause.querySelectorAll('.music-hero-waveform > span')).toHaveLength(10);
  });

  it.each([undefined, null])('상세 미리 듣기 URL이 %s 이면 버튼을 비활성화한다', async (url) => {
    vi.mocked(getMusicRecord).mockResolvedValue({ ...detail, preview_url: url });
    await act(async () => render(<MusicRecordDetailPage recordId={1} />));

    const play = screen.getByRole('button', { name: '미리 듣기 불가' });
    expect(play).toBeDisabled();
    fireEvent.click(play);
    expect(PreviewAudio.instances).toHaveLength(0);
    expect(document.querySelector('.music-hero-waveform')).toBeNull();
  });

  it.each([null, 'https://example.com/replacement.m4a'])(
    '교체 곡 URL %s 를 그대로 사용하고 이전 상세 URL과 음원을 재사용하지 않는다',
    async (url) => {
      const view = render(<MusicRecordDetailPage recordId={1} />);
      await act(async () => {});
      await act(async () =>
        fireEvent.click(screen.getByRole('button', { name: '미리 듣기 재생' })),
      );
      const [originalAudio] = PreviewAudio.instances;
      fireEvent.click(screen.getByRole('button', { name: '음악 변경' }));
      expect(originalAudio.pause).toHaveBeenCalledOnce();
      expect(originalAudio.removeAttribute).toHaveBeenCalledWith('src');
      const key = 'music-record-replacement-draft:1';
      const draft = JSON.parse(sessionStorage.getItem(key)!);
      sessionStorage.setItem(
        key,
        JSON.stringify({
          ...draft,
          music: {
            ...music,
            music_id: 13,
            external_music_id: '456',
            title: '교체 곡',
            preview_url: url,
          },
        }),
      );
      view.unmount();

      await act(async () => render(<MusicRecordDetailPage recordId={1} />));

      expect(screen.getByText('교체 곡')).toBeInTheDocument();
      expect(document.querySelector('.music-hero-waveform')).toBeNull();
      if (url === null) {
        expect(screen.getByRole('button', { name: '미리 듣기 불가' })).toBeDisabled();
        expect(PreviewAudio.instances).toHaveLength(1);
      } else {
        await act(async () =>
          fireEvent.click(screen.getByRole('button', { name: '미리 듣기 재생' })),
        );
        expect(PreviewAudio.instances[1].url).toBe(url);
        expect(PreviewAudio.instances[1].url).not.toBe(previewUrl);
        expect(document.querySelectorAll('.music-hero-waveform > span')).toHaveLength(10);
      }
    },
  );
});
