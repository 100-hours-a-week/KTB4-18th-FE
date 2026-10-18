import { expect, it, vi } from 'vitest';
import { chatSessionFetch } from './chatSessionFetch';
import { fetchChatHistory } from './chatRecovery';

vi.mock('./chatSessionFetch', () => ({ chatSessionFetch: vi.fn() }));

it('서버 이력을 소유 인증 문맥과 현재 view로 요청하고 다음 cursor를 전달한다', async () => {
  vi.mocked(chatSessionFetch).mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            items: [],
            next_cursor: null,
            has_next: false,
            snapshot_message_id: 0,
            gaps: [],
          },
        }),
      ),
  );
  const member = { roomId: 7, membershipId: 9, regionId: 1, joinedAt: '', viewSessionId: 'view' };
  const signal = new AbortController().signal;
  await fetchChatHistory(member, 'view', null, signal, 'owner');
  expect(chatSessionFetch).toHaveBeenLastCalledWith(
    expect.stringContaining('membership_id=9&mode=history&size=50'),
    expect.objectContaining({ signal, headers: { 'X-Chat-View-Session': 'view' } }),
    'owner',
  );
  await fetchChatHistory(member, 'view', 'signed-next', signal, 'owner');
  expect(chatSessionFetch).toHaveBeenLastCalledWith(
    expect.stringContaining('cursor=signed-next'),
    expect.anything(),
    'owner',
  );
});
