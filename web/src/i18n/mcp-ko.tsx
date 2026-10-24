import type { McpMessages } from "./mcp-en.tsx";

/** 영상 작업에 쓸 MCP 서버와 플러그인을 켜고 끄는 문구, 해요체. */
export const mcpKo: McpMessages = {
  title: "영상 작업에 쓸 도구",
  body: "Claude Code와 Codex에 설정된 MCP 서버와 플러그인이에요. 보드에서 시작한 작업은 여기서 켠 것만 쓰고, 켠 것의 도구는 모두 써요. 켜기 전에 무엇을 실행하는지 확인해 주세요.",
  footnote: "claude.ai 커넥터는 여기 나오지 않아요. 플러그인을 꺼도 스킬은 그대로 써요.",
  error: "에이전트의 MCP 서버를 읽지 못했어요",
  problems: "에이전트의 MCP 설정 중 일부를 읽지 못했어요",
  sources: {
    user: "모든 워크스페이스",
    local: "이 폴더만",
    project: "워크스페이스의 .mcp.json",
  },
  changedNote: "켠 뒤로 설정이 바뀌어서, 다시 확인할 때까지 꺼 두었어요.",
  starts: "무엇을 실행하나요",
  env: "환경 변수",
  headers: "헤더",
  helper: "헤더를 만들 때 실행",
  use: "쓰기",
  skip: "안 쓰기",
  toggle: (name) => `영상 작업에 ${name} 쓰기`,
  server: {
    ask: (name) => `${name} 서버를 영상 작업에 쓸까요?`,
    access: "쓰면 영상 작업 중에 에이전트가 이 서버의 도구를 모두 쓸 수 있어요.",
    turnedOn: (name) => `이제 영상 작업에 ${name} 서버를 써요`,
    turnedOff: (name) => `영상 작업에 ${name} 서버를 쓰지 않아요`,
    failed: (name) => `${name} 서버를 바꾸지 못했어요`,
  },
  plugin: {
    ask: (title) => `${title} 플러그인을 영상 작업에 쓸까요?`,
    access: (title) => `쓰면 영상 작업 중에 에이전트가 ${title}에 접근할 수 있어요.`,
    turnedOn: (title) => `이제 영상 작업에 ${title} 플러그인을 써요`,
    turnedOff: (title) => `영상 작업에 ${title} 플러그인을 쓰지 않아요`,
    failed: (title) => `${title} 플러그인을 바꾸지 못했어요`,
  },
};
