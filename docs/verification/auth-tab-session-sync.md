# 새 탭 세션 복구·프로필 로그아웃 동기화

## 동작

같은 브라우저 프로필은 하나의 로그인 계정을 사용한다. 새 탭은 HttpOnly refresh 쿠키와 기존 CSRF/refresh API로 같은 세션을 복구하며 로그인 API를 다시 호출하지 않는다. 로그인 URL로 접속했어도 복구 후 안전한 returnTo로 이동한다. 초기 확인 중에는 로그인 폼을 노출하지 않아 불필요한 재로그인을 막는다.

로그인 성공·계정 전환은 다른 탭의 이전 인증·캐시를 정리하고 현재 쿠키로 복구하도록 알린다. 로그아웃은 같은 프로필의 모든 탭에서 인증을 제거하며 자동 복구를 시작하지 않는다. 다른 기기·브라우저 프로필의 독립 세션은 유지한다. 일반 채팅 메뉴 이동은 탭별 퇴장 정책 그대로다.

## 변경

- 기존 auth-epoch에 임의 ID와 available/signed-out 상태만 저장한다. access/refresh 토큰이나 사용자 정보는 탭 메시지·localStorage에 추가하지 않는다.
- storage와 BroadcastChannel은 현재 epoch를 한 번만 처리한다. 오래된 epoch의 지연 메시지는 무시한다. 구형 opaque epoch와 epoch 없는 메시지는 기존 보수적 인증 제거 동작을 유지한다.
- 현재 epoch로 토큰을 복구한 탭도 이미 처리한 상태로 기록해 늦은 중복 메시지가 새 토큰을 지우지 않도록 한다.
- 이전 세대의 pending refresh를 새 로그인 복구에 재사용하지 않는다. refresh 응답 후 epoch를 다시 검사해 이전 작업이 새 marker·토큰을 덮지 않게 한다.
- 성공한 로그인·로그아웃 전환은 오래된 미확정 refresh-operation marker를 정리한다. 기존 Web Locks·CSRF·credentials·재시도 제한은 유지한다.
- App의 인증 만료가 진행 중 복구의 UI 의도를 무효화한다. 초기 복구 성공이 늦게 도착해 로그아웃 상태를 되돌리지 않는다.
- 로그인 화면 복귀의 외부 URL과 로그인/회원가입 경로 반복 이동을 방지한다.

## 실행

```sh
npm run test
npm run lint
npm run format:check
npm run verify:auth:types
npm run build
npm run verify:auth:tabs
```

브라우저 검증은 설치된 Chrome과 loopback 5176 포트를 사용한다. 이미 실행 중인 서버를 재사용하거나 종료하지 않는다. 종료 시 Playwright가 전용 Vite 프로세스를 정리한다. 새 의존성·운영 환경 변수는 없다.

## 검증 결과

- 전체 Vitest 612개 중 607개 통과, 실서버 조건부 5개 제외, 실패 0개. 신규 단위 9개·App 통합 2개 포함.
- ESLint·전체 Prettier·전용 TypeScript·프로덕션 빌드 통과. 기존 500kB 번들 경고 유지.
- Chrome 데스크톱 1280×900 및 모바일 viewport 390×844 각각 6개, 총 12개 통과. 실패·제외·재시도 0개, 최종 19.6초.
- 이메일·비밀번호 폼→실제 LoginPage의 대기열 호출→login→새 탭의 같은 sub/sid 복구를 확인했다. 로그인 URL의 새 탭도 추가 로그인 POST 없이 복구한다.
- 한 탭 로그아웃 후 다른 탭·재접속/새 탭은 비로그인이고, 독립 BrowserContext의 같은 계정은 새로고침 뒤에도 유지됐다.
- BroadcastChannel을 끈 storage-only 동기화, 여러 탭 동시 복구·중복/지연 알림, 계정 전환 후 이전 화면 제거, 일시적 503 뒤 수동 복구도 확인했다. 계정 전환 시나리오는 실제 login API wrapper를 직접 호출한다.
- 수정 전 07c6b83 격리 사본에 당시 새 회귀 테스트를 적용했을 때 59개 중 52개 통과·관련 7개 실패를 재현했다. 원래 작업 트리는 되돌리지 않았다.
- 초기 확인 화면 추가에 맞춰 기존 App UI 테스트가 비로그인 복구 완료 후 폼을 기다리게 조정했다. 기존 opaque token fixture의 사전 refresh는 일시적 실패로 분리했다. 최종 검사에 실패를 남기지 않았다.

증빙은 node_modules/.tmp/auth-tab-all-final.json, auth-tab-baseline.json과 auth-tab-session/run-*/results.json에 보존한다. screenshot은 실패 시만 저장하고 trace·video는 기록하지 않는다. 토큰·쿠키 원문을 문서에 첨부하지 않는다.

## 실제 백엔드·배포와의 경계

브라우저 검증은 실제 프론트엔드 App·REST wrapper·Web Locks·storage·BroadcastChannel·HttpOnly 쿠키를 사용한다. scripts/startAuthTabVerification.mjs가 격리된 인증 프로토콜 서버를 제공하며, 실제 Spring/Hazelcast/BCrypt/대기열 수용량·CSRF 미들웨어·TLS·운영 쿠키 설정을 검증한 것은 아니다. 테스트 JWT와 비밀번호는 합성 fixture다. 테스트 서버는 프로덕션 번들에 포함되지 않는다. 모바일도 실제 iOS/Android 기기가 아니다.

백엔드 제품 코드는 변경하지 않았다. 현재 refresh/logout API와 세션 단위 폐기를 재사용한다. 기존 B7의 인증 로그아웃 발행자가 구형 ChatLogoutEvent를 사용하는 문제와 ChatSessionLogoutEvent 연결은 별도 의존성으로 유지한다. 이번 FE 인증 정리는 서버 채팅의 즉시 폐기 이벤트 연동을 대체하지 않는다.

공개 API URL·Body·응답, DB·ERD·refresh 저장소/회전 정책은 변경하지 않았다. 로그인 전파 hint만으로 인증을 허용하지 않고 서버 쿠키 검증 결과를 사용한다. 구버전 탭과 혼용하면 구형 만료 처리 동작이 남을 수 있으므로 배포 후 기존 탭 새로고침으로 동일 버전을 확인한다. 서버·데이터 변경이 없어 FE 변경만 되돌릴 수 있다.

push·PR·운영 배포·외부 이슈 변경은 수행하지 않았다. 실제 사용자 환경·운영 인증 재검증은 배포 단계에서 별도로 확인한다.
