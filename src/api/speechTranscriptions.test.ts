import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../features/auth-login/api/authSession';
import { SpeechTranscriptionError, transcribeAudio } from './speechTranscriptions';

describe('transcribeAudio', () => {
  beforeEach(() => setAccessToken('access-token'));
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
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
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer access-token');
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
  it.each([
    [400, '음성 파일 형식과 MIME 타입이 일치하지 않습니다. 다시 녹음해 주세요.'],
    [400, '음성 파일이 손상되었거나 재생 가능한 음성이 없습니다. 다시 녹음해 주세요.'],
    [502, '음성 파일을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.'],
    [504, '음성 파일 준비 시간이 초과됐습니다. 다시 시도해 주세요.'],
  ])('%s 공개 오류의 구체적인 안내를 유지한다', async (status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ message, data: null }, { status })),
    );
    await expect(
      transcribeAudio(new File(['audio'], 'voice.webm'), new AbortController().signal),
    ).rejects.toMatchObject({ message, status, isRetryable: status >= 500 });
  });
});
