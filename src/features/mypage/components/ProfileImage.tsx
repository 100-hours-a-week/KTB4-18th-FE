import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { getMyProfileImage, isProtectedProfileImage } from '../api/mypageApi';
import './profileImage.css';

type ProfileImageProps = {
  source: string | null;
  userId: number;
  file?: File | null;
  placeholder: ReactNode;
  onError?: (error: unknown) => void;
};

export function ProfileImage(props: ProfileImageProps) {
  return <ProfileImageContent key={`${props.userId}:${props.source ?? ''}`} {...props} />;
}

function ProfileImageContent({ source, userId, file, placeholder, onError }: ProfileImageProps) {
  const [image, setImage] = useState<{
    source: string | null;
    userId: number;
    file: File | null | undefined;
    url: string;
  } | null>(null);
  const [failed, setFailed] = useState<{
    source: string | null;
    userId: number;
    file: File | null | undefined;
  } | null>(null);
  const isProtected = Boolean(source && isProtectedProfileImage(source));

  useEffect(() => {
    let isActive = true;
    let objectUrl: string | null = null;
    if (file || (source && isProtected)) {
      const blob = file ? Promise.resolve(file) : getMyProfileImage(source!);
      void blob
        .then((value) => {
          if (!isActive) return;
          objectUrl = URL.createObjectURL(value);
          if (!isActive) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
            return;
          }
          setImage({ source, userId, file, url: objectUrl });
        })
        .catch((error: unknown) => {
          if (!isActive) return;
          setFailed({ source, userId, file });
          onError?.(error);
        });
    }
    return () => {
      isActive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, userId, file, isProtected, onError]);

  const hasFailed = failed?.source === source && failed?.userId === userId && failed?.file === file;
  const currentUrl =
    file || isProtected
      ? image?.source === source && image.userId === userId && image.file === file
        ? image.url
        : null
      : source;
  return (
    <>
      {currentUrl && !hasFailed ? (
        <img
          src={currentUrl}
          alt="프로필"
          onError={() => {
            setFailed({ source, userId, file });
            onError?.(new Error('Profile image unavailable'));
          }}
        />
      ) : (
        placeholder
      )}
      {hasFailed && !onError && (
        <span className="mypage-image-status" role="status">
          프로필 이미지를 불러오지 못했어요.
        </span>
      )}
    </>
  );
}
