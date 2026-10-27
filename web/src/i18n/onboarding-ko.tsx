import type { OnboardingMessages } from "./onboarding-en.tsx";

/** 처음 실행할 때의 문구, 해요체. */
export const onboardingKo: OnboardingMessages = {
  step: (current, total) => `${total}단계 중 ${current}단계`,
  linkWaiting: "링크로 받은 영상 요청이 기다리고 있어요. 설정을 마치면 바로 열려요.",
  back: "이전",
  welcome: {
    title: "컷팩에 오신 걸 환영해요",
    body: [
      "에이전트에게 말로 부탁해서 짧은 영상을 만들어요.",
      "고치고 싶은 순간을 가리키고, 여러 버전을 나란히 비교해 보세요.",
    ],
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
    title: "에이전트가 화면을 보고 쓸 수 있게 해 주세요",
    body: "에이전트는 영상에 쓸 앱 화면을 녹화하고, 부탁하면 앱을 직접 써요. 에이전트는 컷팩의 권한으로 움직이니, 컷팩에 이 두 가지를 켜 주세요.",
    turnOn: "켜기",
    on: "켜짐",
    granted: "둘 다 켰어요",
    skip: "나중에 하기",
    screen: {
      name: "화면 기록",
      why: "화면과 앱을 녹화해서 영상에 써요.",
      waiting: "목록에서 컷팩을 켜 주세요. macOS가 앱을 다시 열자고 하면 그대로 따라 주세요.",
      list: "화면 및 시스템 오디오 기록",
    },
    accessibility: {
      name: "손쉬운 사용",
      why: "에이전트가 다른 앱을 누르고 입력할 수 있어요.",
      waiting: "목록에서 컷팩을 켜 주세요…",
      list: "손쉬운 사용",
    },
    deviceControl: "기기 제어 및 데이터 접근",
    preview: {
      pane: "개인정보 보호 및 보안",
      search: "검색",
    },
  },
  ready: {
    title: "첫 영상을 만들 준비가 됐어요",
    body: "에이전트는 영상을 만들 때마다 알려 주신 내용을 먼저 읽어요. 영상과 템플릿은 한 폴더에 일반 파일로 보관돼요.",
    savedIn: "저장 위치",
    change: "변경…",
    start: "만들기 시작",
    creating: "준비하는 중…",
  },
  dragHelper: {
    hint: "위 목록으로 끌어다 놓으세요",
  },
};
