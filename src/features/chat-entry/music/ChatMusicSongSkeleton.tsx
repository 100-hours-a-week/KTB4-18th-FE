export function ChatMusicSongSkeleton({
  count,
  variant = 'song',
}: {
  count: number;
  variant?: 'song' | 'queue' | 'video';
}) {
  return Array.from({ length: count }, (_, index) => (
    <li
      key={index}
      className={`chat-music-item chat-music-skeleton${variant === 'video' ? ' chat-music-video-item' : ''}`}
      data-variant={variant}
      aria-hidden="true"
    >
      {variant === 'queue' && <span className="chat-music-rank chat-music-skeleton-rank" />}
      <span className="chat-music-cover" />
      <div className="chat-music-item-text">
        <span className="chat-music-skeleton-title" />
        <span className="chat-music-skeleton-artist" />
        <span className="chat-music-skeleton-badge" />
      </div>
      <span className="chat-music-skeleton-action">
        {variant === 'song' ? '영상 선택' : variant === 'queue' ? '취소' : '신청'}
      </span>
    </li>
  ));
}
