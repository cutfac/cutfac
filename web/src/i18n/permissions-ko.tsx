import type { PermissionsMessages } from "./permissions-en.tsx";

/** 에이전트마다 보드에서 시작한 실행이 묻지 않고 할 수 있는 범위를 고르는 문구, 해요체. */
export const permissionsKo: PermissionsMessages = {
  label: "권한",
  modes: {
    follow: "내 설정 따르기",
    edit: "컷팩 · 기본",
    auto: "컷팩 · 자동",
    full: "컷팩 · 전체 접근",
  },
  access: {
    asks: (agent) =>
      `파일을 편집하거나 명령을 실행하기 전에 여기서 물어봐요. 터미널에서 ${agent}이(가) 묻는 것과 같아요.`,
    edit: {
      claude:
        "이 워크스페이스의 파일을 편집하고 컷팩의 도구를 써요. 그 밖의 작업은 여기서 먼저 물어봐요.",
      codex:
        "이 워크스페이스의 파일을 편집하고 컷팩의 도구를 써요. 허락이 필요한 작업은 하지 않아요.",
    },
    auto: (agent) =>
      `이 워크스페이스의 파일을 편집하고, 그 밖의 작업은 ${agent}의 자동 검토가 판단해요.`,
    full: "묻지 않고 이 컴퓨터에서 무엇이든 할 수 있어요. 어떤 명령이든 실행하고 어떤 파일이든 바꿔요.",
    limited: "워크스페이스를 편집할 수 없는 설정이라 영상을 바꾸지 못할 수 있어요.",
  },
  followed: (agent, setting) =>
    setting === undefined ? `${agent}에 따로 정한 설정이 없어요.` : `${agent} 설정: ${setting}.`,
  saved: (agent, mode) => `다음 실행부터 ${agent}에 '${mode}' 권한을 적용해요`,
  failed: (agent) => `${agent}의 권한을 바꾸지 못했어요`,
  error: "에이전트의 권한 설정을 읽지 못했어요",
};
