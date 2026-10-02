import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Recommendation } from '../types/recommendation';

function MarqueeText({ text, className }: { text: string; className: string }) {
  const viewportRef = useRef<HTMLSpanElement | null>(null);
  const trackRef = useRef<HTMLSpanElement | null>(null);
  const [overflowDistance, setOverflowDistance] = useState(0);
  const [startedKey, setStartedKey] = useState('');

  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    let disposed = false;
    const measure = () => {
      if (disposed) return;
      setOverflowDistance(Math.max(0, track.scrollWidth - viewport.clientWidth));
    };

    measure();

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resizeObserver?.observe(viewport);
    resizeObserver?.observe(track);

    const fonts = document.fonts;
    const onFontsLoaded = () => measure();
    fonts?.addEventListener('loadingdone', onFontsLoaded);
    void fonts?.ready.then(measure);

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      fonts?.removeEventListener('loadingdone', onFontsLoaded);
    };
  }, [text]);

  const measurementKey = `${text}\u0000${overflowDistance}`;
  const isMoving = startedKey === measurementKey;

  useEffect(() => {
    if (overflowDistance <= 0) return;

    const timer = window.setTimeout(() => setStartedKey(measurementKey), 900);
    return () => window.clearTimeout(timer);
  }, [measurementKey, overflowDistance]);

  const duration = Math.max(5, overflowDistance / 30 + 2);
  const style = {
    '--marquee-distance': `${overflowDistance}px`,
    '--marquee-duration': `${duration}s`,
  } as CSSProperties;

  return (
    <span
      ref={viewportRef}
      className={`music-text-viewport ${className}${overflowDistance > 0 ? ' has-overflow' : ''}${isMoving ? ' is-moving' : ''}`}
      aria-label={text}
    >
      <span ref={trackRef} className="music-text-track" style={style}>
        {text}
      </span>
    </span>
  );
}

interface Props {
  recommendation: Recommendation;
  activePreview: string | null;
  onPreviewChange: (key: string | null) => void;
}

export function RecommendationCards({ recommendation, activePreview, onPreviewChange }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.ontimeupdate = null;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        if (audioRef.current === audio) audioRef.current = null;
      }
    };
  }, [activePreview]);

  async function play(key: string, url: string) {
    setError('');
    if (activePreview === key) {
      onPreviewChange(null);
      return;
    }
    onPreviewChange(key);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.ontimeupdate = () => {
      if (audio.currentTime >= 30) {
        audio.pause();
        onPreviewChange(null);
      }
    };
    audio.onended = () => onPreviewChange(null);
    audio.onerror = () => {
      setError('미리 듣기 음원을 재생할 수 없습니다.');
      onPreviewChange(null);
    };
    try {
      await audio.play();
    } catch {
      if (audioRef.current === audio) {
        setError('미리 듣기를 시작하지 못했습니다. 다시 눌러 주세요.');
        onPreviewChange(null);
      }
    }
  }

  if (recommendation.items.length === 0) {
    return (
      <section className="recommendation-bubble" aria-label="추천 음악 없음">
        <p className="recommendation-intro">조건에 맞는 추천곡을 찾지 못했어요.</p>
        <p className="sample-notice">다른 분위기나 상황으로 다시 요청해 주세요.</p>
      </section>
    );
  }

  return (
    <section
      className="recommendation-bubble"
      aria-label={`추천 음악 ${recommendation.items.length}곡`}
    >
      <p className="recommendation-intro">
        {recommendation.items.length < 5
          ? `추천곡 ${recommendation.items.length}곡을 준비했어요.`
          : '이런 곡은 어떠세요?'}
      </p>
      <ol className="music-list">
        {recommendation.items.map(({ rank_no, music }) => {
          const key = `${recommendation.recommendation_id}-${rank_no}`;
          return (
            <li className="music-card" key={key}>
              <div className="music-info">
                <img
                  src={music.album_cover_url ?? '/album-placeholder.svg'}
                  alt={`${music.title} 앨범 커버`}
                  onError={(event) => {
                    event.currentTarget.onerror = null;
                    event.currentTarget.src = '/album-placeholder.svg';
                  }}
                />
                <div className="music-copy">
                  <h2>
                    <MarqueeText text={music.title} className="music-title-text" />
                  </h2>
                  <p>
                    <MarqueeText text={music.artist_name} className="music-artist-text" />
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="preview-button"
                disabled={!music.preview_url}
                aria-pressed={activePreview === key}
                aria-label={`${music.title} ${activePreview === key ? '미리 듣기 중지' : '30초 미리 듣기'}`}
                onClick={() => {
                  if (music.preview_url) void play(key, music.preview_url);
                }}
              >
                <img
                  src={
                    activePreview === key
                      ? '/icons/chatbot/Play-stop.svg'
                      : '/icons/chatbot/Playbutton.svg'
                  }
                  alt=""
                  aria-hidden="true"
                  width="16"
                  height="16"
                />
              </button>
            </li>
          );
        })}
      </ol>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <a
        className="itunes-link"
        href="https://www.apple.com/itunes/"
        target="_blank"
        rel="noreferrer"
      >
        음원·앨범 이미지 제공: iTunes
      </a>
    </section>
  );
}
