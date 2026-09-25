export type SignupTerm = {
  id: number;
  type: 'SERVICE' | 'PROFILE' | 'AIPERSONAL' | 'LOCATIONTERMS' | 'LOCATION';
  required: boolean;
  label: string;
  description: string;
  detail: {
    title: string;
    version: string;
    sections: Array<{ heading: string; content: string }>;
  };
};

// 회원가입에서 사용하는 현재 시행 약관입니다. 이 초기 버전의 ID는 가입 마이그레이션의 terms 데이터와 대응합니다.
export const signupTerms: SignupTerm[] = [
  {
    id: 1,
    type: 'SERVICE',
    required: true,
    label: '[필수] 서비스 이용약관 동의',
    description: '동의하지 않으면 가입할 수 없어요.',
    detail: {
      title: '서비스 이용약관',
      version: 'v0.2 · 2026-09-20 시행',
      sections: [
        {
          heading: '제1조 목적과 적용',
          content:
            '이 약관은 머문음 서비스의 이용 조건, 회사와 회원의 권리·의무 및 책임 사항을 정합니다. 서비스에는 지도 기반 음악 기록, 게시·열람, 채팅, 공유 링크, 음악 탐색 및 AI 음악 추천이 포함됩니다.',
        },
        {
          heading: '제2조 약관 게시·변경',
          content:
            '중요한 변경 또는 회원에게 불리한 변경은 적용 전 별도 안내하고, 필요한 경우 재동의를 받습니다.',
        },
        {
          heading: '제3조 계정',
          content:
            '회원은 정확한 정보로 계정을 만들고 인증 수단을 관리해야 합니다. 타인 계정 사용, 허위 정보 등록, 서비스 보안 우회와 운영 방해를 해서는 안 됩니다.',
        },
        {
          heading: '제4조 콘텐츠와 커뮤니티',
          content:
            '회원은 게시할 권한이 있는 콘텐츠만 게시해야 합니다. 타인의 개인정보·현재 위치·사생활을 동의 없이 게시하거나 저작권을 침해해서는 안 됩니다.',
        },
        {
          heading: '제5조 지도 기록과 공유 링크',
          content:
            '지도 기록의 좌표는 기기의 현재 위치와 구분됩니다. 공유 링크에는 현재 위치나 철회된 콘텐츠를 자동 포함하지 않습니다.',
        },
        {
          heading: '제6조 AI 음악 추천',
          content:
            'AI 결과는 참고용이며 정확성·완전성을 보장하지 않습니다. 프로필 또는 이용 이력 기반 맞춤 추천은 별도 선택 동의가 있는 경우에만 제공합니다.',
        },
        {
          heading: '제7조 이용 제한·탈퇴',
          content:
            '회원은 설정에서 언제든 탈퇴를 요청할 수 있습니다. 법령상 보관 의무가 있는 정보를 제외하고 회사는 지체 없이 삭제 또는 익명화합니다.',
        },
      ],
    },
  },
  {
    id: 3,
    type: 'PROFILE',
    required: false,
    label: '[선택] 출생연도·성별을 AI 맞춤 음악 추천에 이용하는 데 동의합니다',
    description: '동의하지 않아도 가입과 기본 음악 추천을 이용할 수 있어요.',
    detail: {
      title: '출생연도·성별의 맞춤 추천 이용 동의',
      version: 'v0.2 · 2026-09-20 시행',
      sections: [
        {
          heading: '목적',
          content: '가입 시 수집한 출생연도·성별과 음악 기록·선호를 반영한 맞춤 음악 추천',
        },
        {
          heading: '항목',
          content: '가입 시 수집한 출생연도, 성별, 공개 범위 내 음악 기록·선호·추천 반응',
        },
        { heading: '보유 기간', content: '동의 철회 또는 회원 탈퇴 시까지' },
        {
          heading: '거부 권리',
          content: '동의를 거부해도 가입과 기본 서비스, 일반 음악 추천은 이용할 수 있습니다.',
        },
      ],
    },
  },
  {
    id: 2,
    type: 'AIPERSONAL',
    required: false,
    label: '[선택] AI 맞춤 음악 추천을 위한 정보 이용에 동의합니다',
    description: '공개 범위 내 음악 기록·선호·추천 반응을 맞춤 추천에 이용합니다.',
    detail: {
      title: 'AI 맞춤 음악 추천 정보 이용 동의',
      version: 'v0.2 · 2026-09-20 시행',
      sections: [
        { heading: '목적', content: '공개 범위 내 음악 기록·선호·추천 반응을 반영한 맞춤 추천' },
        { heading: '항목', content: '공개 범위 내 음악 기록·선호·추천 반응' },
        { heading: '보유 기간', content: '동의 철회 또는 회원 탈퇴 시까지' },
        {
          heading: '거부 권리',
          content: '거부해도 일반 음악 추천과 기본 기능은 이용할 수 있습니다.',
        },
      ],
    },
  },
  {
    id: 6,
    type: 'LOCATIONTERMS',
    required: false,
    label: '[선택] 위치기반서비스 이용약관에 동의합니다',
    description: '현재 위치 기반 장소 탐색과 기록 기능에 적용됩니다.',
    detail: {
      title: '위치기반서비스 이용약관',
      version: 'v0.2 · 2026-09-20 시행',
      sections: [
        { heading: '서비스', content: '현재 위치 기반 장소 탐색 및 위치 기반 기록' },
        { heading: '이용자 권리', content: '동의·철회, 일시 중지, 열람·고지 요구' },
        {
          heading: '안내',
          content:
            '현재 위치는 이 기능 제공을 위해서만 사용하며, 음악 기록이나 공유 링크에 자동 공개되지 않습니다.',
        },
      ],
    },
  },
  {
    id: 4,
    type: 'LOCATION',
    required: false,
    label: '[선택] 개인위치정보 수집·이용에 동의합니다',
    description: '선택하면 개인위치정보 수집·이용에 동의한 것으로 처리합니다.',
    detail: {
      title: '개인위치정보 수집·이용 동의',
      version: 'v0.2 · 2026-09-20 시행',
      sections: [
        {
          heading: '목적',
          content: '현재 위치를 기준으로 한 장소 탐색 및 위치 기반 기록 기능 제공',
        },
        { heading: '항목', content: '기기에서 취득한 현재 위치와 수집 시각' },
        { heading: '보유 기간', content: '기능 제공에 필요한 최소 기간' },
        {
          heading: '거부 권리',
          content: '거부해도 직접 장소를 선택하여 기록하는 등 기본 서비스는 이용할 수 있습니다.',
        },
      ],
    },
  },
];

export const privacyNotice = '개인정보 처리방침을 확인했습니다';

export const privacyPolicyDetail = {
  title: '개인정보 처리방침',
  version: 'v0.2 · 2026-09-20 시행',
  sections: [
    {
      heading: '수집 항목',
      content:
        '계정·필수 가입 정보로 이메일, 비밀번호 해시, 닉네임, 출생연도, 성별, 가입·인증 기록을 처리합니다.',
    },
    {
      heading: '처리 목적',
      content:
        '회원 식별, 로그인, 연령 확인 및 서비스 제공을 위해 처리합니다. 출생연도·성별은 별도 선택 동의 없이 AI 맞춤 추천·분석에 이용하지 않습니다.',
    },
    {
      heading: '보유 기간',
      content:
        '회원 탈퇴 시까지 보유하며, 법령상 보관 의무가 있는 정보는 해당 기간 동안 보관합니다.',
    },
    {
      heading: '이용자 권리',
      content: '회원은 설정에서 프로필 조회·수정·삭제, 선택 동의 철회와 탈퇴를 요청할 수 있습니다.',
    },
  ],
};
