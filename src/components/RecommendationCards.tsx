import { useEffect, useRef, useState } from 'react'
import type { Recommendation } from '../types/recommendation'

interface Props {
  recommendation: Recommendation
  activePreview: string | null
  onPreviewChange: (key: string | null) => void
}

export function RecommendationCards({ recommendation, activePreview, onPreviewChange }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const audio = audioRef.current
    return () => { if (audio) { audio.onended = null; audio.onerror = null; audio.ontimeupdate = null; audio.pause(); audio.removeAttribute('src'); audio.load(); if (audioRef.current === audio) audioRef.current = null } }
  }, [activePreview])

  async function play(key: string, url: string) {
    setError('')
    if (activePreview === key) { onPreviewChange(null); return }
    onPreviewChange(key)
    // effect가 이전 플레이어를 정리한 뒤 새 클릭에 의한 재생을 시작합니다.
    const audio = new Audio(url)
    audioRef.current = audio
    audio.ontimeupdate = () => {
      if (audio.currentTime >= 30) { audio.pause(); onPreviewChange(null) }
    }
    audio.onended = () => onPreviewChange(null)
    audio.onerror = () => { setError('미리 듣기 음원을 재생할 수 없습니다.'); onPreviewChange(null) }
    try { await audio.play() }
    catch { if (audioRef.current === audio) { setError('미리 듣기를 시작하지 못했습니다. 다시 눌러 주세요.'); onPreviewChange(null) } }
  }

  return <section className="recommendation-bubble" aria-label="추천 음악 5곡">
    <p className="recommendation-intro">이런 곡은 어떠세요?</p>
    <p className="sample-notice">개발용 샘플 추천 · 실제 AI 분석 결과가 아닙니다.</p>
    <ol className="music-list">
      {recommendation.items.map(({ rank_no, music }) => {
        const key = `${recommendation.recommendation_id}-${rank_no}`
        return <li className="music-card" key={key}>
          <div className="music-info">
            <img src={music.album_cover_url ?? '/album-placeholder.svg'} alt={`${music.title} 앨범 커버`}
              onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = '/album-placeholder.svg' }} />
            <div><h2>{music.title}</h2><p>{music.artist_name}</p></div>
          </div>
          <button type="button" className="preview-button" disabled={!music.preview_url}
            aria-pressed={activePreview === key}
            aria-label={`${music.title} ${activePreview === key ? '미리 듣기 중지' : '30초 미리 듣기'}`}
            onClick={() => { if (music.preview_url) void play(key, music.preview_url) }}>
            {!music.preview_url ? '미리 듣기 없음' : activePreview === key ? '중지' : '30초 미리 듣기'}
          </button>
        </li>
      })}
    </ol>
    {error && <p role="alert" className="error-message">{error}</p>}
    <a className="itunes-link" href="https://www.apple.com/itunes/" target="_blank" rel="noreferrer">음원·앨범 이미지 제공: iTunes</a>
  </section>
}
