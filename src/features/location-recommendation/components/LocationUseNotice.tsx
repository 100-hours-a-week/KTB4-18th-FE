import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './locationUseNotice.css';

type LocationUseNoticeProps = {
  onAcknowledge: () => void;
  onDismiss: () => void;
};

export function LocationUseNotice({ onAcknowledge, onDismiss }: LocationUseNoticeProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const acknowledgeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const appRoot = document.getElementById('root');
    if (appRoot) appRoot.inert = true;
    acknowledgeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)');
      if (!controls?.length) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (appRoot) appRoot.inert = false;
      if (previousFocus instanceof HTMLElement) requestAnimationFrame(() => previousFocus.focus());
    };
  }, [onDismiss]);

  return createPortal(
    <div className="location-notice-backdrop">
      <section
        ref={dialogRef}
        className="location-notice"
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-notice-title"
        aria-describedby="location-notice-description"
        tabIndex={-1}
      >
        <p className="location-notice__eyebrow">위치 정보 안내</p>
        <h2 id="location-notice-title">음악 추천에 위치를 사용해요</h2>
        <div id="location-notice-description" className="location-notice__copy">
          <p>
            현재 안내(v4)에 동의한 뒤 서비스에 접속하면 위치를 한 번 확인해요. 다른 브라우저 탭을
            보다가 서비스 탭으로 돌아오거나 브라우저를 나갔다가 다시 접속할 때도 확인해요.
          </p>
          <p>
            기록이 없는 동네의 음악을 추천하기 위해 좌표를 머문음 백엔드에 일시 전송해요. 백엔드는
            시군구 확인을 위해 카카오 로컬, 추천을 위해 AI 서버에 좌표를 전달하고, AI 서버는 주변
            장소를 카카오에서, 날씨와 고도를 Open-Meteo에서 확인해요.
          </p>
          <p>
            머문음 백엔드와 AI 서버는 정확한 좌표를 저장하거나 로그에 남기지 않도록 설계했어요. 외부
            제공자의 자체 처리와 보관은 보장할 수 없으며 각 제공자의 정책을 따라요.
          </p>
        </div>
        <div className="location-notice__actions">
          <button className="location-notice__secondary" type="button" onClick={onDismiss}>
            지금은 건너뛰기
          </button>
          <button
            ref={acknowledgeRef}
            className="location-notice__primary"
            type="button"
            onClick={onAcknowledge}
          >
            확인하고 계속하기
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
