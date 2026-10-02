import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signup } from '../api/signupApi';
import { getCurrentTerms, TermType } from '../api/termsApi';
import { SignupPage } from './SignupPage';

vi.mock('../api/signupApi', () => ({ signup: vi.fn() }));
vi.mock('../api/termsApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/termsApi')>();
  return { ...original, getCurrentTerms: vi.fn(), getTermDetail: vi.fn() };
});

function nicknameInput() {
  return screen.getByLabelText(/닉네임/);
}

async function prepareForm(nickname = '한글Ab12') {
  render(<SignupPage />);
  await waitFor(() => expect(screen.getByLabelText('전체선택')).toBeEnabled());
  fireEvent.change(nicknameInput(), { target: { value: nickname } });
  fireEvent.change(screen.getByLabelText(/이메일/), { target: { value: 'qa@example.com' } });
  fireEvent.change(screen.getByLabelText(/^비밀번호/, { selector: 'input' }), {
    target: { value: 'Password1!' },
  });
  fireEvent.click(screen.getByLabelText('전체선택'));
}

describe('SignupPage nickname policy', () => {
  beforeEach(() => {
    vi.mocked(getCurrentTerms).mockResolvedValue(
      Object.values(TermType).map((type, index) => ({
        terms_id: index + 1,
        type,
        title: type,
        version: '1.0',
        is_required: true,
        effective_at: '2026-01-01T00:00:00Z',
      })),
    );
    vi.mocked(signup).mockResolvedValue({ message: 'register success', data: { user_id: 1 } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('preserves Korean syllables, English case and numbers through composition', async () => {
    await prepareForm();
    expect(nicknameInput()).toHaveValue('한글Ab12');
    fireEvent.blur(nicknameInput());
    fireEvent.compositionStart(nicknameInput());
    fireEvent.input(nicknameInput(), { target: { value: 'ㅎ' }, isComposing: true });
    expect(nicknameInput()).toHaveValue('ㅎ');
    expect(nicknameInput()).toHaveAttribute('aria-invalid', 'false');
    fireEvent.input(nicknameInput(), { target: { value: '한글Ab12' }, isComposing: true });
    fireEvent.compositionEnd(nicknameInput(), { data: '한글Ab12' });
    expect(nicknameInput()).toHaveValue('한글Ab12');
    expect(screen.getByRole('button', { name: '회원가입' })).toBeEnabled();
  });

  it('trims outer whitespace on blur and sends the normalized nickname', async () => {
    await prepareForm('  한글Ab12  ');
    fireEvent.blur(nicknameInput());
    expect(nicknameInput()).toHaveValue('한글Ab12');
    fireEvent.click(screen.getByRole('button', { name: '회원가입' }));
    await waitFor(() =>
      expect(signup).toHaveBeenCalledWith(expect.objectContaining({ nickname: '한글Ab12' })),
    );
  });

  it('trims the outgoing nickname even when the field has not blurred', async () => {
    await prepareForm('  한글Ab12  ');
    const nickname = nicknameInput();
    expect(nickname).toHaveValue('  한글Ab12  ');
    fireEvent.submit(nickname.closest('form')!);
    await waitFor(() =>
      expect(signup).toHaveBeenCalledWith(expect.objectContaining({ nickname: '한글Ab12' })),
    );
  });

  it.each(['가', '가'.repeat(13), '한 글', '한\t글', '한글!', '한글🙂', 'ㄱㄴ', '   '])(
    'rejects invalid nickname %j without silently replacing it',
    async (value) => {
      await prepareForm(value);
      expect(nicknameInput()).toHaveValue(value);
      expect(nicknameInput()).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('button', { name: '회원가입' })).toBeDisabled();
      expect(signup).not.toHaveBeenCalled();
    },
  );

  it.each(['가나', '한글AB12345678', '  가나  '])(
    'allows normalized 2 to 12 characters: %j',
    async (value) => {
      await prepareForm(value);
      expect(screen.getByRole('button', { name: '회원가입' })).toBeEnabled();
    },
  );

  it('shows the server duplicate nickname error and retains the entered values', async () => {
    vi.mocked(signup).mockRejectedValueOnce(new Error('nickname already exists'));
    await prepareForm();
    fireEvent.click(screen.getByRole('button', { name: '회원가입' }));
    expect(await screen.findByText('이미 사용 중인 닉네임이에요.')).toBeVisible();
    expect(nicknameInput()).toHaveValue('한글Ab12');
    expect(screen.getByLabelText(/^비밀번호/, { selector: 'input' })).toHaveValue('Password1!');
    fireEvent.change(nicknameInput(), { target: { value: '새닉네임' } });
    expect(screen.queryByText('이미 사용 중인 닉네임이에요.')).not.toBeInTheDocument();
  });

  it('disables the form while pending and preserves values after a request failure', async () => {
    let rejectRequest: (error: Error) => void = () => {};
    vi.mocked(signup).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        }),
    );
    await prepareForm();
    fireEvent.click(screen.getByRole('button', { name: '회원가입' }));
    expect(nicknameInput()).toBeDisabled();
    expect(screen.getByRole('button', { name: '회원가입' })).toBeDisabled();
    await act(async () => rejectRequest(new Error('internal server error')));
    expect(await screen.findByRole('alert')).toHaveTextContent('회원가입을 완료하지 못했어요.');
    expect(nicknameInput()).toHaveValue('한글Ab12');
    expect(nicknameInput()).toBeEnabled();
  });
});
