import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '../../auth-login/api/authSession';
import { fetchChatRecovery, ChatRecoveryError } from './chatRecovery';
vi.mock('../../auth-login/api/authSession', () => ({
  authenticatedFetch: vi.fn(),
  AuthRequestError: class extends Error {},
}));
const membership = {
  roomId: 700,
  membershipId: 900,
  regionId: 25,
  joinedAt: '2026-10-13T00:00:00Z',
  viewSessionId: '11111111-1111-4111-8111-111111111111',
};
const body = {
  items: [
    {
      message_id: 1,
      client_message_id: 'id',
      room_id: 700,
      user_id: 7,
      nickname: 'user',
      content: '**',
      created_at: '2026-10-13T00:00:00Z',
    },
  ],
  next_cursor: null,
  has_next: false,
  snapshot_message_id: 1,
  gaps: [{ reason: 'ABSENCE', before_message_id: 0, resumed_at: '2026-10-13T00:00:00Z' }],
};
beforeEach(() => vi.resetAllMocks());
const load = () => fetchChatRecovery(membership, 'view', 'signed', new AbortController().signal);
describe('복구 API 응답과 권한 오류', () => {
  it('인증 fetch에 view 헤더·membership·recovery cursor를 전달하고 서버 본문을 변환한다', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'ok', data: body }), { status: 200 }),
    );
    const result = await load();
    expect(authenticatedFetch).toHaveBeenCalledWith(
      expect.stringContaining('membership_id=900&mode=recovery&cursor=signed'),
      expect.objectContaining({
        headers: { 'X-Chat-View-Session': 'view' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.items[0].content).toBe('**');
    expect(result.gaps[0].reason).toBe('ABSENCE');
  });
  it.each([
    { ...body, items: [{ ...body.items[0], room_id: 701 }] },
    { ...body, items: [{ ...body.items[0], message_id: 2 }] },
    { ...body, has_next: true, next_cursor: null },
    { ...body, gaps: [{ reason: 'UNKNOWN' }] },
    { ...body, snapshot_message_id: -1 },
  ])('잘못된 복구 결과는 화면 병합에 전달하지 않는다', async (data) => {
    vi.mocked(authenticatedFetch).mockResolvedValue(
      new Response(JSON.stringify({ data }), { status: 200 }),
    );
    await expect(load()).rejects.toBeInstanceOf(ChatRecoveryError);
  });
  it('제재 코드는 안전한 종료 시각과 함께 전달하고 원본 오류 내용을 표시하지 않는다', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'internal detail',
          data: { code: 'CHAT_ROOM_403_BANNED', banned_until: '2026-10-20T00:00:00Z' },
        }),
        { status: 403 },
      ),
    );
    await expect(load()).rejects.toMatchObject({
      status: 403,
      code: 'CHAT_ROOM_403_BANNED',
      bannedUntil: '2026-10-20T00:00:00Z',
    });
  });
  it('취소된 요청은 다른 조회나 새 입장으로 재시도하지 않는다', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.mocked(authenticatedFetch).mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    await expect(
      fetchChatRecovery(membership, 'view', 'signed', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(authenticatedFetch).toHaveBeenCalledOnce();
  });
});
