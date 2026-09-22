const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

interface SpeechTranscription {
  transcript: string
}

interface ApiBody<T> {
  message?: string
  data?: T | null
}

function userMessage(status: number, serverMessage?: string) {
  switch (status) {
    case 400:
      return 'WebM 또는 MP4 형식으로 60초 이내에서 다시 녹음해 주세요.'
    case 401:
      return '로그인이 만료되었습니다. 다시 로그인해 주세요.'
    case 413:
      return '음성 파일이 10MB를 초과했습니다. 더 짧게 녹음해 주세요.'
    case 502:
      return '음성 변환 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.'
    default:
      return serverMessage ?? '음성을 텍스트로 변환하지 못했습니다.'
  }
}

export async function transcribeAudio(audio: File, signal: AbortSignal) {
  const formData = new FormData()
  formData.append('audio', audio)

  const response = await fetch(`${baseUrl}/api/v1/speech-transcriptions`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
    signal,
  })
  const body = (await response.json().catch(() => null)) as ApiBody<SpeechTranscription> | null
  if (!response.ok) {
    throw new Error(userMessage(response.status, body?.message))
  }

  const transcript = body?.data?.transcript?.trim()
  if (!transcript) {
    throw new Error('변환된 문장을 확인할 수 없습니다. 다시 녹음해 주세요.')
  }
  return transcript
}
