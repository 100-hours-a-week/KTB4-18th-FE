// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createChatDevProxy } from './chatDevProxy';

describe('분리 앱의 개발 경로 라우팅', () => {
  it('채팅 REST/WS는 Chat으로, 인증·위치는 Core로 전달한다', () => {
    const proxy = createChatDevProxy('http://localhost:8080', 'http://localhost:8081');
    const route = (url: string) =>
      Object.entries(proxy).find(([key]) =>
        key.startsWith('^') ? new RegExp(key).test(url) : url.startsWith(key),
      )?.[1];
    for (const url of [
      '/ws',
      '/ws/info',
      '/api/v1/chat-rooms/7/members',
      '/api/v1/chat-rooms/7/messages?mode=history',
      '/api/v1/regions/25/chat-room',
    ])
      expect(route(url)?.target).toBe('http://localhost:8081');
    for (const url of [
      '/api/v1/auth/refresh',
      '/api/v1/locations/resolve',
      '/api/v1/regions/25/other',
      '/api/v1/regions/25/chat-rooms',
    ])
      expect(route(url)?.target).toBe('http://localhost:8080');
    expect(route('/ws')?.ws).toBe(true);
  });
  it('Chat 대상 미지정 시 기존 단일 앱 개발 환경을 유지한다', () => {
    expect(
      Object.values(createChatDevProxy('http://localhost:8080')).every(
        (value) => value.target === 'http://localhost:8080',
      ),
    ).toBe(true);
  });
});
