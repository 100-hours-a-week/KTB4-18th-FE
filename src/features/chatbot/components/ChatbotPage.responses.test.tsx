import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recommend, streamRecommendation } from '../../../api/recommendations';
import type { Recommendation } from '../../../types/recommendation';
import ChatbotPage from './ChatbotPage';

vi.mock('../../../api/recommendations', () => ({
  recommend: vi.fn(),
  streamRecommendation: vi.fn(),
}));
vi.mock('../../../hooks/useVoiceInput', () => ({
  useVoiceInput: () => ({
    status: 'idle',
    elapsedSeconds: 0,
    error: '',
    canRetry: false,
    isRecording: false,
    isTranscribing: false,
    useTextInput: vi.fn(),
    finishReview: vi.fn(),
  }),
}));
vi.mock('../../chat-image-recommendation/components/ChatImageRecommendation', () => ({
  ChatImageRecommendation: ({
    disabled,
    onUsable,
  }: {
    disabled: boolean;
    onUsable: (id: number, url: string, date: Date) => void;
  }) => (
    <button disabled={disabled} onClick={() => onUsable(1, 'blob:test-photo', new Date())}>
      사진 확인 완료 테스트
    </button>
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const accepted = {
  recommendation_id: 1,
  conversation_key: 'conversation',
  status: 'PROCESSING' as const,
};
const result: Recommendation = {
  ...accepted,
  status: 'COMPLETED',
  completed_at: '2026-10-25T12:00:00Z',
  items: ['밤편지', '산책', '가을밤'].map((title, index) => ({
    rank_no: index + 1,
    music: {
      music_id: index + 1,
      title,
      artist_name: '테스트 가수',
      album_cover_url: null,
      preview_url: null,
    },
  })),
};

async function send(text = '조용한 밤 산책') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('음악을 찾고 싶은 순간'), text);
  await user.click(screen.getByRole('button', { name: '음악 찾기 요청 보내기' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(recommend).mockResolvedValue(accepted);
  vi.mocked(streamRecommendation).mockResolvedValue(result);
});
afterEach(cleanup);

describe('챗봇 응답 표시', () => {
  it('첫 안내를 제목이나 마크다운 강조 없이 일반 문단으로 표시한다', () => {
    render(<ChatbotPage />);
    const greeting = screen.getByText('지금 어떤 순간에 머물고 있나요?');
    const welcome = greeting.closest('.welcome-bubble')!;
    expect(greeting.tagName).toBe('P');
    expect(welcome).toHaveTextContent('날씨나 장소, 느껴지는 기분을 편하게 알려주세요.');
    expect(welcome).toHaveTextContent('글로 적어 주시거나 음성으로 말해도 좋아요.');
    expect(welcome).toHaveTextContent('내 공간의 지난 선곡에서 다시 볼 수 있어요.');
    expect(welcome.querySelector('h1, h2, h3, strong, em, code')).toBeNull();
    expect(recommend).not.toHaveBeenCalled();
  });

  it('접수 대기와 SSE 수신 중 각각 하나의 진행 안내를 표시하고 결과도 한 말풍선에 합친다', async () => {
    const admission = deferred<Awaited<ReturnType<typeof recommend>>>();
    const stream = deferred<Recommendation>();
    let handlers!: Parameters<typeof streamRecommendation>[2];
    vi.mocked(recommend).mockReturnValue(admission.promise);
    vi.mocked(streamRecommendation).mockImplementation((_id, _signal, callbacks) => {
      handlers = callbacks;
      return stream.promise;
    });
    render(<ChatbotPage />);
    await send('**조용한** 밤');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(streamRecommendation).not.toHaveBeenCalled();

    await act(async () => admission.resolve(accepted));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getAllByText('어울리는 음악을 찾고 있어요…')).toHaveLength(1);
    const text = '**잔잔한** <em>밤</em>에 어울리는 곡이에요.\n편하게 들어보세요.';
    act(() => handlers.onText(text));
    expect(screen.queryByText('어울리는 음악을 찾고 있어요…')).not.toBeInTheDocument();
    const streamed = screen.getByText(/편하게 들어보세요/);
    expect(streamed.textContent).toBe(text);
    expect(streamed.querySelector('strong, em')).toBeNull();
    expect(streamed.closest('.assistant-content')).toHaveAttribute('aria-busy', 'true');

    await act(async () => stream.resolve(result));
    const response = screen.getByRole('region', { name: '추천 음악 3곡' });
    expect(response).toHaveTextContent('**잔잔한** <em>밤</em>에 어울리는 곡이에요.');
    expect(within(response).getAllByRole('listitem')).toHaveLength(3);
    expect(response.querySelector('strong, em')).toBeNull();
    expect(response.closest('.assistant-content')?.children).toHaveLength(1);
    expect(response.closest('.message-group')?.querySelectorAll('time')).toHaveLength(1);
    expect(screen.queryByText('추천곡 3곡을 준비했어요.')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(response.closest('.assistant-content')).toHaveAttribute('aria-busy', 'false');
    expect(recommend).toHaveBeenCalledWith(
      '**조용한** 밤',
      expect.any(String),
      expect.any(AbortSignal),
      'TEXT',
    );
    expect(streamRecommendation).toHaveBeenCalledTimes(1);
  });

  it('서버 설명이 없는 결과도 기존 기본 안내와 곡 목록을 표시한다', async () => {
    render(<ChatbotPage />);
    await send();
    const response = await screen.findByRole('region', { name: '추천 음악 3곡' });
    expect(response).toHaveTextContent('추천곡 3곡을 준비했어요.');
    expect(within(response).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('곡이 없는 결과는 서버 설명과 기존 빈 결과 안내를 같은 말풍선에 유지한다', async () => {
    vi.mocked(streamRecommendation).mockImplementation(async (_id, _signal, handlers) => {
      handlers.onText('조건을 조금 바꾸면 더 잘 찾을 수 있어요.');
      return { ...result, items: [] };
    });
    render(<ChatbotPage />);
    await send();
    const response = await screen.findByRole('region', { name: '추천 음악 없음' });
    expect(response).toHaveTextContent('조건을 조금 바꾸면 더 잘 찾을 수 있어요.');
    expect(response).toHaveTextContent('어울리는 곡을 아직 찾지 못했어요.');
    expect(response.closest('.assistant-content')?.children).toHaveLength(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('곡이 먼저 도착해도 진행 안내를 겹쳐 표시하지 않는다', async () => {
    const stream = deferred<Recommendation>();
    let handlers!: Parameters<typeof streamRecommendation>[2];
    vi.mocked(streamRecommendation).mockImplementation((_id, _signal, callbacks) => {
      handlers = callbacks;
      return stream.promise;
    });
    render(<ChatbotPage />);
    await send();
    act(() =>
      handlers.onTracks([
        {
          track_id: '1',
          title: '밤편지',
          artist: '테스트 가수',
          artwork_url: null,
          preview_url: null,
          store_url: null,
          reason: null,
        },
      ]),
    );
    expect(screen.getByRole('region', { name: '추천 음악 1곡' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await act(async () => stream.resolve(result));
  });

  it('스트림 실패는 같은 말풍선 안에 알리고 입력 복구를 유지한다', async () => {
    const stream = deferred<Recommendation>();
    vi.mocked(streamRecommendation).mockImplementation((_id, _signal, handlers) => {
      handlers.onText('지금 분위기에 맞는 곡을 찾고 있어요.');
      return stream.promise;
    });
    render(<ChatbotPage />);
    await send();
    await act(async () => stream.reject(new Error('연결이 종료됐어요. 다시 시도해 주세요.')));
    const alert = screen.getByRole('alert');
    expect(alert.closest('.assistant-text-bubble')).toHaveTextContent(
      '지금 분위기에 맞는 곡을 찾고 있어요.',
    );
    expect(screen.getByLabelText('음악을 찾고 싶은 순간')).toHaveValue('조용한 밤 산책');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /추천 음악/ })).not.toBeInTheDocument();
  });

  it('사진 추천도 진행 안내 하나에서 설명과 곡 목록이 함께 있는 응답으로 전환한다', async () => {
    const stream = deferred<Recommendation>();
    vi.mocked(streamRecommendation).mockImplementation((_id, _signal, handlers) => {
      handlers.onText('사진 속 분위기에 어울리는 곡을 골랐어요.');
      return stream.promise;
    });
    render(<ChatbotPage />);
    await userEvent.click(screen.getByRole('button', { name: '사진 확인 완료 테스트' }));
    expect(screen.queryByText('어울리는 음악을 찾고 있어요…')).not.toBeInTheDocument();
    expect(screen.getByText('사진 속 분위기에 어울리는 곡을 골랐어요.')).toBeInTheDocument();
    await act(async () => stream.resolve(result));
    const response = screen.getByRole('region', { name: '추천 음악 3곡' });
    expect(response).toHaveTextContent('사진 속 분위기에 어울리는 곡을 골랐어요.');
    expect(within(response).getAllByRole('listitem')).toHaveLength(3);
    expect(recommend).not.toHaveBeenCalled();
  });
});
