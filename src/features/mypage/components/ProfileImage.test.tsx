import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMyProfileImage } from '../api/mypageApi';
import { ProfileImage } from './ProfileImage';

vi.mock('../api/mypageApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/mypageApi')>()),
  getMyProfileImage: vi.fn(),
}));
const source = '/api/v1/users/me/profile-image/one.png';
const placeholder = <span>기본 이미지</span>;
let sequence = 0;
const create = vi.fn(() => `blob:avatar-${++sequence}`);
const revoke = vi.fn();

describe('ProfileImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sequence = 0;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    vi.mocked(getMyProfileImage).mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
  });
  afterEach(cleanup);

  it('loads protected blobs and revokes URLs on replacement and unmount', async () => {
    const view = render(<ProfileImage source={source} userId={1} placeholder={placeholder} />);
    expect(await screen.findByAltText('프로필')).toHaveAttribute('src', 'blob:avatar-1');
    expect(getMyProfileImage).toHaveBeenCalledWith(source);
    view.rerender(
      <ProfileImage
        source={null}
        userId={1}
        file={new File(['png'], 'test.png')}
        placeholder={placeholder}
      />,
    );
    await waitFor(() =>
      expect(screen.getByAltText('프로필')).toHaveAttribute('src', 'blob:avatar-2'),
    );
    expect(revoke).toHaveBeenCalledWith('blob:avatar-1');
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:avatar-2');
  });

  it('ignores delayed requests after source changes and unmount without allocating URLs', async () => {
    let resolve!: (blob: Blob) => void;
    vi.mocked(getMyProfileImage).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<ProfileImage source={source} userId={1} placeholder={placeholder} />);
    view.rerender(
      <ProfileImage source="https://example.com/avatar.png" userId={1} placeholder={placeholder} />,
    );
    await act(async () => resolve(new Blob(['old'])));
    expect(screen.getByAltText('프로필')).toHaveAttribute('src', 'https://example.com/avatar.png');
    expect(create).not.toHaveBeenCalled();
    view.rerender(<ProfileImage source={source} userId={1} placeholder={placeholder} />);
    view.unmount();
    await act(async () => resolve(new Blob(['old'])));
    expect(create).not.toHaveBeenCalled();
  });

  it('does not show or allocate the previous account image after account changes', async () => {
    let resolve!: (blob: Blob) => void;
    const view = render(<ProfileImage source={source} userId={1} placeholder={placeholder} />);
    await screen.findByAltText('프로필');
    vi.mocked(getMyProfileImage).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    view.rerender(<ProfileImage source={source} userId={2} placeholder={placeholder} />);
    expect(screen.queryByAltText('프로필')).toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:avatar-1');
    view.rerender(<ProfileImage source={null} userId={3} placeholder={placeholder} />);
    await act(async () => resolve(new Blob(['account 2'])));
    expect(create).toHaveBeenCalledOnce();
    expect(screen.getByText('기본 이미지')).toBeTruthy();
  });

  it('announces fetch errors and keeps the placeholder', async () => {
    vi.mocked(getMyProfileImage).mockRejectedValue(new Error('unavailable'));
    render(<ProfileImage source={source} userId={1} placeholder={placeholder} />);
    expect(await screen.findByRole('status')).toHaveTextContent(
      '프로필 이미지를 불러오지 못했어요.',
    );
    expect(screen.getByText('기본 이미지')).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it('preserves direct legacy URLs and falls back on image decode errors', async () => {
    const onError = vi.fn();
    render(
      <ProfileImage
        source="https://example.com/avatar.jpg"
        userId={1}
        placeholder={placeholder}
        onError={onError}
      />,
    );
    expect(getMyProfileImage).not.toHaveBeenCalled();
    const image = screen.getByAltText('프로필');
    act(() => image.dispatchEvent(new Event('error')));
    expect(screen.getByText('기본 이미지')).toBeTruthy();
    expect(onError).toHaveBeenCalledOnce();
  });
});
