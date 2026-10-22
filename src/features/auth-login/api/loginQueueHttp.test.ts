import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from './loginQueueHttp';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchWithTimeout no-content responses', () => {
  it.each([204, 205, 304])(
    'returns HTTP %i without rebuilding a forbidden response body',
    async (status) => {
      const response = {
        body: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
        headers: new Headers(),
        status,
        statusText: '',
      } as Response;
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

      await expect(fetchWithTimeout('/api/v1/auth/login-queue/tickets/current')).resolves.toBe(
        response,
      );
    },
  );
});
