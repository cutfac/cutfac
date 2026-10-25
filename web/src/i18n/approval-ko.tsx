import type { ApprovalMessages } from "./approval-en.tsx";

/** 에이전트가 도구를 쓰기 전에 보드에서 묻는 문구, 해요체. */
export const approvalKo: ApprovalMessages = {
  asks: (agent, tool) => `${agent}이(가) ${tool} 도구를 쓰려고 해요`,
  allow: "허용",
  always: "항상 허용",
  keeps: (agent, rules) =>
    rules.length === 0
      ? `${agent}이(가) 앞으로 이 작업은 묻지 않아요.`
      : `${agent}이(가) 앞으로 ${rules.join(", ")}은(는) 묻지 않아요.`,
  deny: "거부",
  waiting: "답을 기다리는 중…",
};
