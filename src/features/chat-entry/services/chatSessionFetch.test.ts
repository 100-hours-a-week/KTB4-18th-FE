import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthRequestError,
  authenticatedFetchWithCurrentToken,
} from '../../auth-login/api/authSession';
import { chatSessionFetch } from './chatSessionFetch';

const auth = vi.hoisted(() => ({ token: '' }));
vi.mock('../../auth-login/api/authSession', async (original) => ({
  ...(await original<typeof import('../../auth-login/api/authSession')>()),
  getAccessToken: () => auth.token,
  authenticatedFetchWithCurrentToken: vi.fn(),
}));
const sid = '550e8400-e29b-41d4-a716-446655440000';
const token = (session = sid, revision = 1) =>
  `header.${btoa(JSON.stringify({ sub: '7', sid: session, jti: revision }))}.signature`;

beforeEach(() => {
  vi.resetAllMocks();
  auth.token = token();
});

describe('지역 이동 요청의 인증 세션 고정', () => {
  it('다른 sid로 바뀌면 같은 계정이어도 요청하지 않는다', async () => {
    const owner = auth.token;
    auth.token = token('550e8400-e29b-41d4-a716-446655440001');
    await expect(chatSessionFetch('/entry', { method: 'POST' }, owner)).rejects.toBeInstanceOf(
      AuthRequestError,
    );
    expect(authenticatedFetchWithCurrentToken).not.toHaveBeenCalled();
  });

  it('같은 sid로 갱신된 최신 토큰을 사용한다', async () => {
    const owner = auth.token;
    auth.token = token(sid, 2);
    const response = new Response(null, { status: 204 });
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValue(response);
    expect(await chatSessionFetch('/entry', { method: 'POST' }, owner)).toBe(response);
    expect(authenticatedFetchWithCurrentToken).toHaveBeenCalledWith(
      '/entry',
      { method: 'POST' },
      auth.token,
    );
  });

  it('전송 전 토큰 갱신 경합만 새 토큰으로 한 번 재시도한다', async () => {
    const owner = auth.token;
    vi.mocked(authenticatedFetchWithCurrentToken)
      .mockImplementationOnce(async () => {
        auth.token = token(sid, 2);
        throw new AuthRequestError(null, false);
      })
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await chatSessionFetch('/entry', { method: 'POST' }, owner);
    expect(authenticatedFetchWithCurrentToken).toHaveBeenCalledTimes(2);
  });

  it('이미 전송된 입장은 토큰이 갱신되어도 재전송하지 않는다', async () => {
    const owner = auth.token;
    vi.mocked(authenticatedFetchWithCurrentToken).mockImplementationOnce(async () => {
      auth.token = token(sid, 2);
      throw new AuthRequestError(null, true);
    });
    await expect(chatSessionFetch('/entry', { method: 'POST' }, owner)).rejects.toBeInstanceOf(
      AuthRequestError,
    );
    expect(authenticatedFetchWithCurrentToken).toHaveBeenCalledOnce();
  });
});
