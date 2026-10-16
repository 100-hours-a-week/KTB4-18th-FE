import { AuthRequestError, authenticatedFetch } from '../../../features/auth-login/api/authSession';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export interface ImageAccepted {
  recommendation_id: number;
  status: 'PROCESSING';
  conversation_key: string;
}

function uncertainError(message: string): Error {
  return Object.assign(new Error(message), { uncertain: true });
}

export class ImageRecommendationTerminalError extends Error {
  constructor() {
    super('이미지 추천을 완료하지 못했습니다. 다시 촬영해 주세요.');
    this.name = 'ImageRecommendationTerminalError';
  }
}

export async function resizeRecommendationImage(file: File, signal: AbortSignal): Promise<Blob> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    throw new Error('이 환경에서는 이미지를 처리할 수 없습니다. 다른 기기에서 다시 시도해 주세요.');
  }
  const worker = new Worker(new URL('../workers/imageResize.worker.ts', import.meta.url), {
    type: 'module',
  });
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('이미지 처리가 취소되었습니다.', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string }>) => {
      cleanup();
      if (event.data.blob) resolve(event.data.blob);
      else reject(new Error(event.data.error ?? '이미지를 처리할 수 없습니다.'));
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error('이미지를 처리할 수 없습니다. 다시 선택해 주세요.'));
    };
    worker.postMessage(file);
  });
}

export async function submitImageRecommendation(
  image: Blob,
  conversationKey: string,
  signal: AbortSignal,
): Promise<ImageAccepted> {
  const form = new FormData();
  form.append('image', image, 'recommendation.jpg');
  form.append('conversation_key', conversationKey);
  form.append('input_type', 'IMAGE');
  form.append('trigger_type', 'CHATBOT');
  let response: Response;
  try {
    response = await authenticatedFetch(`${baseUrl}/api/v1/recommendations/images`, {
      method: 'POST',
      credentials: 'include',
      body: form,
      signal,
    });
  } catch (error) {
    if (error instanceof AuthRequestError && error.status === 401)
      throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.', { cause: error });
    throw uncertainError(
      '요청 접수 여부를 확인할 수 없습니다. 같은 사진을 다시 보내면 중복 추천이 생길 수 있어요. 새로 촬영해 주세요.',
    );
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message ?? '이미지 추천을 요청하지 못했습니다.');
  const accepted = body?.data as ImageAccepted | undefined;
  if (
    !accepted ||
    !Number.isSafeInteger(accepted.recommendation_id) ||
    accepted.recommendation_id <= 0 ||
    accepted.status !== 'PROCESSING' ||
    accepted.conversation_key !== conversationKey
  ) {
    throw uncertainError(
      '요청 접수 여부를 확인할 수 없습니다. 같은 사진을 다시 보내면 중복 추천이 생길 수 있어요. 새로 촬영해 주세요.',
    );
  }
  return accepted;
}

export async function waitForImageVerdict(id: number, signal: AbortSignal): Promise<boolean> {
  let response: Response;
  try {
    response = await authenticatedFetch(`${baseUrl}/api/v1/recommendations/${id}/events`, {
      credentials: 'include',
      headers: { Accept: 'text/event-stream' },
      signal,
    });
  } catch (error) {
    if (error instanceof AuthRequestError && error.status === 401)
      throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.', { cause: error });
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error(
      '이미지 분석 결과를 가져오지 못했습니다. 같은 추천 요청에 다시 연결해 주세요.',
      { cause: error },
    );
  }
  if (
    !response.ok ||
    !response.headers.get('Content-Type')?.toLowerCase().startsWith('text/event-stream') ||
    !response.body
  ) {
    throw new Error('이미지 분석 결과를 가져오지 못했습니다.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let verdict: boolean | null = null;
  try {
    while (true) {
      const part = await reader.read();
      buffer += decoder.decode(part.value, { stream: !part.done });
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const delimiter = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n';
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + delimiter.length);
        const event = frame.match(/^event:\s*(\S+)/m)?.[1];
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (event === 'verdict') {
          let payload: { usable?: unknown };
          try {
            payload = JSON.parse(data) as { usable?: unknown };
          } catch {
            throw new Error('이미지 분석 결과가 올바르지 않습니다.');
          }
          if (typeof payload.usable !== 'boolean' || verdict !== null)
            throw new Error('이미지 분석 결과가 올바르지 않습니다.');
          verdict = payload.usable;
          if (verdict) return true;
        } else if (event === 'rejected') {
          let payload: { reason?: unknown; message?: unknown };
          try {
            payload = JSON.parse(data) as { reason?: unknown; message?: unknown };
          } catch {
            throw new Error('이미지 분석 결과가 올바르지 않습니다.');
          }
          if (
            verdict !== false ||
            !['scene_unreadable', 'not_a_place', 'provider_blocked'].includes(
              String(payload.reason),
            ) ||
            typeof payload.message !== 'string'
          ) {
            throw new Error('이미지 분석 결과가 올바르지 않습니다.');
          }
          return false;
        } else if (verdict === false && ['text', 'tracks', 'done'].includes(event ?? '')) {
          throw new Error('이미지 분석 결과가 올바르지 않습니다.');
        }
        if (event === 'error') throw new ImageRecommendationTerminalError();
        boundary = buffer.search(/\r?\n\r?\n/);
      }
      if (part.done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  throw new Error('이미지 분석이 완료되기 전에 연결이 종료됐습니다.');
}
