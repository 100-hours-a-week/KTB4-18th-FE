import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeechTranscriptionError, transcribeAudio } from '../api/speechTranscriptions';
import { useVoiceInput } from './useVoiceInput';

vi.mock('../api/speechTranscriptions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/speechTranscriptions')>()),
  transcribeAudio: vi.fn(),
}));

class FakeMediaRecorder {
  static latest: FakeMediaRecorder;
  static deferStop = false;

  static isTypeSupported() {
    return true;
  }

  readonly mimeType: string;
  state: RecordingState = 'inactive';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.latest = this;
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    if (!FakeMediaRecorder.deferStop) this.finishStop();
  }

  finishStop() {
    this.ondataavailable?.({
      data: new Blob(['final-recording'], { type: this.mimeType }),
    } as BlobEvent);
    this.onstop?.();
  }
}

describe('useVoiceInput', () => {
  const stopTrack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    FakeMediaRecorder.deferStop = false;
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('60초 자동 종료 후 마지막 데이터까지 포함하여 한 번만 전사한다', async () => {
    vi.useFakeTimers();
    FakeMediaRecorder.deferStop = true;
    let complete!: (value: string) => void;
    vi.mocked(transcribeAudio).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));
    await act(async () => result.current.startRecording());
    const recorder = FakeMediaRecorder.latest;
    recorder.ondataavailable?.({ data: new Blob(['first-']) } as BlobEvent);
    await act(async () => vi.advanceTimersByTimeAsync(59_999));
    expect(transcribeAudio).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(result.current.isAutomaticallyStopped).toBe(true);
    expect(transcribeAudio).not.toHaveBeenCalled();
    act(() => result.current.stopRecording());
    await act(async () => recorder.finishStop());
    expect(result.current.status).toBe('transcribing');
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    const file = vi.mocked(transcribeAudio).mock.calls[0][0];
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(file);
    });
    expect(text).toBe('first-final-recording');
    await act(async () => complete('변환된 문장'));
    expect(onTranscript).toHaveBeenCalledWith('변환된 문장');
    expect(result.current.status).toBe('reviewing');
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it('수동 종료와 자동 종료가 겹쳐도 전사는 한 번만 요청한다', async () => {
    vi.useFakeTimers();
    FakeMediaRecorder.deferStop = true;
    vi.mocked(transcribeAudio).mockResolvedValueOnce('전사 결과');
    const { result } = renderHook(() => useVoiceInput({ onTranscript: vi.fn() }));
    await act(async () => result.current.startRecording());
    await act(async () => vi.advanceTimersByTimeAsync(59_999));
    act(() => result.current.stopRecording());
    await act(async () => vi.advanceTimersByTimeAsync(1));
    act(() => result.current.stopRecording());
    await act(async () => FakeMediaRecorder.latest.finishStop());
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(result.current.isAutomaticallyStopped).toBe(false);
  });

  it.each(['취소', '화면 이동'])(
    '%s 후 지연된 마지막 데이터가 도착해도 전사하지 않는다',
    async (action) => {
      vi.useFakeTimers();
      FakeMediaRecorder.deferStop = true;
      const { result, unmount } = renderHook(() => useVoiceInput({ onTranscript: vi.fn() }));
      await act(async () => result.current.startRecording());
      const recorder = FakeMediaRecorder.latest;
      if (action === '취소') act(() => result.current.cancelRecording());
      else unmount();
      await act(async () => recorder.finishStop());
      expect(transcribeAudio).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(stopTrack).toHaveBeenCalledTimes(1);
    },
  );

  it('일시적인 전사 실패 후 같은 녹음으로 재시도한다', async () => {
    vi.mocked(transcribeAudio)
      .mockRejectedValueOnce(new SpeechTranscriptionError('일시적인 오류', 502, true))
      .mockResolvedValueOnce('비 오는 날 드라이브 음악');
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    await act(async () => result.current.startRecording());
    expect(result.current.isRecording).toBe(true);

    act(() => result.current.stopRecording());
    await waitFor(() => expect(result.current.canRetry).toBe(true));
    expect(result.current.error).toBe('일시적인 오류');

    act(() => result.current.retryTranscription());
    await waitFor(() => expect(result.current.status).toBe('reviewing'));

    expect(transcribeAudio).toHaveBeenCalledTimes(2);
    expect(transcribeAudio).toHaveBeenLastCalledWith(expect.any(File), expect.any(AbortSignal));
    expect(onTranscript).toHaveBeenCalledWith('비 오는 날 드라이브 음악');
    expect(stopTrack).toHaveBeenCalled();
  });
});
