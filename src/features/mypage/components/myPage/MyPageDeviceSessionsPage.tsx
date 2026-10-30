import { useEffect, useRef, useState } from 'react';

import { getMyAuthSessions, type AuthDeviceSession } from '../../api/mypageApi';
import { MyPageDeviceSessionsSkeleton } from '../../../../components/RouteLoadSkeleton';
import { useDelayedPending } from '../../../../hooks/useDelayedPending';
import { MyPageHeader } from './MyPageHeader';

export function DeviceSessionsPage({ back }: { back: () => void }) {
  const [sessions, setSessions] = useState<AuthDeviceSession[] | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [requestId, setRequestId] = useState(0);
  const requestGeneration = useRef(0);
  const isSkeletonVisible = useDelayedPending(isLoading, requestId);
  useEffect(() => {
    const current = ++requestGeneration.current;
    setRequestId(current);
    setIsLoading(true);
    let active = true;
    void getMyAuthSessions()
      .then((result) => {
        if (active && current === requestGeneration.current) setSessions(result);
      })
      .catch(() => {
        if (active && current === requestGeneration.current)
          setError('로그인된 기기 목록을 불러오지 못했어요.');
      })
      .finally(() => {
        if (active && current === requestGeneration.current) setIsLoading(false);
      });
    return () => {
      active = false;
      requestGeneration.current += 1;
    };
  }, []);

  const formatSessionDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '확인할 수 없음' : date.toLocaleString('ko-KR');
  };

  return (
    <>
      <MyPageHeader title="로그인된 기기" onBack={back} />
      <section className="mypage-page-content mypage-device-sessions" aria-busy={isLoading}>
        <p>현재 계정으로 로그인된 기기별 세션이에요.</p>
        {error ? (
          <p role="alert">{error}</p>
        ) : isSkeletonVisible && sessions === null ? (
          <MyPageDeviceSessionsSkeleton />
        ) : sessions === null ? null : sessions.length === 0 ? (
          <p>활성화된 기기 세션이 없어요.</p>
        ) : (
          <ul>
            {sessions.map((session) => (
              <li key={session.sid}>
                <strong>
                  {session.device_label || '알 수 없는 기기'}
                  {session.current && <span> · 현재 기기</span>}
                </strong>
                <small>로그인: {formatSessionDate(session.created_at)}</small>
                <small>최근 활동: {formatSessionDate(session.last_refreshed_at)}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
