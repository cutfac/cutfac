import { withParticle } from "../lib/korean.ts";
import type { ToolKind } from "../lib/run.ts";
import type { ChatMessages } from "./chat-en.tsx";

const TOOL_PHRASES: Record<ToolKind, (count: number) => string> = {
  read: (count) => `파일 ${count}개 읽음`,
  search: (count) => `${count}번 검색함`,
  edit: (count) => `파일 ${count}개 수정함`,
  command: (count) => `명령 ${count}개 실행함`,
  other: (count) => `도구 ${count}번 사용함`,
};

export const chatKo: ChatMessages = {
  chat: {
    agent: "에이전트",
    rolledBack: (media) =>
      media === undefined
        ? "미디어를 이전 상태로 되돌렸어요"
        : `${withParticle(media, "을/를")} 이전 상태로 되돌렸어요`,
    editTitle: "가리키고, 말하세요",
    editBody:
      "타임라인을 드래그해서 구간을 고르거나 영상 위에 박스를 그리세요. 그다음 바꿀 내용을 쓰고 Enter를 누르면 에이전트가 편집하고, 전후를 비교할 수 있어요. 아래에서 버전 수를 늘리면 여러 개를 나란히 보고 고를 수 있어요.",
    newTitle: "첫 버전을 요청하세요",
    newBody: "원하는 영상을 아래에 설명하면 에이전트가 첫 버전을 만들어요.",
    showTarget: "영상에서 이 부분 보기",
    newMedia: "새 미디어",
    working: "작업하는 중…",
    compacting: "대화를 압축하는 중…",
    compacted: "대화를 압축했어요",
    compactedHint: "대화가 길어져서 에이전트가 앞부분을 요약하고 이어서 작업해요.",
    stop: "중지",
    failed: "에이전트가 실패했어요.",
    stopped: "끝나기 전에 중지했어요.",
    notSent:
      "아직 에이전트에게 보내지 않았어요. 여기서 실행하거나 프롬프트를 복사해서 Claude Code나 Codex에 붙여넣으세요.",
    showSteps: (count) => `단계 ${count}개 보기`,
    toolSummary: (counts) => counts.map(({ kind, count }) => TOOL_PHRASES[kind](count)).join(", "),
    runWith: (agent) => `${agent}로 실행`,
    retryWith: (agent) => `${agent}로 다시 시도`,
    copyPrompt: "프롬프트 복사",
    connectAgent: "에이전트 연결",
    edited: (media) => (
      <>
        <span className="font-medium">{withParticle(media, "을/를")}</span> 편집했어요. 괜찮아
        보이나요?
      </>
    ),
    keep: "유지",
    restore: "이전으로 되돌리기",
    askAgain: "다시 요청",
    answerHint: (choices) =>
      choices
        ? "답을 기다려요. 하나를 고르거나 아래에 직접 적어 보내세요."
        : "답을 기다려요. 아래에 적어 보내세요.",
    pickTime: "타임라인에서 이 구간 선택",
    kept: "유지함",
    rolledBackBadge: "되돌림",
    versionsReady: (media, saved, wanted) =>
      wanted !== undefined && wanted > saved ? (
        <>
          {media}의 버전 {wanted}개 중 {saved}개가 준비됐어요.
        </>
      ) : (
        <>
          {media}의 버전 {saved}개가 준비됐어요. 비교하고 하나를 골라 주세요.
        </>
      ),
    keepNone: "모두 버리기",
    keptNone: "모두 버림",
    keptVersion: (label) => `“${label}” 유지`,
    discarded: "버전을 모두 버렸어요. 미디어는 원래대로예요.",
    waiting: (agent, ahead) =>
      ahead === 0 ? `다음 차례 · ${agent}` : `${agent} 기다리는 중 · 앞에 ${ahead}개`,
    reword: "수정",
    save: "저장",
    cancel: "취소",
    cancelRequest: "요청 취소",
    paused: (count) => `앞선 실행이 끝나지 않아서 요청 ${count}개가 멈춰 있어요.`,
    resume: "계속",
    cancelAll: "모두 취소",
  },
  boxPrompt: {
    label: "이 박스에 대한 요청",
    hint: {
      chat: "Enter로 채팅에 보내기 · Esc로 닫기",
      copy: "Enter로 프롬프트 복사 · Esc로 닫기",
    },
    send: "보내기",
  },
  pins: {
    state: {
      working: "작업 중",
      waiting: "대기 중",
      halted: "끝나지 않음",
      review: "확인 대기",
    },
    title: (number, state) => `#${number} · ${state}`,
  },
  signIn: {
    title: (agent) => `${agent}에 다시 로그인해 주세요`,
    body: "로그인이 만료됐거나 풀려서 이 요청을 처리하지 못했어요. 다시 로그인한 다음 다시 시도해 주세요.",
    action: "다시 로그인",
    checking: "로그인 상태를 확인하는 중…",
    signingIn: "브라우저에서 로그인을 마쳐 주세요…",
    done: "로그인했어요. 요청을 다시 시도해 주세요.",
    terminal: "터미널에서 이 명령을 실행한 다음 요청을 다시 시도해 주세요.",
    failed: "로그인이 끝나지 않았어요. 대신 터미널에서 실행할 수 있어요.",
    copied: "복사했어요. 터미널에 붙여 넣어 주세요.",
  },
};
