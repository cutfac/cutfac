import type { OnboardingMessages } from "./onboarding-en.tsx";

/** 처음 실행할 때의 문구, 해요체. */
export const onboardingKo: OnboardingMessages = {
  step: (current, total) => `${total}단계 중 ${current}단계`,
  linkWaiting: "링크로 받은 영상 요청이 기다리고 있어요. 설정을 마치면 바로 열려요.",
  welcome: {
    title: "컷팩에 오신 걸 환영해요",
    body: "에이전트에게 말로 부탁해서 짧은 영상을 만들어요. 고치고 싶은 순간을 가리키고, 여러 버전을 나란히 비교해 보세요.",
    start: "시작하기",
  },
  agent: {
    title: "에이전트를 준비할게요",
    body: "컷팩은 이 Mac의 Claude Code나 Codex로 영상을 만들어요. 하나만 있으면 돼요.",
    checking: "이 Mac에서 에이전트를 찾는 중…",
    checkFailed: "에이전트를 확인하지 못했어요",
    tryAgain: "다시 시도",
    state: {
      missing: "아직 설치되지 않았어요",
      outdated: (version) =>
        version === undefined ? "업데이트가 필요해요" : `${version} 버전은 업데이트가 필요해요`,
      signedOut: "설치되어 있어요. 로그인하면 쓸 수 있어요.",
      ready: "준비됐어요",
    },
    fix: {
      missing: "설치",
      outdated: "업데이트",
      signedOut: "로그인",
    },
    fixing: {
      missing: "설치하는 중…",
      outdated: "업데이트하는 중…",
      signedOut: "브라우저에서 로그인을 마쳐 주세요…",
    },
    failed: "끝까지 진행되지 않았어요. 대신 터미널에서 실행할 수 있어요:",
    copied: "복사했어요. 터미널에 붙여 넣고 돌아오세요.",
    checkAgain: "다시 확인",
    subscription: "각각 따로 구독이 필요해요. 이미 쓰고 있는 쪽을 고르세요.",
    next: "다음",
  },
  access: {
    title: "에이전트가 파일을 볼 수 있게 해 주세요",
    body: "에이전트는 다운로드 폴더의 영상처럼 여러분이 가리킨 파일을 읽어요. 전체 디스크 접근 권한이 없으면 macOS가 폴더마다 확인 창을 띄워요.",
    open: "시스템 설정 열기",
    howTo: [
      "시스템 설정의 전체 디스크 접근 권한 화면이 열려요.",
      "작은 창에 있는 컷팩을 목록으로 끌어다 놓으세요.",
    ],
    waiting: "목록에 컷팩이 추가되기를 기다리는 중…",
    granted: "권한을 받았어요",
    skip: "나중에 하기",
    skipNote: "대신 macOS가 폴더마다 물어봐요.",
    preview: {
      list: "전체 디스크 접근 권한",
      drop: "위 목록에 끌어다 놓으세요",
      pane: "개인정보 보호 및 보안",
      search: "검색",
    },
  },
  folder: {
    title: "영상을 둘 폴더를 정해요",
    body: "컷팩은 템플릿과 영상을 한 폴더에 일반 파일로 보관해요. 다른 폴더는 나중에 언제든 열 수 있어요.",
    change: "변경…",
    create: "만들기",
    use: "이 폴더 사용",
    creating: "준비하는 중…",
  },
  dragHelper: {
    hint: "위 목록으로 끌어다 놓으세요",
  },
};
