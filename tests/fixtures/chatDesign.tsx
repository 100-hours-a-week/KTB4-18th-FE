import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ChatRoomScreen } from '../../src/features/chat-entry/components/ChatEntryPage';
import type { ChatParticipationState } from '../../src/features/chat-entry/services/chatParticipation';
import type { ChatMessage } from '../../src/features/chat-entry/services/chatMessages';
import '../../src/index.css';
import '../../src/App.css';

type Story = 'web' | 'mobile';
type Action = { type: string; content?: string; clientMessageId?: string };

interface ChatDesignControl {
  setState: (patch: Partial<ChatParticipationState>) => void;
  reset: (story?: Story) => void;
  appendMessage: (patch?: Partial<ChatMessage>) => void;
  setSendResult: (result: boolean) => void;
  getState: () => ChatParticipationState;
  actions: Action[];
}

declare global {
  interface Window {
    chatDesign: ChatDesignControl;
  }
}

const params = new URLSearchParams(window.location.search);
const initialStory: Story = params.get('story') === 'mobile' ? 'mobile' : 'web';
const count = params.get('count');
const capacity = params.get('capacity');
const content =
  '지금의 순간에 음악을 더해볼까요?\n느껴지는 분위기나 장소, 날씨를 편하게 들려주세요.\n이 순간에 어울리는 음악을 골라드릴게요.';
const actions: Action[] = [];
let shouldSend = true;

function referenceState(story: Story): ChatParticipationState {
  const authors = story === 'web' ? [8, 7, 8, 9, 7, 7] : [8, 7, 8, 7, 7];
  return {
    status: 'ready',
    message: '채팅방에 입장했어요.',
    isReady: true,
    currentUserId: 7,
    presenceStatus: 'live',
    connectedCount: count === null ? 1 : Number(count),
    activeRoom: {
      room: {
        roomId: 700,
        regionId: 25,
        regionName: params.get('region') || '성남시',
        capacity: capacity === null ? 1000 : Number(capacity),
        status: 'ACTIVE',
      },
      membership: {
        membershipId: 900,
        roomId: 700,
        regionId: 25,
        joinedAt: '2026-10-01T07:30:00Z',
        viewSessionId: '11111111-1111-4111-8111-111111111111',
      },
    },
    messages: authors.map((userId, index) => ({
      messageId: index + 1,
      clientMessageId: `reference-${index + 1}`,
      roomId: 700,
      userId,
      nickname: userId === 7 ? '나' : '이웃',
      content: userId === 7 ? '노래 추천해줘.' : content,
      createdAt: `2026-10-01T07:${userId === 7 ? '38' : '37'}:00Z`,
    })),
    pendingMessages: [],
    gaps: [],
  };
}

function scenarioState(): ChatParticipationState {
  const state = referenceState(initialStory);
  const scenario = params.get('scenario') || 'reference';
  const statusMessages: Partial<Record<ChatParticipationState['status'], string>> = {
    locating: '현재 위치를 확인하고 있어요. 위치 권한을 허용해 주세요.',
    joining: '현재 지역 채팅방에 입장하고 있어요.',
    connecting: '채팅방에 연결하고 있어요.',
    reconnecting: '채팅방에 다시 연결하고 있어요.',
    recovering: '이전 대화를 복구하고 있어요.',
    'recovery-failed': '메시지를 복구하지 못했어요.',
    error: '채팅방에 입장하지 못했습니다. 다시 시도해 주세요.',
    full: '정원이 가득 찼습니다.',
    left: '채팅방에서 퇴장했어요.',
    banned: '채팅 이용이 제한되었습니다.',
  };
  const status = scenario as ChatParticipationState['status'];
  if (statusMessages[status]) {
    state.status = status;
    state.isReady = false;
    state.message = statusMessages[status]!;
  }
  if (scenario === 'consecutive-user-1') {
    state.messages = [1, 2, 3, 4, 5].map((messageId) => ({
      ...state.messages![0],
      messageId,
      clientMessageId: `user-1-${messageId}`,
      userId: 1,
      nickname: '사용자 1',
      content: `사용자 1의 연속 메시지 ${messageId}`,
      createdAt: '2026-10-01T07:37:00Z',
    }));
  }
  if (scenario === 'interrupted-user-1-six') {
    const messages = [
      { userId: 1, nickname: '사용자 1', content: '사용자 1 메시지 1' },
      { userId: 1, nickname: '사용자 1', content: '사용자 1 메시지 2' },
      { userId: 1, nickname: '사용자 1', content: '사용자 1 메시지 3' },
      { userId: 2, nickname: '사용자 2', content: '사용자 2의 중간 메시지' },
      { userId: 1, nickname: '사용자 1', content: '사용자 1 메시지 4' },
      { userId: 1, nickname: '사용자 1', content: '사용자 1 메시지 5' },
      { userId: 1, nickname: '사용자 1', content: '사용자 1 메시지 6' },
    ];
    state.messages = messages.map((message, index) => ({
      ...state.messages![0],
      ...message,
      messageId: index + 1,
      clientMessageId: `interrupted-${index + 1}`,
      createdAt: '2026-10-01T07:37:00Z',
    }));
  }
  if (scenario === 'boundaries') {
    state.messages = [
      ...[1, 2, 3].map((messageId) => ({
        ...state.messages![0],
        messageId,
        clientMessageId: `boundary-${messageId}`,
        content: `연속 대화 ${messageId}`,
        createdAt: `2026-10-01T07:${messageId === 3 ? '38' : '37'}:10Z`,
      })),
      {
        ...state.messages![0],
        messageId: 5,
        clientMessageId: 'boundary-5',
        content: '다음 날짜의 대화',
        createdAt: '2026-10-02T07:38:00Z',
      },
    ];
    state.restoredThroughMessageId = 2;
    state.gaps = [
      { reason: 'ABSENCE', beforeMessageId: 3, resumedAt: '2026-10-02T07:37:00Z' },
      { reason: 'RETENTION', beforeMessageId: 5, resumedAt: '2026-10-02T07:38:10Z' },
    ];
  }
  if (scenario === 'pending') {
    state.pendingMessages = [
      { clientMessageId: 'sending', content: '전송 중인 대화', status: 'sending', notice: '' },
      {
        clientMessageId: 'uncertain',
        content: '결과를 기다리는 대화',
        status: 'uncertain',
        notice: '전송 결과를 확인하지 못했어요. 재전송할 수 있어요.',
      },
      {
        clientMessageId: 'rejected',
        content: '거절된 대화',
        status: 'rejected',
        notice: '메시지를 보내지 못했어요. 새 메시지로 다시 작성해 주세요.',
      },
    ];
  }
  if (scenario === 'long') {
    state.messages = [
      { ...state.messages![0], content: '가'.repeat(300) },
      { ...state.messages![1], content: 'W'.repeat(300) },
      { ...state.messages![2], content: '🙂'.repeat(150) },
      { ...state.messages![3], content: '명시적인\n여러 줄\n대화입니다.' },
    ];
  }
  const presence = params.get('presence');
  if (['live', 'loading', 'error', 'disconnected'].includes(presence ?? '')) {
    state.presenceStatus = presence as ChatParticipationState['presenceStatus'];
    if (presence !== 'live' && count === null) state.connectedCount = null;
  }
  return state;
}

export function ChatDesignFixture() {
  const [state, setState] = useState(scenarioState);
  useEffect(() => {
    window.chatDesign = {
      setState: (patch) => setState((current) => ({ ...current, ...patch })),
      reset: (story = initialStory) => {
        actions.length = 0;
        shouldSend = true;
        setState(referenceState(story));
      },
      appendMessage: (patch = {}) =>
        setState((current) => {
          const messageId = (current.messages?.at(-1)?.messageId ?? 0) + 1;
          return {
            ...current,
            messages: [
              ...(current.messages ?? []),
              {
                messageId,
                clientMessageId: `appended-${messageId}`,
                roomId: 700,
                userId: 8,
                nickname: '새 이웃',
                content: '새로 도착한 메시지',
                createdAt: '2026-10-01T07:39:00Z',
                ...patch,
              },
            ],
          };
        }),
      setSendResult: (result) => {
        shouldSend = result;
      },
      getState: () => state,
      actions,
    };
  }, [state]);
  return (
    <ChatRoomScreen
      chat={{
        ...state,
        send: (value) => {
          actions.push({ type: 'send', content: value });
          return shouldSend;
        },
        retry: () => actions.push({ type: 'retry' }),
        retryRecovery: () => actions.push({ type: 'retryRecovery' }),
        retryMessage: (clientMessageId) => {
          actions.push({ type: 'retryMessage', clientMessageId });
          return state.isReady;
        },
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(<ChatDesignFixture />);
