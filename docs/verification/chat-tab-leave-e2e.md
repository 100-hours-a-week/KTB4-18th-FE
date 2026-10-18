# F4 다중 탭 퇴장 E2E

## 실행

FE의 `feature/chat-tab-leave-e2e`에서 실행한다. B6/F3가 반영된 인접 BE 저장소와 Node·JDK 25·Docker가 필요하다. 실행 시작 FE는 bf67985, BE는 a2d8e7d다.

```bash
npm ci
npm run verify:chat:tab-types
npm run verify:chat:tab-e2e
```

기본 브라우저는 설치된 Google Chrome이다. 브라우저를 별도로 준비하는 환경에서는 아래처럼 Playwright Chromium을 선택할 수 있다. 이 선택은 이번 실행에서는 검증하지 않았다.

```bash
npx playwright install chromium
CHAT_E2E_BROWSER_CHANNEL=bundled npm run verify:chat:tab-e2e
```

BE 위치가 다르면 `CHAT_E2E_BACKEND_DIR`에 저장소 절대 경로를 지정한다. 특정 시나리오만 실행할 수도 있다.

```bash
npm run verify:chat:tab-e2e -- --project=chrome-desktop --grep '메뉴 이동'
```

runner가 기존 BE의 선택적 browser fixture 테스트 하나를 실행한다. 해당 테스트가 전용 MySQL 9.7.0 컨테이너와 임의 포트의 실제 Spring 서버, 합성 역지오코딩 서버를 만든다. Vite는 127.0.0.1:5175에서 실제 API·WebSocket을 이 서버로 프록시한다. 기존 fixture가 있거나 포트가 사용 중이면 중복 실행하지 않는다.

종료 시 BE에 release를 전달하고 Vite·브라우저·합성 인증 fixture·전용 서버/컨테이너를 정리한다. 기존 개발 서버나 운영 서버를 대상으로 하지 않는다. 테스트 환경 외에 DB 스키마·BE 코드·제품 화면·인증 구현·공개 API를 변경하지 않았다.

## 검증 경계

실제 ChatEntryPage·useChatParticipation·ChatParticipation·인증 저장소·Web Locks·REST·STOMP를 사용한다. 테스트 전용 진입 화면의 메뉴가 실제 navigate 이벤트와 컴포넌트 unmount를 구동한다. 전체 App의 로그인 화면과 내비게이션 외형은 이 진입 화면에 포함하지 않는다.

한 브라우저 context의 두 page에 같은 합성 JWT를 넣어 같은 sub/sid를 만들고, 별도 context의 다른 합성 계정을 인원·수신 확인용으로 사용한다. 브라우저 geolocation 권한과 고정 좌표를 사용하며 외부 역지오코딩만 합성 응답이다. 운영 로그인·쿠키 갱신·실제 GPS·기기 간 로그아웃 검증과 구분한다.

Chrome 1280×900과 모바일 viewport 390×844·touch·isMobile 설정에서 같은 시나리오를 실행한다. 모바일 설정은 데스크톱 Chrome의 에뮬레이션이며 실제 Android/iOS 또는 Safari 검증으로 표시하지 않는다.

| 시나리오 | 확인 내용 |
| --- | --- |
| 메뉴 이동·재입장 | 같은 membership·다른 view, 한 번의 탭별 DELETE 204, 종료 view의 조회403/CONNECT4103, 남은 탭 전송·계정 인원1 유지, 이전 수신 캐시 복원·부재 메시지 제외 |
| 마지막 탭 퇴장 | 별도 계정 화면에서 인원2→2→1 확인, 다른 계정의 전송 유지. 연결 인원 검증이며 정원 예약25계정 경합은 B3/B6 서버 검증 범위다. |
| 실제 탭 닫기 | 실제 page.close 후 남은 탭의 입력·전송·인원 유지 |
| 새로고침 | 새 view 발급, 남은 탭 전송·인원 유지, view 식별자 캐시 제외 |
| 지연된 입장 | 서버가 이미 만든 입장 응답의 전달만 보류한 뒤 메뉴 이동, 늦게 받은 view 하나만 정리·재연결 거절, 다른 탭 전송 유지 |
| 짧은 단절 | 한 page의 실제 WebSocket만 끊고 재접속을 잠시 차단, 다른 탭 퇴장 후에도 기존 view로 재연결, 누락 메시지1회 복구·전송 유지 |

지연된 입장 검증은 가짜 성공 응답을 만들지 않고 실제 서버 응답의 전달 시점만 조정한다. 단절 검증은 실제 WebSocket을 종료하고 해당 page의 재접속 목적지만 임시로 닫힌 포트로 바꾼다. 서버 메시지·열람 권한 응답을 대체하지 않는다.

## pagehide와 새로고침 결과

초기 실행은 8개 통과·4개 실패였다. 탭 닫기·새로고침의 DELETE를 Playwright page 이벤트로 항상 관측할 수 있다고 가정한 검증이 실패했다. 후속 서버 권한 probe에서 탭 닫기의 종료는 확인됐으나 브라우저 요청 이벤트는 누락될 수 있음을 확인했다. 따라서 확정된 명시적 퇴장은 서버의 조회·재연결 권한으로 판정한다.

새로고침에서는 이전 view의 재연결이 허용되는 경우도 재현했다. 이는 B6 문서의 unload keepalive 전달 비보장·요청 미도달 시 기존 단절 유예 적용 범위다. 새로고침마다 이전 view의 영구 종료를 보장한다고 해석하지 않는다. 최종 테스트는 새 view 발급·남은 탭 유지·식별자 캐시 분리를 확인하고, 요청 관측 여부를 reload-boundary 첨부로 남긴다. 기존 view가 반드시 즉시 종료돼야 한다면 별도의 제품·인증 전송 경로 수정이 필요하다. 이 검증 PR에는 그 변경을 섞지 않았다.

초기 실패와 probe 재현 기록을 보존했으며, 실패를 재시도 성공으로 숨기거나 전체 전달 보장으로 표시하지 않는다.

## 결과와 산출물

- 최종 E2E 12개 전부 통과·실패0·제외0·재시도0 (38.3초). 데스크톱6개·모바일화면6개다. 실행 폴더: `node_modules/.tmp/chat-tab-leave-e2e/run-1792299843725-75888/`. 준비용 BE fixture 테스트1개도 통과했고 종료 후 인증 fixture 삭제를 확인했다.
- 별도 TypeScript·ESLint·runner 구문 검사·프로덕션 빌드 통과. 제품 번들에는 검증 화면과 fixture가 포함되지 않는다.
- 기존 전체 Vitest는 587개 통과·이미지 추천1개 실패·실서버 조건부4개 제외다. 실패는 B6/F3 작업 때 수정 전 코드에서도 확인한 이미지 추천 dialog 기대값 문제이며 이번 변경에서 해당 제품/테스트 파일을 수정하지 않았다.
- 전체 Prettier는 기존 인증6파일 위반으로 실패한다. 이번 변경 파일의 포맷 결과는 별도 확인한다.
- Playwright는 Vitest 수집에서 제외하며 실행 명령을 분리한다. 테스트를 skip/expected-failure로 숨기지 않고 retries=0으로 실행한다.
- 실행별 `node_modules/.tmp/chat-tab-leave-e2e/run-*/`에 JSON·BE 준비/정리 로그·실패 스크린샷을 저장한다. trace/video/HAR는 기록하지 않고 JWT·인증 fixture는 커밋하지 않는다. 초기 진단 기록은 같은 기본 폴더의 before-close-probe/와 reload-probe-diagnostic/에 보존했다.
