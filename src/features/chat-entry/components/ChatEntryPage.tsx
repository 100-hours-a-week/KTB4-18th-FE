import { ActionButton } from '@seed-design/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getRegionChatRoom,
  joinChatRoom,
  type ChatRoomMembership,
  type ChatRoomSummary,
} from '../../../api/chatRooms';
import { useChatLocation } from '../../../hooks/useChatLocation';
import { useChatRoomLocationRevalidation } from '../hooks/useChatRoomLocationRevalidation';

export interface ActiveChatRoom {
  room: ChatRoomSummary;
  membership: ChatRoomMembership;
}

interface ChatEntryPageProps {
  accessToken: string | null;
  activeChatRoom: ActiveChatRoom | null;
  onEntered: (activeChatRoom: ActiveChatRoom) => void;
  onMembershipEnded: () => void;
  onLogin: () => void;
}

type EntryPhase = 'locating' | 'findingRoom' | 'joining' | 'joined' | 'error';

function locationStatusMessage(
  status: ReturnType<typeof useChatLocation>['status'],
  attempt: number,
) {
  switch (status) {
    case 'requestingPermission':
      return '현재 위치를 확인하고 있어요.';
    case 'retrying':
      return `위치 정확도를 다시 확인하고 있어요. (${attempt}/3)`;
    case 'resolving':
      return '현재 행정구역을 확인하고 있어요.';
    default:
      return '채팅방 입장을 준비하고 있어요.';
  }
}

export function ChatEntryPage({
  accessToken,
  activeChatRoom,
  onEntered,
  onMembershipEnded,
  onLogin,
}: ChatEntryPageProps) {
  const location = useChatLocation({ accessToken });
  const requestLocation = location.requestLocation;
  const retryLocation = location.retryLocation;
  const [phase, setPhase] = useState<EntryPhase>(activeChatRoom ? 'joined' : 'locating');
  const [entryError, setEntryError] = useState('');
  const handledTokenRef = useRef<string | null>(null);
  const entryRequestRef = useRef<AbortController | null>(null);
  const membershipEndedRef = useRef(false);
  const handleMembershipEnded = useCallback(() => {
    membershipEndedRef.current = true;
    onMembershipEnded();
  }, [onMembershipEnded]);
  const revalidation = useChatRoomLocationRevalidation({
    accessToken,
    activeChatRoom,
    onMoved: onEntered,
    onMembershipEnded: handleMembershipEnded,
  });

  useEffect(() => {
    if (!activeChatRoom && !membershipEndedRef.current) {
      void requestLocation();
    }
  }, [activeChatRoom, requestLocation]);

  useEffect(() => {
    const resolution = location.resolution;
    if (
      !accessToken ||
      !resolution ||
      handledTokenRef.current === resolution.locationResolutionToken
    ) {
      return;
    }

    handledTokenRef.current = resolution.locationResolutionToken;
    const controller = new AbortController();
    entryRequestRef.current?.abort();
    entryRequestRef.current = controller;
    setEntryError('');

    const enterCurrentRoom = async () => {
      try {
        setPhase('findingRoom');
        const room = await getRegionChatRoom(
          resolution.region.sigungu.regionId,
          accessToken,
          controller.signal,
        );
        setPhase('joining');
        const membership = await joinChatRoom(
          room.roomId,
          resolution.locationResolutionToken,
          accessToken,
          controller.signal,
        );
        if (controller.signal.aborted) {
          return;
        }
        const nextActiveRoom = { room, membership };
        onEntered(nextActiveRoom);
        setPhase('joined');
      } catch (caught) {
        if (controller.signal.aborted) {
          return;
        }
        setPhase('error');
        setEntryError(caught instanceof Error ? caught.message : '채팅방에 입장하지 못했습니다.');
      } finally {
        if (entryRequestRef.current === controller) {
          entryRequestRef.current = null;
        }
      }
    };

    void enterCurrentRoom();
    return () => controller.abort();
  }, [accessToken, location.resolution, onEntered]);

  useEffect(() => () => entryRequestRef.current?.abort(), []);

  const retryEntry = useCallback(() => {
    membershipEndedRef.current = false;
    handledTokenRef.current = null;
    setPhase('locating');
    setEntryError('');
    void retryLocation();
  }, [retryLocation]);

  const displayedRoom = activeChatRoom;
  const error =
    entryError ||
    location.error ||
    (revalidation.status === 'roomFull' ? revalidation.message : '');
  const isAuthenticationError =
    !accessToken || (entryError && entryError.includes('로그인이 만료'));

  return (
    <main className="chat-entry-screen">
      <section className="chat-entry-card" aria-labelledby="chat-entry-title">
        <span className="chat-entry-icon" aria-hidden="true">
          💬
        </span>
        <h1 id="chat-entry-title" className="text-title1-bold">
          {displayedRoom ? `${displayedRoom.room.regionName} 채팅방` : '우리 지역 채팅방'}
        </h1>

        {displayedRoom && phase === 'joined' ? (
          <>
            <p className="chat-entry-description text-body1-normal-regular" role="status">
              현재 지역 채팅방에 입장했어요.
            </p>
            <p className="chat-entry-placeholder text-body2-normal-regular">
              메시지 목록과 실시간 연결은 다음 작업에서 제공됩니다.
            </p>
            {revalidation.message && (
              <p
                className="chat-entry-description text-body2-normal-regular"
                role={
                  revalidation.status === 'roomFull' || revalidation.status === 'error'
                    ? 'alert'
                    : 'status'
                }
              >
                {revalidation.message}
              </p>
            )}
          </>
        ) : error || phase === 'error' ? (
          <div className="chat-entry-error" role="alert">
            <p>{error || '채팅방에 입장하지 못했습니다.'}</p>
            {isAuthenticationError ? (
              <ActionButton type="button" variant="brandSolid" size="large" onClick={onLogin}>
                로그인
              </ActionButton>
            ) : (
              <ActionButton type="button" variant="brandSolid" size="large" onClick={retryEntry}>
                다시 시도
              </ActionButton>
            )}
          </div>
        ) : (
          <p className="chat-entry-description text-body1-normal-regular" role="status">
            {phase === 'findingRoom'
              ? '현재 지역 채팅방을 찾고 있어요.'
              : phase === 'joining'
                ? '채팅방에 입장하고 있어요.'
                : locationStatusMessage(location.status, location.attempt)}
          </p>
        )}
      </section>
    </main>
  );
}
