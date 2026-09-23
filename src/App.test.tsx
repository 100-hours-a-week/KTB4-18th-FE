import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { recommend } from './api/recommendations'
import type { VoiceStatus } from './hooks/useVoiceInput'

const voiceActions = {
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  cancelRecording: vi.fn(),
  finishReview: vi.fn(),
  retryTranscription: vi.fn(),
  useTextInput: vi.fn(),
}

let transcriptHandler: (transcript: string) => void = () => undefined
let voiceState: {
  status: VoiceStatus
  elapsedSeconds: number
  error: string
  canRetry: boolean
  isRecording: boolean
  isTranscribing: boolean
} = {
  status: 'idle',
  elapsedSeconds: 0,
  error: '',
  canRetry: false,
  isRecording: false,
  isTranscribing: false,
}

vi.mock('./api/recommendations', () => ({ recommend: vi.fn() }))
vi.mock('./hooks/useVoiceInput', () => ({
  useVoiceInput: ({ onTranscript }: { onTranscript: (transcript: string) => void }) => {
    transcriptHandler = onTranscript
    return { ...voiceState, ...voiceActions }
  },
}))

describe('음성 transcript 공통 추천 흐름', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/chatbot')
    voiceState = {
      status: 'idle',
      elapsedSeconds: 0,
      error: '',
      canRetry: false,
      isRecording: false,
      isTranscribing: false,
    }
    vi.mocked(recommend).mockResolvedValue({
      recommendation_id: 1,
      conversation_key: 'conversation',
      status: 'COMPLETED',
      items: [{
        rank_no: 1,
        music: {
          music_id: 1,
          title: '밤편지',
          artist_name: '아이유',
          album_cover_url: null,
          preview_url: null,
        },
      }],
      completed_at: '2026-09-21T12:00:00Z',
    })
  })

  it('transcript를 수정한 뒤 VOICE 추천 요청을 보낸다', async () => {
    const user = userEvent.setup()
    render(<App />)

    act(() => transcriptHandler('비 오는 날 노래'))
    const input = screen.getByLabelText('추천받고 싶은 상황')
    expect(input).toHaveValue('비 오는 날 노래')
    expect(recommend).not.toHaveBeenCalled()

    await user.clear(input)
    await user.type(input, '비 오는 날 드라이브 음악')
    await user.click(screen.getByRole('button', { name: '추천 요청 보내기' }))

    expect(recommend).toHaveBeenCalledWith(
      '비 오는 날 드라이브 음악',
      expect.any(String),
      expect.any(AbortSignal),
      'VOICE',
    )
  })

  it('전사 실패 시 재시도·재녹음·텍스트 입력 경로를 제공한다', async () => {
    voiceState = {
      ...voiceState,
      error: '음성 변환 서비스를 사용할 수 없습니다.',
      canRetry: true,
    }
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '전사 다시 시도' }))
    await user.click(screen.getByRole('button', { name: '다시 녹음' }))
    await user.click(screen.getByRole('button', { name: '텍스트로 입력' }))

    expect(voiceActions.retryTranscription).toHaveBeenCalledOnce()
    expect(voiceActions.startRecording).toHaveBeenCalledOnce()
    expect(voiceActions.useTextInput).toHaveBeenCalledOnce()
  })
})
