import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  getMyProfile,
  getMySettings,
  MyPageRequestError,
  type UserProfile,
  type UserSettings,
} from '../../api/mypageApi';
import { getAllMusicRecords } from '../../../music-record/api/musicRecordsApi';
import { useDelayedPending } from '../../../../hooks/useDelayedPending';

const INITIAL_SETTINGS: UserSettings = {
  map_visibility: 'PRIVATE',
  is_unrecorded_dot_recommendation_enabled: true,
};

export function useMyPageOverview() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<UserSettings>(INITIAL_SETTINGS);
  const [settingsError, setSettingsError] = useState('');
  const [savedSongCount, setSavedSongCount] = useState<number | null>(null);
  const [savedSongError, setSavedSongError] = useState('');
  const [error, setError] = useState('');
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);
  const [isSavedSongCountLoading, setIsSavedSongCountLoading] = useState(false);
  const [profileRequestId, setProfileRequestId] = useState(0);
  const [settingsRequestId, setSettingsRequestId] = useState(0);
  const [savedSongCountRequestId, setSavedSongCountRequestId] = useState(0);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const version = useRef(0);
  const authFailureGeneration = useRef<number | null>(null);
  const countRequestSequence = useRef(0);
  const isProfileSkeletonVisible = useDelayedPending(isProfileLoading, profileRequestId);
  const isSettingsSkeletonVisible = useDelayedPending(isSettingsLoading, settingsRequestId);
  const isCountSkeletonVisible = useDelayedPending(
    isSavedSongCountLoading,
    savedSongCountRequestId,
  );

  const loadSavedSongCount = useCallback((current: number) => {
    if (current !== version.current || authFailureGeneration.current === current) return;
    const requestId = ++countRequestSequence.current;
    setSavedSongCountRequestId(requestId);
    setIsSavedSongCountLoading(true);
    setSavedSongCount(null);
    setSavedSongError('');
    void getAllMusicRecords()
      .then((records) => {
        if (current === version.current && authFailureGeneration.current !== current)
          setSavedSongCount(records.length);
      })
      .catch(() => {
        if (current === version.current && authFailureGeneration.current !== current)
          setSavedSongError('저장한 곡 수를 불러오지 못했어요.');
      })
      .finally(() => {
        if (current === version.current) setIsSavedSongCountLoading(false);
      });
  }, []);

  const reload = useCallback(() => {
    const current = ++version.current;
    authFailureGeneration.current = null;
    setProfile(null);
    setSavedSongCount(null);
    setError('');
    setSettingsError('');
    setSavedSongError('');
    setIsAuthenticated(null);
    setIsProfileLoading(true);
    setIsSettingsLoading(true);
    setIsSavedSongCountLoading(false);
    setProfileRequestId(current);
    setSettingsRequestId(current);

    const unauthorized = () => {
      if (current !== version.current) return;
      authFailureGeneration.current = current;
      setIsAuthenticated(false);
      setProfile(null);
      setSavedSongCount(null);
      setIsSavedSongCountLoading(false);
      setError('');
      setSettingsError('');
    };

    void getMyProfile()
      .then((nextProfile) => {
        if (current !== version.current || authFailureGeneration.current === current) return;
        setIsAuthenticated(true);
        setProfile(nextProfile);
        setError('');
        loadSavedSongCount(current);
      })
      .catch((caught) => {
        if (current !== version.current) return;
        if (caught instanceof MyPageRequestError && caught.status === 401) unauthorized();
        else setError(message(caught, '내 공간 정보를 불러오지 못했어요.'));
      })
      .finally(() => {
        if (current === version.current) setIsProfileLoading(false);
      });

    void getMySettings()
      .then((nextSettings) => {
        if (current !== version.current || authFailureGeneration.current === current) return;
        setSettings(nextSettings);
        setSettingsError('');
      })
      .catch((caught) => {
        if (current !== version.current) return;
        if (caught instanceof MyPageRequestError && caught.status === 401) unauthorized();
        else setSettingsError(message(caught, '설정을 불러오지 못했어요.'));
      })
      .finally(() => {
        if (current === version.current) setIsSettingsLoading(false);
      });
  }, [loadSavedSongCount]);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => {
      window.clearTimeout(timer);
      version.current += 1;
    };
  }, [reload]);

  const joinedDate = useMemo(
    () =>
      profile
        ? new Intl.DateTimeFormat('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }).format(new Date(profile.created_at))
        : '',
    [profile],
  );

  return {
    profile,
    setProfile,
    settings,
    settingsError,
    savedSongCount,
    savedSongError,
    error,
    isProfileLoading,
    isSettingsLoading,
    isSavedSongCountLoading,
    isProfileSkeletonVisible,
    isSettingsSkeletonVisible,
    isCountSkeletonVisible,
    isAuthenticated,
    joinedDate,
    reload,
    loadSavedSongCount,
    retrySavedSongCount: () => loadSavedSongCount(version.current),
  };
}

export function message(error: unknown, fallback: string) {
  if (error instanceof MyPageRequestError) {
    if (error.status === 401) return '로그인이 만료되었어요. 다시 로그인해 주세요.';
    if (error.status === null) return '네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
    return error.messageFromServer ?? fallback;
  }
  return fallback;
}
