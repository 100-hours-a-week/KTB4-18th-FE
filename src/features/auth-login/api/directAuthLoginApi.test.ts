import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitDirectLogin, recoverDirectLogin } from './directAuthLoginApi';
import { createDirectAuthOperation } from './directAuthOperationStore';
const flowId = '123e4567-e89b-42d3-a456-426614174000';
const operationId = '123e4567-e89b-42d3-a456-426614174001';
const tuple = { flowId, startingEpoch: '1', operationId };
const ok = () =>
  vi
    .fn()
    .mockResolvedValue(
      Response.json({ message: 'login success', data: { access_token: 'a', expires_in: '60' } }),
    ) as typeof fetch;
beforeEach(() => sessionStorage.clear());
describe('direct login API', () => {
  it('sends credentials once with the persisted login identity', async () => {
    const fetcher = ok();
    await submitDirectLogin(
      createDirectAuthOperation('LOGIN', flowId, '1', operationId),
      tuple,
      { email: 'a@b.com', password: 'secret' },
      'csrf',
      { fetcher },
    );
    const init = vi.mocked(fetcher).mock.calls[0][1]!;
    expect(new Headers(init.headers).get('X-Login-Operation-Id')).toBe(operationId);
    expect(init.body).toContain('secret');
    expect(sessionStorage.getItem('meomuneum:direct-auth-operation:LOGIN')).not.toContain('secret');
  });
  it('blocks a mutation before fetch when storage fails', async () => {
    const fetcher = ok();
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error();
      },
    } as unknown as Storage;
    await expect(
      submitDirectLogin(
        createDirectAuthOperation('LOGIN', flowId, '1', operationId),
        tuple,
        { email: 'a@b.com', password: 'secret' },
        'csrf',
        { fetcher, storage },
      ),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('posts login recovery without credentials', async () => {
    const fetcher = ok();
    await recoverDirectLogin(
      createDirectAuthOperation('LOGIN_RECOVERY', flowId, '1', operationId),
      tuple,
      'csrf',
      { fetcher },
    );
    expect(vi.mocked(fetcher).mock.calls[0][0]).toContain(
      `/login/operations/${operationId}/session-recovery`,
    );
    expect(vi.mocked(fetcher).mock.calls[0][1]!.body).toBeUndefined();
  });
});
