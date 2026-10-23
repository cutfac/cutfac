import type { McpMessages } from "./mcp-en.tsx";

/** 보드에서 실행할 때 쓸 MCP 서버를 켜고 끄는 문구, 해요체. */
export const mcpKo: McpMessages = {
  title: "보드에서 실행할 때 쓸 MCP 서버",
  body: "Claude Code와 Codex에 설정된 서버와 플러그인이에요. 보드에서 시작한 실행은 여기서 켠 것만, 그 도구를 모두 써요. 켜기 전에 무엇을 실행하는지 확인해 주세요.",
  footnote:
    "claude.ai 커넥터의 서버는 보드에서 실행할 때 불러오지 않아요. 플러그인의 스킬은 늘 불러오고, 서버만 여기서 정해요.",
  error: "에이전트의 MCP 서버를 읽지 못했어요",
  problems: "에이전트의 MCP 설정 중 일부를 읽지 못했어요",
  sources: {
    user: "모든 워크스페이스",
    local: "이 폴더만",
    project: "워크스페이스의 .mcp.json",
  },
  states: {
    on: "켜짐",
    off: "꺼짐",
    new: "새로 찾음",
    changed: "바뀜",
  },
  changedNote: "켠 뒤로 설정이 바뀌어서, 다시 확인할 때까지 꺼 두었어요.",
  env: "환경 변수",
  headers: "헤더",
  helper: "헤더를 만들 때 실행",
  turnOn: "켜기",
  turnOff: "끄기",
  keepOff: "꺼 두기",
  turnedOn: (name) => `이제 보드에서 실행할 때 ${name}을(를) 써요`,
  turnedOff: (name) => `보드에서 실행할 때 ${name}은(는) 쓰지 않아요`,
  failed: (name) => `${name}을(를) 바꾸지 못했어요`,
  plugin: {
    ask: (title) => `${title} 플러그인을 영상 작업에 쓸까요?`,
    access: (title) => `쓰면 영상 작업 중에 ${title}에 접근할 수 있어요.`,
    use: "쓰기",
    skip: "안 쓰기",
    starts: (count) => (count === 1 ? "무엇을 실행하나요" : `무엇을 실행하나요 (${count})`),
    turnedOn: (title) => `이제 영상 작업에 ${title}을(를) 써요`,
    turnedOff: (title) => `영상 작업에 ${title}은(는) 쓰지 않아요`,
  },
};
