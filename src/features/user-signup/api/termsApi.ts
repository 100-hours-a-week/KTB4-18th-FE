export const TermType = {
  // 서비스 이용약관
  SERVICE: 'SERVICE',
  // 개인정보 처리방침
  PRIVACY: 'PRIVACY',
  // 개인위치정보 수집·이용 동의
  LOCATION: 'LOCATION',
  // 출생연도·성별의 맞춤 추천 이용 동의
  PROFILE: 'PROFILE',
  // AI 맞춤 음악 추천 정보 이용 동의
  AIPERSONAL: 'AIPERSONAL',
  // 위치기반서비스 이용약관
  LOCATIONTERMS: 'LOCATIONTERMS',
} as const

export type TermType = (typeof TermType)[keyof typeof TermType]

export type CurrentTerm = {
  terms_id: number
  type: TermType
  version: string
  title: string
  is_required: boolean
  effective_at: string
}

export type TermDetail = CurrentTerm & { content: string }

export const TERM_ORDER: TermType[] = [
  TermType.SERVICE, TermType.PRIVACY, TermType.LOCATION,
  TermType.PROFILE, TermType.AIPERSONAL, TermType.LOCATIONTERMS,
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTerm(value: unknown): value is CurrentTerm {
  if (!isRecord(value)) return false
  return Number.isSafeInteger(value.terms_id) && (value.terms_id as number) > 0 &&
    TERM_ORDER.includes(value.type as TermType) &&
    typeof value.version === 'string' && value.version.trim().length > 0 &&
    typeof value.title === 'string' && value.title.trim().length > 0 &&
    typeof value.is_required === 'boolean' &&
    typeof value.effective_at === 'string' &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value.effective_at) &&
    !Number.isNaN(Date.parse(value.effective_at))
}

export async function getCurrentTerms(signal?: AbortSignal): Promise<CurrentTerm[]> {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1/terms`, { signal })
  if (!response.ok) throw new Error('terms unavailable')
  const body: unknown = await response.json()
  if (!isRecord(body) || body.message !== 'terms retrieved' || !isRecord(body.data) ||
    !Array.isArray(body.data.items)) throw new Error('terms unavailable')
  const items: unknown[] = body.data.items
  if (items.length !== TERM_ORDER.length || !items.every(isTerm) ||
    new Set(items.map((term) => term.type)).size !== TERM_ORDER.length ||
    new Set(items.map((term) => term.terms_id)).size !== TERM_ORDER.length) {
    throw new Error('terms unavailable')
  }
  return (items as CurrentTerm[]).sort((a, b) => TERM_ORDER.indexOf(a.type) - TERM_ORDER.indexOf(b.type))
}

export async function getTermDetail(term: CurrentTerm): Promise<TermDetail> {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1/terms/${term.terms_id}`)
  if (!response.ok) throw new Error('term unavailable')
  const body: unknown = await response.json()
  if (!isRecord(body) || body.message !== 'term retrieved' || !isRecord(body.data) ||
    !isTerm(body.data) || body.data.terms_id !== term.terms_id || body.data.type !== term.type ||
    body.data.version !== term.version ||
    typeof (body.data as Record<string, unknown>).content !== 'string' ||
    ((body.data as Record<string, unknown>).content as string).trim().length === 0) {
    throw new Error('term unavailable')
  }
  return body.data as TermDetail
}
