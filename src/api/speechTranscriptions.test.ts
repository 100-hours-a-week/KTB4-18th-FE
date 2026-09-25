import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeechTranscriptionError, transcribeAudio } from './speechTranscriptions';

describe('transcribeAudio', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('음성 파일을 multipart로 전송하고 transcript를 반환한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'speech transcription completed',
          data: { transcript: '  비 오는 날 드라이브  ' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['audio'], 'voice.webm', { type: 'audio/webm' });

    const transcript = await transcribeAudio(file, new AbortController().signal);

    expect(transcript).toBe('비 오는 날 드라이브');
    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.body).toBeInstanceOf(FormData);
    expect((options.body as FormData).get('audio')).toBe(file);
  });

  it('STT 제공자 오류는 같은 녹음으로 재시도할 수 있게 분류한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: 'speech service unavailable',
            data: null,
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const error = await transcribeAudio(
      new File(['audio'], 'voice.webm', { type: 'audio/webm' }),
      new AbortController().signal,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SpeechTranscriptionError);
    expect(error).toMatchObject({ status: 502, isRetryable: true });
  });

  it('잘못된 음성 파일은 같은 파일로 재시도하지 않게 분류한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: 'invalid audio file',
            data: null,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const error = await transcribeAudio(
      new File(['audio'], 'voice.webm', { type: 'audio/webm' }),
      new AbortController().signal,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SpeechTranscriptionError);
    expect(error).toMatchObject({ status: 400, isRetryable: false });
  });

  it('네트워크 실패는 재시도 가능한 오류로 변환한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network failed')));

    const error = await transcribeAudio(
      new File(['audio'], 'voice.webm', { type: 'audio/webm' }),
      new AbortController().signal,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SpeechTranscriptionError);
    expect(error).toMatchObject({ status: null, isRetryable: true });
  });
});
