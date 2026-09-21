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

export type RecommendationInputType = 'TEXT' | 'VOICE'

export async function recommend(
  prompt: string,
  conversationKey: string,
  signal: AbortSignal,
  inputType: RecommendationInputType = 'TEXT',
) {
  const result = await request<Recommendation>('/recommendations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_type: inputType,
      trigger_type: 'CHATBOT',
      conversation_key: conversationKey,
      prompt,
    }),
    signal,
  })
  if (result.status !== 'COMPLETED' || result.items.length < 1 || result.items.length > 5) {
    throw new Error('추천 결과를 확인할 수 없습니다. 다시 시도해 주세요.')
  }
  return result
}
