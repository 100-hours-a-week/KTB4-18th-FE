import type { Recommendation } from '../types/recommendation'

// 운영에서는 같은 도메인의 /api를 백엔드로 연결하거나 VITE_API_BASE_URL을 설정합니다.
const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    credentials: 'include', // 비로그인 추천의 소유권을 확인하는 세션 쿠키
    ...options,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.message ?? '요청을 처리하지 못했습니다.')
  if (!body?.data) throw new Error('서버 응답을 확인할 수 없습니다.')
  return body.data as T
}

export async function recommend(prompt: string, conversationKey: string, signal: AbortSignal) {
  const created = await request<Recommendation>('/recommendations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_type: 'TEXT', trigger_type: 'CHATBOT', conversation_key: conversationKey, prompt }),
    signal,
  })
  // 실제 AI가 비동기로 처리하는 경우에도 화면 코드는 그대로 사용할 수 있습니다.
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await request<Recommendation>(`/recommendations/${created.recommendation_id}`, { signal })
    if (result.status === 'COMPLETED') return result
    if (result.status === 'FAILED') throw new Error('추천에 실패했습니다. 다시 시도해 주세요.')
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 1000)
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    })
  }
  throw new Error('추천 대기 시간이 길어지고 있습니다. 잠시 후 다시 시도해 주세요.')
}
