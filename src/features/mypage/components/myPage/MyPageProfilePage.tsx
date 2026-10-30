import { ActionButton, Menu } from '@seed-design/react';
import { useCallback, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { updateMyProfile, uploadMyProfileImage, type UserProfile } from '../../api/mypageApi';
import { validateProfileFields } from '../../model/profileValidation';
import { ProfileImage } from '../ProfileImage';
import { MyPageHeader } from './MyPageHeader';
import { message } from './useMyPageOverview';

export function ProfilePage({
  profile,
  reload,
  back,
  onImageSaved,
}: {
  profile: UserProfile;
  reload: () => void;
  back: () => void;
  onImageSaved: (url: string) => void;
}) {
  const [nickname, setNickname] = useState(profile.nickname);
  const [birthYear, setBirthYear] = useState(profile.birth_year?.toString() ?? '');
  const [gender, setGender] = useState(profile.gender ?? '');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageError = useCallback((error: unknown) => {
    setNotice(message(error, '프로필 이미지를 불러오지 못했어요. 다시 시도해 주세요.'));
  }, []);
  const validationErrors = validateProfileFields(nickname, birthYear);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Object.values(validationErrors).some(Boolean) || saving) {
      setNotice('프로필 정보를 확인해 주세요.');
      return;
    }
    setSaving(true);
    setNotice('');
    let isImageSaved = uploadedImageUrl !== null;
    try {
      if (selectedImage) {
        const uploaded = await uploadMyProfileImage(selectedImage);
        setUploadedImageUrl(uploaded.profile_image_url);
        onImageSaved(uploaded.profile_image_url);
        setSelectedImage(null);
        isImageSaved = true;
      }
      await updateMyProfile({
        nickname: nickname.trim(),
        birth_year: birthYear ? Number(birthYear) : null,
        gender: gender || null,
      });
      setNotice('프로필을 저장했어요.');
      reload();
    } catch (error) {
      setNotice(
        isImageSaved
          ? `프로필 이미지는 저장했지만 프로필 정보는 저장하지 못했어요. ${message(error, '다시 저장해 주세요.')}`
          : message(
              error,
              selectedImage
                ? '프로필 이미지를 저장하지 못했어요. 다시 시도해 주세요.'
                : '프로필을 저장하지 못했어요.',
            ),
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <MyPageHeader title="프로필 수정" onBack={back}>
        <Menu.Root>
          <Menu.Trigger className="mypage-icon-button" aria-label="더보기">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </Menu.Trigger>
          <Menu.Positioner>
            <Menu.Content>
              <Menu.Item onClick={back}>내 공간으로 돌아가기</Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Menu.Root>
      </MyPageHeader>
      <section className="mypage-page-content mypage-profile-page">
        <form className="mypage-form" onSubmit={submit}>
          <div className="mypage-profile-image-row">
            <div className="mypage-profile-image-avatar">
              <ProfileImage
                source={uploadedImageUrl ?? profile.profile_image_url}
                userId={profile.user_id}
                file={selectedImage}
                onError={imageError}
                placeholder={
                  <img
                    className="mypage-profile-image-placeholder"
                    src="/icons/mypage/profile-image-placeholder.svg"
                    alt="기본 프로필 이미지"
                  />
                }
              />
            </div>
            <input
              ref={imageInput}
              type="file"
              hidden
              accept="image/jpeg,image/png,image/webp"
              aria-label="프로필 이미지 선택"
              disabled={saving}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file || saving) return;
                if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                  setNotice('JPG, PNG, WEBP 형식의 이미지만 등록할 수 있어요.');
                  return;
                }
                if (file.size > 10_000_000) {
                  setNotice('10MB 이하의 이미지만 등록할 수 있어요.');
                  return;
                }
                setSelectedImage(file);
                setUploadedImageUrl(null);
                setNotice('');
              }}
            />
            <button
              type="button"
              className="mypage-profile-image-button"
              disabled={saving}
              onClick={() => imageInput.current?.click()}
            >
              프로필 변경
            </button>
          </div>
          <label>
            <span>
              닉네임 <b aria-hidden="true">*</b>
            </span>
            <input
              value={nickname}
              maxLength={12}
              onChange={(event) => {
                setNickname(event.target.value);
                setNotice('');
              }}
              aria-invalid={Boolean(validationErrors.nickname)}
              aria-describedby={validationErrors.nickname ? 'mypage-nickname-error' : undefined}
            />
            {validationErrors.nickname && (
              <span id="mypage-nickname-error" className="mypage-notice" role="alert">
                {validationErrors.nickname}
              </span>
            )}
          </label>
          <label>
            <span>
              이메일 <b aria-hidden="true">*</b>
            </span>
            <input value={profile.email} readOnly aria-readonly="true" />
          </label>
          <label>
            <span>
              출생연도 <span className="mypage-optional-label">(선택)</span>
            </span>
            <input
              value={birthYear}
              aria-label="출생 연도 (선택)"
              inputMode="numeric"
              maxLength={4}
              onChange={(event) => {
                setBirthYear(event.target.value.replace(/\D/g, ''));
                setNotice('');
              }}
              aria-invalid={Boolean(validationErrors.birthYear)}
              aria-describedby={validationErrors.birthYear ? 'mypage-birth-year-error' : undefined}
            />
            {validationErrors.birthYear && (
              <span id="mypage-birth-year-error" className="mypage-notice" role="alert">
                {validationErrors.birthYear}
              </span>
            )}
          </label>
          <div className="mypage-gender-field" role="group" aria-labelledby="mypage-gender-label">
            <span id="mypage-gender-label" className="mypage-gender-title">
              성별 <span className="mypage-optional-label">(선택)</span>
            </span>
            <div className="mypage-gender-options">
              <label>
                <input
                  type="checkbox"
                  name="mypage-gender"
                  value="FEMALE"
                  checked={gender === 'FEMALE'}
                  onChange={(event) => setGender(event.target.checked ? 'FEMALE' : '')}
                />
                <span className="mypage-gender-check" aria-hidden="true" />
                <span>여성</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  name="mypage-gender"
                  value="MALE"
                  checked={gender === 'MALE'}
                  onChange={(event) => setGender(event.target.checked ? 'MALE' : '')}
                />
                <span className="mypage-gender-check" aria-hidden="true" />
                <span>남성</span>
              </label>
            </div>
          </div>
          <aside className="mypage-personalization-note">
            더 잘 맞는 음악을 추천받고 싶다면 알려주세요.
            <br />
            출생연도와 성별 정보는 AI 음악 추천 개인화에만 활용됩니다.
          </aside>
          {notice && (
            <p className="mypage-notice" role="status">
              {notice}
            </p>
          )}
          <div className="mypage-action-dock">
            <ActionButton
              type="submit"
              variant="brandSolid"
              size="medium"
              loading={saving}
              disabled={saving}
            >
              저장
            </ActionButton>
          </div>
        </form>
      </section>
    </>
  );
}
