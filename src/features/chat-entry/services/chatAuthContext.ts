export interface ChatAuthContext {
  userId: string;
  sessionId: string;
}

// Local ownership guard only. The server verifies the JWT and derives the actual identity.
export function chatAuthContext(token: string | null): ChatAuthContext | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (
      typeof claims.sub !== 'string' ||
      !/^[1-9]\d*$/.test(claims.sub) ||
      typeof claims.sid !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(claims.sid)
    )
      return null;
    return { userId: claims.sub, sessionId: claims.sid };
  } catch {
    return null;
  }
}

export function sameChatAuthContext(
  left: ChatAuthContext | null,
  right: ChatAuthContext | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.userId === right.userId &&
    left.sessionId === right.sessionId
  );
}
