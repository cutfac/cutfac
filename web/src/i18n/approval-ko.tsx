import { particle, withParticle } from "../lib/korean.ts";
import type { ApprovalMessages } from "./approval-en.tsx";

/** 에이전트가 도구를 쓰기 전에 보드에서 묻는 문구, 해요체. */
export const approvalKo: ApprovalMessages = {
  asks: (agent, kind, tool) => {
    const who = withParticle(agent, "이/가");

    return {
      command: `${who} 명령을 실행하려고 해요`,
      network: `${who} 인터넷에 접속하려고 해요`,
      edit: `${who} 파일을 고치려고 해요`,
      access: `${who} 권한을 더 달라고 해요`,
      tool: `${who} ${tool} 도구를 쓰려고 해요`,
    }[kind];
  },
  network: "인터넷 접속",
  allow: "허용",
  always: "항상 허용",
  keeps: (agent, rules, session) => {
    const who = withParticle(agent, "이/가");
    const when = session ? "이 대화에서는" : "앞으로";

    if (rules.length === 0) return `항상 허용하면 ${when} ${who} 이 작업을 다시 묻지 않아요.`;

    const named = rules.join(", ");

    return (
      <>
        항상 허용하면 {when} {who} <span className="font-mono">{named}</span>
        {particle(named, "은/는")} 묻지 않아요.
      </>
    );
  },
  deny: "거부",
  waiting: "답을 기다리는 중…",
};
