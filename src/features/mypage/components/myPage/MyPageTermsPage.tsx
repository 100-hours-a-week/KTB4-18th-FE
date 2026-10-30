import { BottomSheet } from '@seed-design/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getCurrentTerms,
  getTermDetail,
  type CurrentTerm,
  type TermDetail,
} from '../../../user-signup/api/termsApi';
import { MyPageTermsListSkeleton } from '../../../../components/RouteLoadSkeleton';
import { useDelayedPending } from '../../../../hooks/useDelayedPending';
import { MyPageHeader } from './MyPageHeader';
import { TermsMarkdown } from './TermsMarkdown';

export function TermsPage({ back }: { back: () => void }) {
  const [terms, setTerms] = useState<CurrentTerm[]>([]);
  const [selected, setSelected] = useState<Pick<
    TermDetail,
    'title' | 'version' | 'content'
  > | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [requestId, setRequestId] = useState(0);
  const requestGeneration = useRef(0);
  const isSkeletonVisible = useDelayedPending(isLoading, requestId);
  const load = useCallback(async () => {
    const current = ++requestGeneration.current;
    setRequestId(current);
    setError('');
    setIsLoading(true);
    try {
      const nextTerms = await getCurrentTerms();
      if (current === requestGeneration.current) setTerms(nextTerms);
    } catch {
      if (current === requestGeneration.current) {
        setTerms([]);
        setError('약관 및 정책을 불러오지 못했어요.');
      }
    } finally {
      if (current === requestGeneration.current) setIsLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function open(term: CurrentTerm) {
    setError('');
    try {
      setSelected(await getTermDetail(term));
    } catch {
      setError('약관 상세를 불러오지 못했어요.');
    }
  }
  return (
    <>
      <MyPageHeader title="약관 및 정책" onBack={back} />
      <section className="mypage-page-content mypage-terms-page" aria-busy={isLoading}>
        {error && (
          <p className="mypage-notice" role="alert">
            {error}{' '}
            <button className="mypage-inline-button" type="button" onClick={() => void load()}>
              다시 시도
            </button>
          </p>
        )}
        <div className="mypage-terms-list">
          {isSkeletonVisible && !terms.length && !error ? (
            <MyPageTermsListSkeleton />
          ) : (
            <>
              {terms.map((term) => (
                <button
                  className="mypage-navigation-row"
                  type="button"
                  key={term.terms_id}
                  onClick={() => void open(term)}
                >
                  <span>{term.title}</span>
                  <img src="/icons/mypage/arrow-right.svg" alt="" />
                </button>
              ))}
              <button
                className="mypage-navigation-row"
                type="button"
                onClick={() =>
                  setSelected({
                    title: '오픈소스 라이선스',
                    version: '',
                    content: [
                      '| 오픈소스 | 라이선스 |',
                      '| --- | --- |',
                      '| React | MIT |',
                      '| React DOM | MIT |',
                      '| @seed-design/react | Apache-2.0 |',
                      '| @karrotmarket/react-monochrome-icon | Apache-2.0 |',
                    ].join('\n'),
                  })
                }
              >
                <span>오픈소스 라이선스</span>
                <img src="/icons/mypage/arrow-right.svg" alt="" />
              </button>
            </>
          )}
        </div>
        <p className="mypage-app-version">앱 버전 1.0.0 (Build 24)</p>
      </section>
      <BottomSheet.Root
        open={selected !== null}
        onOpenChange={(openSheet) => !openSheet && setSelected(null)}
      >
        <BottomSheet.Backdrop />
        <BottomSheet.Positioner>
          <BottomSheet.Content>
            <BottomSheet.Header>
              <BottomSheet.Title>{selected?.title}</BottomSheet.Title>
              <BottomSheet.Description>{selected?.version}</BottomSheet.Description>
              <BottomSheet.CloseButton aria-label="약관 상세 닫기">닫기</BottomSheet.CloseButton>
            </BottomSheet.Header>
            <BottomSheet.Body className="mypage-term-sheet-body">
              {selected && <TermsMarkdown content={selected.content} />}
            </BottomSheet.Body>
          </BottomSheet.Content>
        </BottomSheet.Positioner>
      </BottomSheet.Root>
    </>
  );
}
