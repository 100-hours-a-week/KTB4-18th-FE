export function chatMusicEnabled() {
  return import.meta.env.VITE_CHAT_MUSIC_QUEUE_ENABLED === 'true';
}
export function musicCommand(text: string): string | null {
  const match = text.trim().match(/^\/신청(?:\s+([\s\S]*))?$/u);
  return match ? (match[1] ?? '').trim().replace(/\s+/g, ' ') : null;
}

export const chatMusicPlayerEnabled = () =>
  chatMusicEnabled() && import.meta.env.VITE_CHAT_MUSIC_PLAYER_ENABLED === 'true';
