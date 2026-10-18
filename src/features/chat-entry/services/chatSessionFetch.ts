import {
  AuthRequestError,
  authenticatedFetchWithCurrentToken,
  getAccessToken,
} from '../../auth-login/api/authSession';
import { chatAuthContext, sameChatAuthContext } from './chatAuthContext';

// Mutations/location evidence must never be dispatched as a newly selected session.
export async function chatSessionFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  ownerToken: string,
): Promise<Response> {
  const owner = chatAuthContext(ownerToken);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = getAccessToken();
    if (!token || !sameChatAuthContext(owner, chatAuthContext(token)))
      throw new AuthRequestError(null);
    try {
      return await authenticatedFetchWithCurrentToken(input, init, token);
    } catch (error) {
      // A same-session rotation before dispatch is safe to retry once; sent mutations are not replayed.
      if (
        attempt === 0 &&
        error instanceof AuthRequestError &&
        !error.requestWasSent &&
        getAccessToken() !== token &&
        sameChatAuthContext(owner, chatAuthContext(getAccessToken()))
      )
        continue;
      throw error;
    }
  }
  throw new AuthRequestError(null);
}
