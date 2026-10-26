import './monitoring/sentry';
import * as Sentry from '@sentry/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <aside className="desktop-intro" aria-label="머문음 소개">
      <div className="desktop-intro__brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>머문음</span>
      </div>
      <div className="desktop-intro__content">
        <p className="desktop-intro__eyebrow">장소와 음악 사이</p>
        <h2 className="desktop-intro__headline">
          <span>머문 자리에,</span>
          <span>
            <em>음악</em>이 남는다.
          </span>
        </h2>
        <p className="desktop-intro__description">
          지금의 분위기에 어울리는 음악을 찾고,
          <br />
          좋았던 순간은 한 곡과 함께 남겨보세요.
        </p>
        <div className="desktop-intro__note" aria-hidden="true">
          <div className="desktop-intro__record">
            <span className="vinyl-disc desktop-intro__disc" />
            <div className="desktop-intro__sleeve">
              <span className="brand-mark" />
              <span className="desktop-intro__sleeve-label">MEOMUNEUM</span>
            </div>
          </div>
          <p>
            한 곡을 들으면
            <br />
            <span>다시 떠오를 오늘.</span>
          </p>
        </div>
      </div>
      <p className="desktop-intro__footer">
        <span>MEOMUNEUM</span>
        <span>MUSIC IN PLACE</span>
      </p>
    </aside>
    <App />
  </StrictMode>,
);
