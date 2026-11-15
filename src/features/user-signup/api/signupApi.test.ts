import { afterEach, expect, it, vi } from 'vitest';
import { signup, type SignupPayload } from './signupApi';

afterEach(() => vi.unstubAllGlobals());

const payload: SignupPayload = {
  email: 'signup.qa@example.com',
  password: 'synthetic-password-123!',
  nickname: 'signupqa',
  birth_year: 1998,
  gender: 'FEMALE',
  terms_ids: [1, 2],
};

it('sends the signup request using the backend JSON contract', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ message: 'register success', data: { user_id: 42 } }, { status: 201 }),
    );
  vi.stubGlobal('fetch', fetcher);

  await expect(signup(payload)).resolves.toEqual({
    message: 'register success',
    data: { user_id: 42 },
  });

  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/users/signup');
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Content-Type')).toBe(
    'application/json',
  );
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(payload);
});

it('surfaces the backend signup error message for non-success responses', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ message: 'email already exists', data: null }, { status: 409 }),
      ),
  );

  await expect(signup(payload)).rejects.toThrow('email already exists');
});
