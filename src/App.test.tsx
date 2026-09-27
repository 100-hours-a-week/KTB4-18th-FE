import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { recommend } from './api/recommendations';
import { login } from './features/auth-login/api/loginApi';
import { logout } from './features/auth-login/api/logoutApi';
import { resetAuthSessionForTests } from './features/auth-login/api/authSession';
import { signup } from './features/user-signup/api/signupApi';
import { getCurrentTerms, TermType } from './features/user-signup/api/termsApi';
import type { VoiceStatus } from './hooks/useVoiceInput';

const voiceActions = {
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  cancelRecording: vi.fn(),
  finishReview: vi.fn(),
  retryTranscription: vi.fn(),
  useTextInput: vi.fn(),
};

let transcriptHandler: (transcript: string) => void = () => undefined;
let voiceState: {
  status: VoiceStatus;
  elapsedSeconds: number;
  error: string;
  canRetry: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
} = {
  status: 'idle',
  elapsedSeconds: 0,
  error: '',
  canRetry: false,
  isRecording: false,
  isTranscribing: false,
};

vi.mock('./api/recommendations', () => ({ recommend: vi.fn() }));
vi.mock('./hooks/useVoiceInput', () => ({
  useVoiceInput: ({ onTranscript }: { onTranscript: (transcript: string) => void }) => {
    transcriptHandler = onTranscript;
    return { ...voiceState, ...voiceActions };
  },
}));
vi.mock('./features/auth-login/api/loginApi', () => ({
  login: vi.fn(),
  LoginRequestError: class LoginRequestError extends Error {},
}));
vi.mock('./features/auth-login/api/logoutApi', () => ({
  logout: vi.fn(),
  LogoutRequestError: class LogoutRequestError extends Error {},
}));
vi.mock('./features/user-signup/api/signupApi', () => ({ signup: vi.fn() }));
vi.mock('./features/user-signup/api/termsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./features/user-signup/api/termsApi')>()),
  getCurrentTerms: vi.fn(),
  getTermDetail: vi.fn(),
}));
vi.mock('./features/chat-entry/components/ChatEntryPage', () => ({
  ChatEntryPage: () => <h1>우리 지역 채팅방</h1>,
}));

beforeEach(() => {
  cleanup();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('음성 transcript 공통 추천 흐름', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/chatbot');
    voiceState = {
      status: 'idle',
      elapsedSeconds: 0,
      error: '',
      canRetry: false,
      isRecording: false,
      isTranscribing: false,
    };
    vi.mocked(recommend).mockResolvedValue({
      recommendation_id: 1,
      conversation_key: 'conversation',
      status: 'COMPLETED',
      items: [
        {
          rank_no: 1,
          music: {
            music_id: 1,
            title: '밤편지',
            artist_name: '아이유',
            album_cover_url: null,
            preview_url: null,
          },
        },
      ],
      completed_at: '2026-09-21T12:00:00Z',
    });
    vi.mocked(login).mockResolvedValue({
      message: 'login success',
      data: { access_token: 'test-access-token', expires_in: 3600 },
    });
    vi.mocked(signup).mockResolvedValue({
      message: 'register success',
      data: { user_id: 1 },
    });
    vi.mocked(logout).mockResolvedValue(undefined);
  });

  it('transcript를 수정한 뒤 VOICE 추천 요청을 보낸다', async () => {
    const user = userEvent.setup();
    render(<App />);

    act(() => transcriptHandler('비 오는 날 노래'));
    const input = screen.getByLabelText('추천받고 싶은 상황');
    expect(input).toHaveValue('비 오는 날 노래');
    expect(recommend).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '비 오는 날 드라이브 음악');
    await user.click(screen.getByRole('button', { name: '추천 요청 보내기' }));

    expect(recommend).toHaveBeenCalledWith(
      '비 오는 날 드라이브 음악',
      expect.any(String),
      expect.any(AbortSignal),
      'VOICE',
    );
  });

  it('전사 실패 시 재시도·재녹음·텍스트 입력 경로를 제공한다', async () => {
    voiceState = {
      ...voiceState,
      error: '음성 변환 서비스를 사용할 수 없습니다.',
      canRetry: true,
    };
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '전사 다시 시도' }));
    await user.click(screen.getByRole('button', { name: '다시 녹음' }));
    await user.click(screen.getByRole('button', { name: '텍스트로 입력' }));

    expect(voiceActions.retryTranscription).toHaveBeenCalledOnce();
    expect(voiceActions.startRecording).toHaveBeenCalledOnce();
    expect(voiceActions.useTextInput).toHaveBeenCalledOnce();
  });
});

describe('로그인과 회원가입 화면 연결', () => {
  beforeEach(() => {
    const types = [
      TermType.SERVICE,
      TermType.AIPERSONAL,
      TermType.PROFILE,
      TermType.LOCATION,
      TermType.PRIVACY,
      TermType.LOCATIONTERMS,
    ];
    const titles = [
      '서비스 이용약관',
      'AI 맞춤 음악 추천 정보 이용 동의',
      '출생연도·성별의 맞춤 추천 이용 동의',
      '개인위치정보 수집·이용 동의',
      '개인정보 처리방침',
      '위치기반서비스 이용약관',
    ];
    vi.mocked(getCurrentTerms).mockResolvedValue(
      types.map((type, index) => ({
        terms_id: index === 1 ? 7 : index + 1,
        type,
        version: index === 1 ? 'v0.3' : 'v0.2',
        title: titles[index],
        is_required: index < 2,
        effective_at: '2026-09-25T10:00:00Z',
      })),
    );
    vi.mocked(login).mockResolvedValue({
      message: 'login success',
      data: { access_token: 'test-access-token', expires_in: 3600 },
    });
    vi.mocked(signup).mockResolvedValue({
      message: 'register success',
      data: { user_id: 1 },
    });
    vi.mocked(logout).mockResolvedValue(undefined);
  });

  it('로그인 화면의 회원가입 링크가 회원가입 경로를 가리킨다', () => {
    window.history.replaceState(null, '', '/login');
    render(<App />);

    expect(screen.getByRole('link', { name: '회원가입' })).toHaveAttribute('href', '/signup');
  });

  it('회원가입 경로에서 회원가입 화면을 렌더링한다', () => {
    window.history.replaceState(null, '', '/signup');
    render(<App />);

    expect(screen.getByRole('heading', { name: '회원가입' })).toBeInTheDocument();
  });

  it('회원가입 성공 후 로그인 화면으로 이동한다', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/signup');
    render(<App />);

    await user.type(screen.getByLabelText('닉네임'), '가입테스트');
    await user.type(screen.getByLabelText('이메일 아이디'), 'signup.test');
    await user.type(screen.getByLabelText('이메일 도메인'), 'example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'Testpass1!');
    await user.click(await screen.findByRole('checkbox', { name: '[필수] 서비스 이용약관' }));
    await user.click(
      screen.getByRole('checkbox', { name: '[필수] AI 맞춤 음악 추천 정보 이용 동의' }),
    );
    await user.click(screen.getByRole('button', { name: '회원가입' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '다시 만나서 반가워요' })).toBeInTheDocument();
    });
    expect(vi.mocked(signup)).toHaveBeenCalledWith(expect.objectContaining({ terms_ids: [1, 7] }));
  });

  it('첫 번째 필수 약관만 동의하면 회원가입할 수 없다', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/signup');
    render(<App />);

    await user.type(screen.getByLabelText('닉네임'), '가입테스트');
    await user.type(screen.getByLabelText('이메일 아이디'), 'signup.test');
    await user.type(screen.getByLabelText('이메일 도메인'), 'example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'Testpass1!');
    await user.click(await screen.findByRole('checkbox', { name: '[필수] 서비스 이용약관' }));

    expect(screen.getByRole('button', { name: '회원가입' })).toBeDisabled();
  });

  it('개인정보 약관을 선택하면 ID 5를 포함하고 다른 선택 약관은 제외한다', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/signup');
    render(<App />);

    await user.type(screen.getByLabelText('닉네임'), '가입테스트');
    await user.type(screen.getByLabelText('이메일 아이디'), 'signup.test');
    await user.type(screen.getByLabelText('이메일 도메인'), 'example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'Testpass1!');
    await user.click(await screen.findByRole('checkbox', { name: '[필수] 서비스 이용약관' }));
    await user.click(
      screen.getByRole('checkbox', { name: '[필수] AI 맞춤 음악 추천 정보 이용 동의' }),
    );
    await user.click(screen.getByRole('checkbox', { name: '[선택] 개인정보 처리방침' }));
    await user.click(screen.getByRole('button', { name: '회원가입' }));

    await waitFor(() => expect(vi.mocked(signup)).toHaveBeenCalled());
    expect(vi.mocked(signup)).toHaveBeenLastCalledWith(
      expect.objectContaining({ terms_ids: [1, 7, 5] }),
    );
  });

  it('전체 동의는 여섯 유형의 현재 약관 ID를 모두 제출한다', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/signup');
    render(<App />);

    await user.type(screen.getByLabelText('닉네임'), '가입테스트');
    await user.type(screen.getByLabelText('이메일 아이디'), 'signup.test');
    await user.type(screen.getByLabelText('이메일 도메인'), 'example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'Testpass1!');
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '전체 동의' })).toBeEnabled());
    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }));
    await user.click(screen.getByRole('button', { name: '회원가입' }));

    await waitFor(() => expect(vi.mocked(signup)).toHaveBeenCalled());
    expect(vi.mocked(signup).mock.lastCall?.[0].terms_ids.toSorted()).toEqual([1, 3, 4, 5, 6, 7]);
  });

  it('전체 동의를 해제하면 가입 버튼이 다시 비활성화된다', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/signup');
    render(<App />);

    await user.type(screen.getByLabelText('닉네임'), '가입테스트');
    await user.type(screen.getByLabelText('이메일 아이디'), 'signup.test');
    await user.type(screen.getByLabelText('이메일 도메인'), 'example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'Testpass1!');
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '전체 동의' })).toBeEnabled());
    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }));
    expect(screen.getByRole('button', { name: '회원가입' })).toBeEnabled();

    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }));
    expect(screen.getByRole('button', { name: '회원가입' })).toBeDisabled();
  });

  it('로그인 성공 후 메인 페이지로 이동한다', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/login');
    render(<App />);

    await user.type(screen.getByLabelText('이메일'), 'login.test@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'Testpass1!');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '음악 지도' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
  });

  it('로그아웃 성공 후 로그인 화면으로 이동한다', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/login');
    render(<App />);

    await user.type(screen.getByLabelText('이메일'), 'login.test@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'Testpass1!');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await user.click(await screen.findByRole('button', { name: '로그아웃' }));

    await waitFor(() => {
      expect(logout).toHaveBeenCalledOnce();
      expect(screen.getByRole('heading', { name: '다시 만나서 반가워요' })).toBeInTheDocument();
    });
  });

  it('브라우저 뒤로가기 popstate로 메인에 복귀해도 로그인 표시를 유지한다', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/login');
    render(<App />);
    await user.type(screen.getByLabelText('이메일'), 'login.test@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'Testpass1!');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    expect(await screen.findByRole('button', { name: '로그아웃' })).toBeInTheDocument();

    act(() => {
      window.history.replaceState(null, '', '/music-records');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
  });

  it('데이터 401 뒤 refresh도 401이면 메인 인증 상태를 guest로 바꾼다', async () => {
    resetAuthSessionForTests();
    sessionStorage.clear();
    let refreshCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/token/csrf'))
          return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
        if (url.endsWith('/token/refresh')) {
          refreshCount += 1;
          return Promise.resolve(
            refreshCount === 1
              ? Response.json({ data: { access_token: 'test-token' } })
              : Response.json({ message: 'unauthorized', data: null }, { status: 401 }),
          );
        }
        if (url.includes('/users/me/music-records')) {
          return Promise.resolve(
            Response.json({ message: 'unauthorized', data: null }, { status: 401 }),
          );
        }
        return Promise.resolve(
          Response.json({ message: 'not found', data: null }, { status: 404 }),
        );
      }),
    );
    window.history.replaceState(null, '', '/');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('button', { name: '로그아웃' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '기록' }));
    await screen.findByRole('alert');
    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByRole('button', { name: '로그인' })).toBeInTheDocument();
    expect(sessionStorage.getItem('access_token')).toBeNull();
  });

  it('로그인 후 채팅 탭을 누르면 자동 입장 화면으로 이동한다', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/login');
    render(<App />);

    await user.type(screen.getByLabelText('이메일'), 'login.test@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'Testpass1!');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await user.click(await screen.findByRole('button', { name: '채팅방' }));

    expect(await screen.findByRole('heading', { name: '우리 지역 채팅방' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/chat');
  });
});
