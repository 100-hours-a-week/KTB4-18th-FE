import { useEffect, useRef, useState, type CSSProperties } from 'react';

import './scrollingTrackTitle.css';

type ScrollingTrackTitleProps = {
  title: string;
  className: string;
};

export function ScrollingTrackTitle({ title, className }: ScrollingTrackTitleProps) {
  const viewportRef = useRef<HTMLParagraphElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const [overflowDistance, setOverflowDistance] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    const measure = () => {
      const distance = track.getBoundingClientRect().width - viewport.getBoundingClientRect().width;
      setOverflowDistance(Math.max(0, distance));
    };

    measure();

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(viewport);
    observer?.observe(track);
    return () => observer?.disconnect();
  }, [title]);

  const style = {
    '--title-marquee-distance': `${overflowDistance}px`,
    '--title-marquee-duration': `${Math.max(5, overflowDistance / 30 + 2)}s`,
  } as CSSProperties;

  return (
    <p className={`scrolling-track-title ${className}`} ref={viewportRef} title={title}>
      <span
        className={`scrolling-track-title__track${overflowDistance > 0 ? ' scrolling-track-title__track--moving' : ''}`}
        ref={trackRef}
        style={style}
      >
        {title}
      </span>
    </p>
  );
}
