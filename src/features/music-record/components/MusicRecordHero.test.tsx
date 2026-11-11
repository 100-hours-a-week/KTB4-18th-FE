import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MusicRecordHero } from './MusicRecordHero';

const music = { music_id: 12, title: 'With', artist_name: 'RESCENE', album_cover_url: null };
const previewUrl = 'https://example.com/preview.m4a';

class PreviewAudio {
  static instances: PreviewAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
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

describe('음악 기록 카드 미리 듣기', () => {
  beforeEach(() => {
    PreviewAudio.instances = [];
    vi.stubGlobal('Audio', PreviewAudio);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('음악 변경 위에서 미리 듣기를 시작하고 일시정지한다', async () => {
    const user = userEvent.setup();
    render(<MusicRecordHero music={music} previewUrl={previewUrl} />);
    const play = screen.getByRole('button', { name: '미리 듣기 재생' });
    const change = screen.getByRole('button', { name: '음악 변경' });

    expect(play.nextElementSibling).toBe(change);
    await user.click(play);
    const pause = await screen.findByRole('button', { name: '미리 듣기 일시정지' });
    const [audio] = PreviewAudio.instances;
    expect(audio.url).toBe(previewUrl);
    expect(audio.play).toHaveBeenCalledOnce();
    const waveform = pause.querySelector('.music-hero-waveform');
    expect(waveform).toHaveAttribute('aria-hidden', 'true');
    expect(waveform?.children).toHaveLength(10);
    expect(document.querySelectorAll('.music-hero-waveform')).toHaveLength(1);
    expect(pause.querySelector('svg')).toBeNull();

    await user.click(pause);
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '미리 듣기 재생' })).toBeEnabled();
    expect(play.querySelector('path')).toHaveAttribute('d', 'm7 4 9 6-9 6z');
    expect(document.querySelector('.music-hero-waveform')).toBeNull();
  });

  it('음악 변경 콜백을 실행하기 전에 재생 중인 음원을 해제한다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn(() => {
      expect(PreviewAudio.instances[0].removeAttribute).toHaveBeenCalledWith('src');
    });
    render(<MusicRecordHero music={music} previewUrl={previewUrl} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: '미리 듣기 재생' }));

    await user.click(screen.getByRole('button', { name: '음악 변경' }));

    expect(onChange).toHaveBeenCalledOnce();
    expect(document.querySelector('.music-hero-waveform')).toBeNull();
    expect(screen.getByRole('button', { name: '미리 듣기 재생' })).toBeEnabled();
  });

  it('교체 곡의 미리 듣기가 없으면 기존 재생을 해제하고 버튼을 비활성화한다', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MusicRecordHero music={music} previewUrl={previewUrl} />);
    await user.click(screen.getByRole('button', { name: '미리 듣기 재생' }));

    rerender(<MusicRecordHero music={{ ...music, music_id: 13 }} previewUrl={null} />);

    expect(PreviewAudio.instances[0].pause).toHaveBeenCalledOnce();
    expect(PreviewAudio.instances[0].removeAttribute).toHaveBeenCalledWith('src');
    expect(screen.getByRole('button', { name: '미리 듣기 불가' })).toBeDisabled();
    expect(document.querySelector('.music-hero-waveform')).toBeNull();
  });

  it('로딩 중에는 기존 일시정지 아이콘을 유지하고 성공한 뒤 버튼 안에 파형을 표시한다', async () => {
    const user = userEvent.setup();
    render(<MusicRecordHero music={music} previewUrl={previewUrl} />);
    await user.click(screen.getByRole('button', { name: '미리 듣기 재생' }));
    const audio = PreviewAudio.instances[0];
    await user.click(screen.getByRole('button', { name: '미리 듣기 일시정지' }));
    let finishPlay!: () => void;
    audio.play.mockImplementationOnce(() => new Promise((resolve) => (finishPlay = resolve)));

    await user.click(screen.getByRole('button', { name: '미리 듣기 재생' }));

    const pause = screen.getByRole('button', { name: '미리 듣기 일시정지' });
    expect(pause.querySelector('path')).toHaveAttribute('d', 'M6 4h3v12H6zm5 0h3v12h-3z');
    expect(document.querySelector('.music-hero-waveform')).toBeNull();
    await act(async () => finishPlay());
    expect(pause.querySelector('.music-hero-waveform')?.children).toHaveLength(10);
  });

  it.each(['onended', 'onerror'] as const)(
    '%s 뒤에는 파형을 제거하고 재생 아이콘을 복원한다',
    async (event) => {
      const user = userEvent.setup();
      render(<MusicRecordHero music={music} previewUrl={previewUrl} />);
      await user.click(screen.getByRole('button', { name: '미리 듣기 재생' }));
      const audio = PreviewAudio.instances[0];

      act(() => audio[event]?.());

      const play = screen.getByRole('button', { name: '미리 듣기 재생' });
      expect(play.querySelector('path')).toHaveAttribute('d', 'm7 4 9 6-9 6z');
      expect(document.querySelector('.music-hero-waveform')).toBeNull();
      expect(audio.removeAttribute).toHaveBeenCalledWith('src');
      if (event === 'onerror') expect(screen.getByRole('alert')).toHaveTextContent('다시 시도');
    },
  );

  it('재생 시작이 거절되면 파형 없이 오류를 안내하고 재생 버튼을 복원한다', async () => {
    const user = userEvent.setup();
    render(<MusicRecordHero music={music} previewUrl={previewUrl} />);
    await user.click(screen.getByRole('button', { name: '미리 듣기 재생' }));
    const audio = PreviewAudio.instances[0];
    await user.click(screen.getByRole('button', { name: '미리 듣기 일시정지' }));
    audio.play.mockRejectedValueOnce(new Error('blocked'));

    await user.click(screen.getByRole('button', { name: '미리 듣기 재생' }));

    expect(screen.getByRole('alert')).toHaveTextContent('다시 시도');
    expect(
      screen.getByRole('button', { name: '미리 듣기 재생' }).querySelector('path'),
    ).toHaveAttribute('d', 'm7 4 9 6-9 6z');
    expect(document.querySelector('.music-hero-waveform')).toBeNull();
    expect(audio.removeAttribute).toHaveBeenCalledWith('src');
  });

  it.each([
    { recordId: 2 },
    { previewTrackId: 'replacement' },
    { previewUrl: 'https://example.com/replacement.m4a' },
  ])(
    '재생 식별자가 $recordId $previewTrackId $previewUrl 로 바뀌면 이전 파형과 음원을 정리한다',
    async (replacement) => {
      const user = userEvent.setup();
      const { rerender } = render(
        <MusicRecordHero recordId={1} music={music} previewUrl={previewUrl} />,
      );
      await user.click(screen.getByRole('button', { name: '미리 듣기 재생' }));
      const audio = PreviewAudio.instances[0];

      rerender(
        <MusicRecordHero recordId={1} music={music} previewUrl={previewUrl} {...replacement} />,
      );

      expect(document.querySelector('.music-hero-waveform')).toBeNull();
      expect(screen.getByRole('button', { name: '미리 듣기 재생' })).toBeEnabled();
      expect(audio.pause).toHaveBeenCalledOnce();
      expect(audio.removeAttribute).toHaveBeenCalledWith('src');
      expect(audio.load).toHaveBeenCalledOnce();
      expect(audio.onended).toBeNull();
      expect(audio.onerror).toBeNull();
      expect(audio.ontimeupdate).toBeNull();
    },
  );

  it('로딩 중 곡이 바뀐 뒤 늦게 성공해도 이전 파형을 표시하지 않는다', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MusicRecordHero music={music} previewUrl={previewUrl} />);
    await user.click(screen.getByRole('button', { name: '미리 듣기 재생' }));
    const audio = PreviewAudio.instances[0];
    await user.click(screen.getByRole('button', { name: '미리 듣기 일시정지' }));
    let finishPlay!: () => void;
    audio.play.mockImplementationOnce(() => new Promise((resolve) => (finishPlay = resolve)));
    await user.click(screen.getByRole('button', { name: '미리 듣기 재생' }));

    rerender(<MusicRecordHero music={{ ...music, music_id: 13 }} previewUrl={previewUrl} />);
    await act(async () => finishPlay());

    expect(document.querySelector('.music-hero-waveform')).toBeNull();
    expect(screen.getByRole('button', { name: '미리 듣기 재생' })).toBeEnabled();
    expect(audio.removeAttribute).toHaveBeenCalledWith('src');
  });

  it('화면을 벗어나면 파형과 음원 이벤트를 정리한다', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<MusicRecordHero music={music} previewUrl={previewUrl} />);
    await user.click(screen.getByRole('button', { name: '미리 듣기 재생' }));
    const audio = PreviewAudio.instances[0];
    expect(document.querySelector('.music-hero-waveform')).toBeInTheDocument();

    unmount();

    expect(document.querySelector('.music-hero-waveform')).toBeNull();
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.removeAttribute).toHaveBeenCalledWith('src');
    expect(audio.load).toHaveBeenCalledOnce();
    expect(audio.onended).toBeNull();
    expect(audio.onerror).toBeNull();
    expect(audio.ontimeupdate).toBeNull();
  });
});
