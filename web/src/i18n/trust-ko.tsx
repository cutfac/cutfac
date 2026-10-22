import type { TrustMessages } from "./trust-en.tsx";

/** 워크스페이스의 Claude Code 설정을 신뢰하는 문구, 해요체. */
export const trustKo: TrustMessages = {
  title: "이 워크스페이스의 Claude Code 설정을 확인해 주세요",
  body: "Claude Code는 실행할 때마다 이 폴더의 설정을 불러오고, 아래 설정은 묻지 않고 명령을 실행하거나 허용해요. 신뢰한다고 해 주시면 컷팩이 여기서 Claude를 실행해요. Codex는 Codex에서 신뢰하기 전까지 폴더 설정을 쓰지 않아요.",
  wholeFile: "파일 전체",
  trust: "신뢰하고 사용하기",
  trusting: "신뢰하는 중…",
  trusted: "이제 이 워크스페이스에서 Claude를 실행할 수 있어요",
  failed: "워크스페이스를 신뢰하지 못했어요",
  error: "이 워크스페이스의 Claude Code 설정을 읽지 못했어요",
  note: (setup) => <>{setup("워크스페이스 설정")}을 확인하고 신뢰하면 Claude가 시작해요.</>,
};
