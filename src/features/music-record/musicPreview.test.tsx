import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { searchMusic, type Music } from './api/musicRecordsApi';
import { MusicRecordCreatePage } from './components/MusicRecordPages';
import { useMusicPreview } from './hooks/useMusicPreview';

vi.mock('./api/musicRecordsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api/musicRecordsApi')>()),
  searchMusic: vi.fn(),
}));

class PreviewAudio {
  static instances: PreviewAudio[] = [];
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  play = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  pause = vi.fn();
  removeAttribute = vi.fn();
  load = vi.fn();
  constructor() {
    PreviewAudio.instances.push(this);
  }
}

const music: Music = {
  music_id: null,
  provider: 'ITUNES',
  external_music_id: '123',
  title: '밤편지',
  artist_name: '아이유',
  album_cover_url: null,
  preview_url: 'https://example.com/preview.m4a',
  youtube_video_id: null,
  is_queueable: false,
};

async function search() {
  fireEvent.change(screen.getByLabelText('음악 검색'), { target: { value: '아이유' } });
  await act(async () => vi.advanceTimersByTimeAsync(300));
}

describe('음악 검색 미리 듣기', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    PreviewAudio.instances = [];
    vi.stubGlobal('Audio', PreviewAudio);
    vi.mocked(searchMusic).mockResolvedValue({
      items: [music, { ...music, external_music_id: '456', title: '팔레트', preview_url: null }],
      next_cursor: null,
      has_next: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('미리 듣기와 음악 선택을 분리하고 음원이 없는 곡도 선택할 수 있다', async () => {
    render(<MusicRecordCreatePage />);
    await search();
    const next = screen.getByRole('button', { name: '선택하기' });
    const searchInput = screen.getByRole('textbox', { name: '음악 검색' });
    expect(searchInput).toHaveAttribute('autocomplete', 'off');
    const selectButton = screen.getByRole('button', { name: '밤편지아이유' });
    const previewButton = screen.getByRole('button', { name: '밤편지 아이유 미리 듣기 재생' });
    const resultCard = selectButton.closest('.music-result');
    expect(resultCard).toContainElement(selectButton);
    expect(resultCard).toContainElement(previewButton);
    expect(resultCard).toHaveClass('music-result');
    expect(previewButton.querySelector('img')).toHaveAttribute(
      'src',
      '/icons/chatbot/Playbutton.svg',
    );
    await act(async () => fireEvent.click(previewButton));
    expect(
      screen.getByRole('button', { name: '밤편지 아이유 미리 듣기 일시정지' }).querySelector('img'),
    ).toHaveAttribute('src', '/icons/chatbot/Play-stop.svg');
    expect(next).toBeDisabled();
    expect(screen.getByRole('button', { name: '팔레트 아이유 미리 듣기 불가' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '팔레트아이유' }));
    expect(next).toBeEnabled();
    expect(PreviewAudio.instances).toHaveLength(1);
  });

  it('일시정지 후 같은 음원을 같은 위치에서 이어 듣는다', async () => {
    render(<MusicRecordCreatePage />);
    await search();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: '밤편지 아이유 미리 듣기 재생' })),
    );
    const audio = PreviewAudio.instances[0];
    audio.currentTime = 8;
    fireEvent.click(screen.getByRole('button', { name: '밤편지 아이유 미리 듣기 일시정지' }));
    expect(audio.pause).toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: '밤편지 아이유 미리 듣기 재생' })),
    );
    expect(audio.currentTime).toBe(8);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(PreviewAudio.instances).toHaveLength(1);
  });

  it('검색어 변경과 기록 입력 단계 전환 시 음원을 정리한다', async () => {
    render(<MusicRecordCreatePage />);
    await search();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: '밤편지 아이유 미리 듣기 재생' })),
    );
    const first = PreviewAudio.instances[0];
    fireEvent.change(screen.getByLabelText('음악 검색'), { target: { value: '밤편지' } });
    expect(first.pause).toHaveBeenCalled();
    expect(first.removeAttribute).toHaveBeenCalledWith('src');
    await act(async () => vi.advanceTimersByTimeAsync(300));
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: '밤편지 아이유 미리 듣기 재생' })),
    );
    fireEvent.click(screen.getByRole('button', { name: '밤편지아이유' }));
    fireEvent.click(screen.getByRole('button', { name: '선택하기' }));
    expect(PreviewAudio.instances[1].pause).toHaveBeenCalled();
    expect(screen.getByRole('region', { name: '음악 기록 입력' })).toBeInTheDocument();
  });

  it('재생 실패를 안내하고 다시 재생할 수 있다', async () => {
    render(<MusicRecordCreatePage />);
    await search();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: '밤편지 아이유 미리 듣기 재생' })),
    );
    act(() => PreviewAudio.instances[0].onerror?.());
    expect(screen.getByRole('alert')).toHaveTextContent('다시 시도해 주세요');
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: '밤편지 아이유 미리 듣기 재생' })),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(PreviewAudio.instances).toHaveLength(2);
  });

  it('곡 전환 이후 이전 재생 실패가 새 곡의 상태를 변경하지 않는다', async () => {
    const { result } = renderHook(useMusicPreview);
    await act(async () => result.current.toggle('first', music.preview_url!));
    const first = PreviewAudio.instances[0];
    let rejectPlay!: (error: Error) => void;
    first.play.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectPlay = reject;
        }),
    );
    act(() => {
      void result.current.toggle('first', music.preview_url!);
    });
    act(() => {
      void result.current.toggle('first', music.preview_url!);
    });
    await act(async () => result.current.toggle('second', 'https://example.com/second.m4a'));
    await act(async () => rejectPlay(new Error('old failure')));
    expect(first.pause).toHaveBeenCalled();
    expect(result.current.activeTrack).toBe('second');
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.error).toBe('');
  });

  it('재생 시작 거절을 안내하고 로딩 중 취소한 요청의 완료를 무시한다', async () => {
    const { result } = renderHook(useMusicPreview);
    await act(async () => result.current.toggle('first', music.preview_url!));
    act(() => {
      void result.current.toggle('first', music.preview_url!);
    });
    PreviewAudio.instances[0].play.mockRejectedValueOnce(new Error('blocked'));
    await act(async () => result.current.toggle('first', music.preview_url!));
    expect(result.current.error).toContain('다시 시도');
    expect(result.current.activeTrack).toBeNull();

    await act(async () => result.current.toggle('second', music.preview_url!));
    act(() => {
      void result.current.toggle('second', music.preview_url!);
    });
    let finishPlay!: () => void;
    PreviewAudio.instances[1].play.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPlay = resolve;
        }),
    );
    act(() => {
      void result.current.toggle('second', music.preview_url!);
    });
    expect(result.current.isLoading).toBe(true);
    act(() => {
      void result.current.toggle('second', music.preview_url!);
    });
    await act(async () => finishPlay());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isPlaying).toBe(false);
  });

  it('재생 종료와 30초 도달 시 상태를 초기화하고 이탈 시 음원을 해제한다', async () => {
    const { result, unmount } = renderHook(useMusicPreview);
    await act(async () => result.current.toggle('first', music.preview_url!));
    act(() => PreviewAudio.instances[0].onended?.());
    expect(result.current.activeTrack).toBeNull();
    await act(async () => result.current.toggle('second', music.preview_url!));
    const second = PreviewAudio.instances[1];
    second.currentTime = 30;
    act(() => second.ontimeupdate?.());
    expect(result.current.isPlaying).toBe(false);
    await act(async () => result.current.toggle('third', music.preview_url!));
    const third = PreviewAudio.instances[2];
    unmount();
    expect(third.pause).toHaveBeenCalled();
    expect(third.onended).toBeNull();
    expect(third.removeAttribute).toHaveBeenCalledWith('src');
  });
});
