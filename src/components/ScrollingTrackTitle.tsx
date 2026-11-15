import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
} from 'react';

import './scrollingTrackTitle.css';

type ScrollingTrackTitleProps = ComponentPropsWithoutRef<'strong'> & {
  title: string;
  as?: 'p' | 'strong';
  fadeEdges?: boolean;
};

export function ScrollingTrackTitle({
  title,
  as: Tag = 'p',
  className = '',
  fadeEdges = true,
  ...attributes
}: ScrollingTrackTitleProps) {
  const viewportRef = useRef<HTMLElement>(null);
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
    <Tag
      {...attributes}
      className={`scrolling-track-title${fadeEdges ? ' scrolling-track-title--fade' : ''} ${className}`}
      ref={(element) => {
        viewportRef.current = element;
      }}
      title={title}
    >
      <span
        className={`scrolling-track-title__track${overflowDistance > 0 ? ' scrolling-track-title__track--moving' : ''}`}
        ref={trackRef}
        style={style}
      >
        {title}
      </span>
    </Tag>
  );
}
