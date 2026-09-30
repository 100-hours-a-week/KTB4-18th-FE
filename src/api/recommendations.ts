import type {
  Recommendation,
  RecommendationAccepted,
  RecommendationStreamTrack,
} from '../types/recommendation';
import { AuthRequestError, authenticatedFetch } from '../features/auth-login/api/authSession';

// 운영에서는 같은 도메인의 /api를 백엔드로 연결하거나 VITE_API_BASE_URL을 설정합니다.
const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

async function request<T>(
  path: string,
  options?: RequestInit,
  allowAnonymousOnRefreshUnauthorized = false,
): Promise<T> {
  let response: Response;
  try {
    response = await authenticatedFetch(
      `${baseUrl}/api/v1${path}`,
      {
        credentials: 'include', // 비로그인 추천의 소유권을 확인하는 세션 쿠키
        ...options,
      },
      { allowAnonymousOnRefreshUnauthorized },
    );
  } catch (caught) {
    if (caught instanceof AuthRequestError && caught.status === 401) {
      throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.', { cause: caught });
    }
    throw caught;
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? '로그인이 만료되었습니다. 다시 로그인해 주세요.'
        : (body?.message ?? '요청을 처리하지 못했습니다.'),
    );
  }
  if (!body?.data) throw new Error('서버 응답을 확인할 수 없습니다.');
  return body.data as T;
}

export type RecommendationInputType = 'TEXT' | 'VOICE';

export async function recommend(
  prompt: string,
  conversationKey: string,
  signal: AbortSignal,
  inputType: RecommendationInputType = 'TEXT',
) {
  const accepted = await request<RecommendationAccepted>('/recommendations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_type: inputType,
      trigger_type: 'CHATBOT',
      conversation_key: conversationKey,
      prompt,
    }),
    signal,
  });
  if (
    !Number.isSafeInteger(accepted.recommendation_id) ||
    accepted.recommendation_id <= 0 ||
    accepted.status !== 'PROCESSING'
  ) {
    throw new Error('추천 요청 접수 결과를 확인할 수 없습니다. 다시 시도해 주세요.');
  }
  return accepted;
}

interface RecommendationStreamHandlers {
  onText: (delta: string) => void;
  onTracks: (tracks: RecommendationStreamTrack[]) => void;
}

export async function streamRecommendation(
  recommendationId: number,
  signal: AbortSignal,
  handlers: RecommendationStreamHandlers,
): Promise<Recommendation> {
  let response: Response;
  try {
    response = await authenticatedFetch(
      `${baseUrl}/api/v1/recommendations/${recommendationId}/events`,
      {
        credentials: 'include',
        headers: { Accept: 'text/event-stream' },
        signal,
      },
    );
  } catch (caught) {
    if (caught instanceof AuthRequestError && caught.status === 401) {
      throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.', { cause: caught });
    }
    if (caught instanceof DOMException && caught.name === 'AbortError') throw caught;
    throw new Error('추천 결과 스트림에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', {
      cause: caught,
    });
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      response.status === 401
        ? '로그인이 만료되었습니다. 다시 로그인해 주세요.'
        : (body?.message ?? '추천 결과를 가져오지 못했습니다.'),
    );
  }
  if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('text/event-stream')) {
    throw new Error('추천 결과 스트림 형식이 올바르지 않습니다.');
  }
  if (!response.body) {
    throw new Error('추천 결과 스트림을 읽을 수 없습니다.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed: Recommendation | null = null;

  const dispatch = (frame: string) => {
    let eventName = 'message';
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      if (line.startsWith('data:')) {
        const value = line.slice(5);
        data.push(value.startsWith(' ') ? value.slice(1) : value);
      }
    }
    if (!data.length) return;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data.join('\n')) as Record<string, unknown>;
    } catch {
      throw new Error('추천 결과 스트림의 데이터 형식이 올바르지 않습니다.');
    }
    if (eventName === 'text' && typeof payload.delta === 'string') {
      handlers.onText(payload.delta);
    } else if (eventName === 'tracks' && Array.isArray(payload.tracks)) {
      handlers.onTracks(payload.tracks as RecommendationStreamTrack[]);
    } else if (eventName === 'error') {
      throw new Error(
        typeof payload.detail === 'string' ? payload.detail : '추천을 완료하지 못했습니다.',
      );
    } else if (eventName === 'done') {
      if (payload.status !== 'COMPLETED' || !Array.isArray(payload.items)) {
        throw new Error('추천 완료 결과 형식이 올바르지 않습니다.');
      }
      completed = payload as unknown as Recommendation;
    }
  };

  try {
    while (!completed) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const delimiter = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n';
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + delimiter.length);
        dispatch(frame);
        if (completed) break;
        boundary = buffer.search(/\r?\n\r?\n/);
      }
      if (chunk.done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  if (!completed) {
    throw new Error('추천이 완료되기 전에 연결이 종료됐습니다. 다시 시도해 주세요.');
  }
  return completed;
}
