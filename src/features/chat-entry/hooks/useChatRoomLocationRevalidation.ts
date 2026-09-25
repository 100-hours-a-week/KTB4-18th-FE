import { useEffect, useRef, useState } from 'react';

import { ChatRoomRequestError, getRegionChatRoom, joinChatRoom } from '../../../api/chatRooms';
import type { ActiveChatRoom } from '../components/ChatEntryPage';
import { resolveCurrentChatLocation } from '../services/resolveCurrentChatLocation';

const REVALIDATION_INTERVAL_MS = 10 * 60 * 1_000;
const BOUNDARY_CONFIRMATION_DELAY_MS = 15_000;

export type RevalidationStatus =
  | 'idle'
  | 'checking'
  | 'stable'
  | 'confirming'
  | 'moving'
  | 'moved'
  | 'mismatch'
  | 'roomFull'
  | 'error';

interface UseChatRoomLocationRevalidationOptions {
  accessToken: string | null;
  activeChatRoom: ActiveChatRoom | null;
  onMoved: (activeChatRoom: ActiveChatRoom) => void;
  onMembershipEnded: () => void;
}

function waitForConfirmation(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const timerId = window.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, BOUNDARY_CONFIRMATION_DELAY_MS);
    const handleAbort = () => {
      window.clearTimeout(timerId);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

export function useChatRoomLocationRevalidation({
  accessToken,
  activeChatRoom,
  onMoved,
  onMembershipEnded,
}: UseChatRoomLocationRevalidationOptions) {
  const [status, setStatus] = useState<RevalidationStatus>('idle');
  const [message, setMessage] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const isCheckingRef = useRef(false);
  const onMovedRef = useRef(onMoved);
  const onMembershipEndedRef = useRef(onMembershipEnded);

  useEffect(() => {
    onMovedRef.current = onMoved;
  }, [onMoved]);

  useEffect(() => {
    onMembershipEndedRef.current = onMembershipEnded;
  }, [onMembershipEnded]);

  useEffect(() => {
    if (!accessToken || !activeChatRoom) {
      return;
    }

    let isMounted = true;
    const revalidate = async () => {
      if (isCheckingRef.current) {
        return;
      }
      isCheckingRef.current = true;
      const controller = new AbortController();
      requestRef.current = controller;
      setStatus('checking');
      setMessage('현재 지역을 다시 확인하고 있어요.');

      try {
        const candidate = await resolveCurrentChatLocation(accessToken, controller.signal);
        if (candidate.region.sigungu.regionId === activeChatRoom.room.regionId) {
          if (isMounted) {
            setStatus('stable');
            setMessage('현재 지역 채팅방을 유지합니다.');
          }
          return;
        }

        if (isMounted) {
          setStatus('confirming');
          setMessage('지역 이동 여부를 15초 후 한 번 더 확인합니다.');
        }
        await waitForConfirmation(controller.signal);
        const confirmation = await resolveCurrentChatLocation(accessToken, controller.signal);
        if (confirmation.region.sigungu.regionId !== candidate.region.sigungu.regionId) {
          if (isMounted) {
            setStatus('mismatch');
            setMessage('행정구역 경계로 판단되어 기존 채팅방을 유지합니다.');
          }
          return;
        }

        if (isMounted) {
          setStatus('moving');
          setMessage('새 지역 채팅방으로 이동하고 있어요.');
        }
        const room = await getRegionChatRoom(
          confirmation.region.sigungu.regionId,
          accessToken,
          controller.signal,
        );
        const membership = await joinChatRoom(
          room.roomId,
          confirmation.locationResolutionToken,
          accessToken,
          controller.signal,
        );
        if (!isMounted || controller.signal.aborted) {
          return;
        }
        onMovedRef.current({ room, membership });
        setStatus('moved');
        setMessage(`${room.regionName} 채팅방으로 이동했어요.`);
      } catch (caught) {
        if (!isMounted || controller.signal.aborted) {
          return;
        }
        if (caught instanceof ChatRoomRequestError && caught.status === 409) {
          onMembershipEndedRef.current();
          setStatus('roomFull');
          setMessage('새 지역 채팅방의 정원이 가득 찼습니다. 기존 채팅방에서도 퇴장되었어요.');
          return;
        }
        setStatus('error');
        setMessage(
          caught instanceof Error
            ? caught.message
            : '현재 지역을 다시 확인하지 못했습니다. 다음 확인 때 다시 시도합니다.',
        );
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
        }
        isCheckingRef.current = false;
      }
    };

    const intervalId = window.setInterval(() => void revalidate(), REVALIDATION_INTERVAL_MS);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      requestRef.current?.abort();
      requestRef.current = null;
      isCheckingRef.current = false;
    };
  }, [accessToken, activeChatRoom]);

  return {
    status,
    message,
    isChecking: status === 'checking' || status === 'confirming' || status === 'moving',
  };
}
