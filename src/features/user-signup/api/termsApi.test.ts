import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCurrentTerms, getTermDetail } from './termsApi'

const types = ['SERVICE', 'AIPERSONAL', 'PROFILE', 'LOCATION', 'PRIVACY', 'LOCATIONTERMS']
const items = types.map((type, index) => ({
  terms_id: index === 1 ? 7 : index + 1,
  type,
  version: index === 1 ? 'v0.3' : 'v0.2',
  title: type,
  is_required: index < 2,
  effective_at: '2026-09-25T10:00:00Z',
}))

function response(message: string, data: unknown) {
  return new Response(JSON.stringify({ message, data }), { status: 200 })
}

describe('signup terms API', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('현재 ID가 바뀌어도 유형 순서로 약관을 표시한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('terms retrieved', { items })))
    const result = await getCurrentTerms()
    expect(result.map((term) => term.terms_id)).toEqual([1, 5, 4, 3, 7, 6])
    expect(result.filter((term) => term.is_required).map((term) => term.terms_id)).toEqual([1, 7])
  })

  it('누락되거나 중복된 유형을 전체 실패로 처리한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('terms retrieved', { items: [...items.slice(0, 5), items[0]] })))
    await expect(getCurrentTerms()).rejects.toThrow('terms unavailable')
  })

  it('상세 응답이 선택한 버전과 다르면 표시하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('term retrieved', { ...items[0], version: 'v0.4', content: 'text' })))
    await expect(getTermDetail(items[0] as Parameters<typeof getTermDetail>[0])).rejects.toThrow('term unavailable')
  })
})
