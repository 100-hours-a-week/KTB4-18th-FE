# 이메일·비밀번호 로그인 프론트엔드 설계

> 대상 브랜치: `feature/auth-login` · 기준 커밋: `origin/dev` · 영역: Frontend

## 1. 목적과 사용자 결과

- 해결하려는 문제: 가입한 사용자가 이메일과 비밀번호를 입력하고 로그인 API를 호출할 화면이 없다.
- 기대 결과: 사용자는 모바일 우선 로그인 화면에서 자격 증명을 제출하고, 인증 성공 후 보호 기능 진입 흐름을 시작할 수 있다.

### 사용자 시나리오

1. 사용자는 Figma V1 로그인 화면에서 유효한 이메일과 비밀번호를 입력해 로그인 요청을 보낸다.
2. 형식이 맞지 않거나 값이 누락되면 제출 전에 수정 방법을 안내받는다.
3. 미가입·비밀번호 불일치·탈퇴·잠금으로 인증이 실패하면 계정 상태를 구분하지 않는 단일 안내를 받는다.
4. 요청이 진행 중일 때는 중복 제출할 수 없다.

## 2. 범위

### 포함

- React + TypeScript 로그인 페이지와 인증 API 모듈
- 이메일·비밀번호 입력, 클라이언트 검증, 비밀번호 보기/숨기기, 제출 중 상태
- `POST /api/v1/auth/login` 요청과 `credentials: 'include'`
- 400/401/500/네트워크 오류 사용자 안내
- Figma V1 로그인 화면 구조, 기존 `src/shared/styles` 디자인 토큰, 당근 SEED React 컴포넌트 적용
- 접근성 처리, 컴포넌트 테스트, lint/build 검증

### 제외

- 회원가입·비밀번호 재설정·토큰 재발급·로그아웃 API 호출 또는 구현
- refresh token 접근·표시·JavaScript 저장
- 보호 화면 라우팅과 access token 장기 저장 전략
- 백엔드의 사용자 조회, 토큰 발급, 실패 제한 상태 구현

## 3. 현재 기준과 의존성

현재 `origin/dev` 프론트엔드는 React 19, TypeScript, Vite, Tailwind CSS를 사용하고 `/api`를 `localhost:8080`으로 프록시한다. 공용 스타일은 `src/shared/styles`에 있으며 Pretendard 폰트와 semantic color/typography 토큰을 제공한다.

인증 API 계약은 백엔드 기능 이슈와 동기화한다. `access_token`과 `expires_in` 이외의 성공 Body 필드에 의존하지 않으며, refresh token은 `HttpOnly` Cookie이므로 읽거나 상태에 저장하지 않는다.

### 결정 필요 사항

- 로그인 성공 후 이동할 보호 화면 경로
- access token의 즉시 사용 위치와 장기 보관 전략
- 회원가입·비밀번호 재설정 링크의 실제 라우트 또는 비활성 처리 방식

이 결정은 로그인 API 범위를 넓히지 않는다. 미결 상태에서는 링크가 존재해도 미구현 API를 호출하지 않는다.

## 4. 화면과 UI 구조

Figma V1의 모바일 로그인 화면을 기준으로 다음 구조를 구현한다.

1. 제목: `다시 만나서 반가워요`
2. 보조 문구: `나의 음악 지도로 이어가요`
3. 이메일 라벨과 `name@example.com` placeholder 입력
4. 비밀번호 라벨, password 입력, 보기/숨기기 토글
5. 기본 행동 버튼: `로그인`
6. 보조 링크: `회원가입`, `비밀번호 재설정`

컴포넌트는 로그인 feature 안에서 페이지, form, API 타입·호출을 분리한다. 기존 추천 화면을 제거하거나 보호 라우팅을 도입하는 것은 이 기능의 범위가 아니므로, 실제 진입 연결은 라우팅 결정 후 최소 변경으로 처리한다.

### 디자인 시스템 적용

- 폰트: `src/shared/styles/base/fonts.css`와 `typography.css`의 Pretendard 및 typography utility
- 색상: `semantic.css`의 text, background, border, interactive 토큰
- 컴포넌트: 당근 SEED React를 입력, 버튼, 아이콘 등 적합한 UI 요소에 적용
- 레이아웃: 모바일 우선, 터치 가능한 컨트롤, 키보드 포커스가 보이는 상태

SEED 설치 및 정확한 컴포넌트 API는 구현 시 현재 프로젝트 의존성과 호환되는 버전을 확인한 뒤 추가한다. 디자인 시스템 토큰을 우회하는 하드코딩 색상·폰트는 사용하지 않는다.

## 5. 입력 상태와 접근성

### 상태

| 상태 | 동작 |
| --- | --- |
| 초기 | 이메일·비밀번호 입력 가능, 로그인 버튼은 폼 유효성에 따라 활성화 |
| 필드 오류 | 해당 입력의 오류 문구와 오류 스타일 표시 |
| 제출 중 | 두 입력과 버튼을 비활성화해 중복 요청 차단, 진행 상태 제공 |
| 인증 실패 | 단일 문구로 안내하고 비밀번호를 포함한 민감 정보는 표시하지 않음 |
| 서버/네트워크 오류 | 재시도 가능한 안내를 제공하고 입력값은 유지 |
| 성공 | access token을 응답에서 수신하고, 후속 경로 결정에 따라 이동 |

### 검증과 메시지

- 이메일: 빈 값과 이메일 형식을 클라이언트에서 먼저 검증한다.
- 비밀번호: 빈 값과 공백만 있는 값을 검증한다.
- 400: `입력값을 확인해 주세요.`처럼 수정 가능한 입력 오류를 안내한다.
- 401: `이메일 또는 비밀번호를 확인해 주세요.`처럼 계정 존재·탈퇴·잠금 여부를 드러내지 않는 한 가지 문구만 사용한다.
- 500/네트워크: `잠시 후 다시 시도해 주세요.`처럼 재시도를 안내한다.

모든 입력은 연결된 `label`을 갖고, 오류 메시지는 `role="alert"`, 제출 상태는 `role="status"`로 제공한다. 오류 발생 시 첫 오류 또는 요약 영역으로의 포커스 이동을 검토하며, 비밀번호 토글은 명확한 accessible name을 제공한다.

## 6. API 연동 계약

### 요청

```ts
type LoginRequest = {
  email: string
  password: string
}
```

`POST /api/v1/auth/login`에 JSON Body를 전송한다. Cookie 수신을 위해 요청에는 `credentials: 'include'`를 설정한다.

### 성공 응답

```ts
type LoginResponse = {
  message: 'login success'
  data: {
    access_token: string
    expires_in: number
  }
}
```

- UI는 `access_token`, `expires_in`만 읽는다.
- refresh token은 응답 Body, 상태, localStorage, sessionStorage, 디버그 출력 어디에도 두지 않는다.
- `Set-Cookie`는 브라우저가 처리하며 JavaScript가 읽지 않는다.

### 오류 매핑

| HTTP/상황 | 사용자 메시지 | 노출하지 않는 정보 |
| --- | --- | --- |
| 400 | 입력값을 확인해 주세요. | 서버 내부 검증 상세 |
| 401 | 이메일 또는 비밀번호를 확인해 주세요. | 미가입·탈퇴·잠금·비밀번호 불일치 여부 |
| 500 | 잠시 후 다시 시도해 주세요. | 내부 오류 세부 |
| 네트워크 | 네트워크 상태를 확인한 뒤 다시 시도해 주세요. | 요청/응답의 민감 정보 |

## 7. 작업 이슈와 완료 기준

### 상위 기능 이슈

`[FEATURE] 이메일·비밀번호 로그인 화면 제공`

- Figma V1 구조를 충족하는 모바일 우선 화면을 제공한다.
- 기존 스타일 토큰과 SEED 컴포넌트를 사용한다.
- 400은 입력 수정 안내, 401은 단일 인증 실패 안내, 500/네트워크 오류는 재시도 안내를 제공한다.
- refresh token을 UI 상태나 브라우저 저장소에 노출하지 않는다.
- 관련 컴포넌트 테스트와 `npm run lint`, `npm run build`를 완료한다.

### 하위 작업 — React·TypeScript 로그인 화면 및 API 연동

- 인증 feature와 TypeScript API 타입을 분리한다.
- API 요청에 `credentials: 'include'`를 추가하고 refresh token을 JavaScript에서 읽지 않는다.
- SEED와 기존 스타일 토큰으로 Figma V1 모바일 우선 UI를 구현한다.
- 이메일/비밀번호 검증, 비밀번호 보기/숨기기, 중복 제출 차단을 구현한다.
- 401은 미가입·탈퇴·잠금을 구분하지 않는 단일 안내 문구로 표시한다.
- label, `role="alert"`, `role="status"`, keyboard focus를 제공한다.
- 성공·400·401·500·네트워크 오류와 Cookie 포함 요청 옵션을 테스트한다.

이슈 번호, 담당자, 예상 소요 시간, 관련 PR은 생성·배정 후 연결한다.

## 8. 테스트와 검토

- 렌더링: 제목, 보조 문구, 두 입력, 로그인 버튼, 보조 링크
- 검증: 이메일 누락/형식 오류, 비밀번호 누락/공백 값, 오류 접근성
- 요청: 유효한 Body, JSON 헤더, `credentials: 'include'`, 제출 중 중복 방지
- 응답: 성공, 400, 401, 500, 네트워크 오류의 각각의 UI 상태
- 보안: refresh token을 읽거나 렌더링·저장하지 않음; 인증 실패 이유가 단일 문구임
- 품질: `npm run lint`, `npm run build` 및 관련 컴포넌트 테스트

## 9. 참고

- 디자인: 사용자 제공 Figma V1 로그인 페이지
- API 명세: 사용자 제공 Google Sheet의 `POST /api/v1/auth/login`
- 디자인 시스템: `src/shared/styles`의 폰트·semantic color·typography 토큰
- 이슈 초안: 프론트엔드 기능 이슈와 React·TypeScript 로그인 화면 및 API 연동 하위 작업
