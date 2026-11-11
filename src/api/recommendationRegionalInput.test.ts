import { afterEach, expect, it, vi } from 'vitest';
import { recommend } from './recommendations';
import { submitImageRecommendation } from '../features/chat-image-recommendation/api/imageRecommendation';
import { authenticatedFetch } from '../features/auth-login/api/authSession';
import { recommendationLocationToken } from './recommendationLocation';
vi.mock('./recommendationLocation', () => ({
  recommendationLocationToken: vi.fn().mockResolvedValue('signed-region'),
}));
vi.mock('../features/auth-login/api/authSession', () => ({
  AuthRequestError: class extends Error {},
  authenticatedFetch: vi.fn(),
  getSharedAuthEpoch: () => 'account',
}));
afterEach(() => vi.clearAllMocks());
it('passes a server location token for TEXT and VOICE without accepting a raw region', async () => {
  vi.mocked(authenticatedFetch).mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          data: { recommendation_id: 42, status: 'PROCESSING', conversation_key: 'thread' },
        }),
        { status: 202 },
      ),
  );
  for (const kind of ['TEXT', 'VOICE'] as const) {
    await recommend('기분 좋은 음악', 'thread', new AbortController().signal, kind);
    const body = JSON.parse(String(vi.mocked(authenticatedFetch).mock.lastCall?.[1]?.body));
    expect(body).toEqual({
      input_type: kind,
      trigger_type: 'CHATBOT',
      conversation_key: 'thread',
      prompt: '기분 좋은 음악',
      location_resolution_token: 'signed-region',
    });
  }
});
it('sends image location as one multipart field and preserves region-unknown recommendations', async () => {
  vi.mocked(authenticatedFetch).mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          data: { recommendation_id: 42, status: 'PROCESSING', conversation_key: 'thread' },
        }),
        { status: 202 },
      ),
  );
  await submitImageRecommendation(new Blob(['jpeg']), 'thread', new AbortController().signal);
  const form = vi.mocked(authenticatedFetch).mock.lastCall?.[1]?.body as FormData;
  expect(form.getAll('location_resolution_token')).toEqual(['signed-region']);
  expect(form.has('region_id')).toBe(false);
  vi.mocked(recommendationLocationToken).mockResolvedValueOnce(undefined);
  await recommend('음악', 'thread', new AbortController().signal);
  expect(
    JSON.parse(String(vi.mocked(authenticatedFetch).mock.lastCall?.[1]?.body)),
  ).not.toHaveProperty('location_resolution_token');
});
