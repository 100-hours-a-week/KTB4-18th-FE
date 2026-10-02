import { useCallback, useEffect, useRef, useState } from 'react';

export function useMusicPreview() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<string | null>(null);
  const requestRef = useRef(0);
  const [activeTrack, setActiveTrack] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const release = useCallback(() => {
    requestRef.current += 1;
    const audio = audioRef.current;
    audioRef.current = null;
    trackRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.ontimeupdate = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
  }, []);

  const stop = useCallback(() => {
    release();
    setActiveTrack(null);
    setIsPlaying(false);
    setIsLoading(false);
    setError('');
  }, [release]);

  useEffect(() => release, [release]);

  const toggle = async (track: string, url: string) => {
    setError('');
    if (trackRef.current === track && audioRef.current && (isPlaying || isLoading)) {
      requestRef.current += 1;
      audioRef.current.pause();
      setIsPlaying(false);
      setIsLoading(false);
      return;
    }

    if (trackRef.current !== track || !audioRef.current) {
      release();
      const audio = new Audio(url);
      audioRef.current = audio;
      trackRef.current = track;
      audio.onended = () => {
        if (audioRef.current === audio) stop();
      };
      audio.ontimeupdate = () => {
        if (audioRef.current === audio && audio.currentTime >= 30) stop();
      };
      audio.onerror = () => {
        if (audioRef.current !== audio) return;
        stop();
        setError('미리 듣기를 재생하지 못했습니다. 다시 시도해 주세요.');
      };
    }

    const audio = audioRef.current;
    const request = ++requestRef.current;
    setActiveTrack(track);
    setIsLoading(true);
    setIsPlaying(false);
    try {
      await audio.play();
      if (request !== requestRef.current || audioRef.current !== audio) return;
      setIsLoading(false);
      setIsPlaying(true);
    } catch {
      if (request !== requestRef.current || audioRef.current !== audio) return;
      stop();
      setError('미리 듣기를 재생하지 못했습니다. 다시 시도해 주세요.');
    }
  };

  return { activeTrack, isPlaying, isLoading, error, toggle, stop };
}
