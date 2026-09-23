import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { recommend } from './api/recommendations'
import { login } from './features/auth-login/api/loginApi'
import { logout } from './features/auth-login/api/logoutApi'
import { signup } from './features/user-signup/api/signupApi'
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
vi.mock('./features/auth-login/api/loginApi', () => ({
  login: vi.fn(),
  LoginRequestError: class LoginRequestError extends Error {},
}))
vi.mock('./features/auth-login/api/logoutApi', () => ({
  logout: vi.fn(),
  LogoutRequestError: class LogoutRequestError extends Error {},
}))
vi.mock('./features/user-signup/api/signupApi', () => ({ signup: vi.fn() }))
vi.mock('./features/chat-entry/components/ChatEntryPage', () => ({
  ChatEntryPage: () => <h1>우리 지역 채팅방</h1>,
}))

beforeEach(() => {
  cleanup()
})

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
    vi.mocked(login).mockResolvedValue({
      message: 'login success',
      data: { access_token: 'test-access-token', expires_in: 3600 },
    })
    vi.mocked(signup).mockResolvedValue({
      message: 'register success',
      data: { user_id: 1 },
    })
    vi.mocked(logout).mockResolvedValue(undefined)
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

describe('로그인과 회원가입 화면 연결', () => {
  beforeEach(() => {
    vi.mocked(login).mockResolvedValue({
      message: 'login success',
      data: { access_token: 'test-access-token', expires_in: 3600 },
    })
    vi.mocked(signup).mockResolvedValue({
      message: 'register success',
      data: { user_id: 1 },
    })
    vi.mocked(logout).mockResolvedValue(undefined)
  })

  it('로그인 화면의 회원가입 링크가 회원가입 경로를 가리킨다', () => {
    window.history.replaceState(null, '', '/login')
    render(<App />)

    expect(screen.getByRole('link', { name: '회원가입' })).toHaveAttribute('href', '/signup')
  })

  it('회원가입 경로에서 회원가입 화면을 렌더링한다', () => {
    window.history.replaceState(null, '', '/signup')
    render(<App />)

    expect(screen.getByRole('heading', { name: '회원가입' })).toBeInTheDocument()
  })

  it('회원가입 성공 후 로그인 화면으로 이동한다', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/signup')
    render(<App />)

    await user.type(screen.getByLabelText('닉네임'), '가입테스트')
    await user.type(screen.getByLabelText('이메일 아이디'), 'signup.test')
    await user.type(screen.getByLabelText('이메일 도메인'), 'example.com')
    await user.type(screen.getByLabelText('비밀번호'), 'Testpass1!')
    await user.click(screen.getByRole('checkbox', { name: '[필수] 서비스 이용약관 동의' }))
    await user.click(screen.getByRole('button', { name: '회원가입' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '다시 만나서 반가워요' })).toBeInTheDocument()
    })
  })

  it('로그인 성공 후 메인 페이지로 이동한다', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/login')
    render(<App />)

    await user.type(screen.getByLabelText('이메일'), 'login.test@example.com')
    await user.type(screen.getByLabelText('비밀번호'), 'Testpass1!')
    await user.click(screen.getByRole('button', { name: '로그인' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '음악 지도' })).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument()
  })

  it('로그아웃 성공 후 로그인 화면으로 이동한다', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/login')
    render(<App />)

    await user.type(screen.getByLabelText('이메일'), 'login.test@example.com')
    await user.type(screen.getByLabelText('비밀번호'), 'Testpass1!')
    await user.click(screen.getByRole('button', { name: '로그인' }))
    await user.click(await screen.findByRole('button', { name: '로그아웃' }))

    await waitFor(() => {
      expect(logout).toHaveBeenCalledOnce()
      expect(screen.getByRole('heading', { name: '다시 만나서 반가워요' })).toBeInTheDocument()
    })
  })

  it('로그인 후 채팅 탭을 누르면 자동 입장 화면으로 이동한다', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/login')
    render(<App />)

    await user.type(screen.getByLabelText('이메일'), 'login.test@example.com')
    await user.type(screen.getByLabelText('비밀번호'), 'Testpass1!')
    await user.click(screen.getByRole('button', { name: '로그인' }))
    await user.click(await screen.findByRole('button', { name: '채팅' }))

    expect(await screen.findByRole('heading', { name: '우리 지역 채팅방' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/chat')
  })
})
