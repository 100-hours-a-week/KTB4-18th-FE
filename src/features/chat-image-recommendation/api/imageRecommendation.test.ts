import { afterEach, describe, expect, it, vi } from 'vitest';

import { authenticatedFetch } from '../../../features/auth-login/api/authSession';
import { submitImageRecommendation, waitForImageVerdict } from './imageRecommendation';

vi.mock('../../../features/auth-login/api/authSession', () => ({
  AuthRequestError: class AuthRequestError extends Error {
    status = 401;
  },
  authenticatedFetch: vi.fn(),
}));

describe('image recommendation API', () => {
  afterEach(() => vi.clearAllMocks());

  it('posts the resized image as multipart without setting Content-Type', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            recommendation_id: 12,
            status: 'PROCESSING',
            conversation_key: 'conversation',
          },
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await submitImageRecommendation(
      new Blob(['jpeg'], { type: 'image/jpeg' }),
      'conversation',
      new AbortController().signal,
    );
    const [, init] = vi.mocked(authenticatedFetch).mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(init?.headers).toBeUndefined();
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get('input_type')).toBe('IMAGE');
    expect(form.get('trigger_type')).toBe('CHATBOT');
    expect(form.get('conversation_key')).toBe('conversation');
    expect(form.get('image')).toBeInstanceOf(Blob);
  });

  it('waits for a valid rejected event after verdict false', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(
      new Response(
        'event: verdict\ndata: {"usable":false}\n\nevent: rejected\ndata: {"reason":"scene_unreadable","message":"fixed copy"}\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    await expect(waitForImageVerdict(12, new AbortController().signal)).resolves.toBe(false);
  });

  it('does not treat verdict false alone as a rejection', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(
      new Response('event: verdict\ndata: {"usable":false}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    await expect(waitForImageVerdict(12, new AbortController().signal)).rejects.toThrow(
      '이미지 분석이 완료되기 전에 연결이 종료됐습니다.',
    );
  });
});
