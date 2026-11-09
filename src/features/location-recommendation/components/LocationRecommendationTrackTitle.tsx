import { useEffect, useRef, useState, type CSSProperties } from 'react';

type LocationRecommendationTrackTitleProps = {
  title: string;
};

export function LocationRecommendationTrackTitle({ title }: LocationRecommendationTrackTitleProps) {
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
    <p className="location-recommendation-carousel__title" ref={viewportRef} title={title}>
      <span
        className={`location-recommendation-carousel__title-track${overflowDistance > 0 ? ' location-recommendation-carousel__title-track--moving' : ''}`}
        ref={trackRef}
        style={style}
      >
        {title}
      </span>
    </p>
  );
}
