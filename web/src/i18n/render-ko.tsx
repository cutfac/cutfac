import type { RenderMessages } from "./render-en.tsx";

/** 프리뷰 옆 렌더링 카드와, 렌더링 중 채팅에 뜨는 줄. 해요체. */
export const renderKo: RenderMessages = {
  stages: { preparing: "준비", frames: "프레임", encoding: "인코딩" },
  frames: (done, total) => `${done}/${total} 프레임`,
  elapsed: (time) => `${time} 지남`,
  left: (time) => `약 ${time} 남음`,
  percent: (percent) => `렌더링 중 ${percent}%`,
  rendering: "렌더링 중",
  done: (time) => `완료 · ${time}`,
  failed: "렌더링 실패",
  fixing: "에이전트가 오류를 읽고 고치는 중이에요.",
  stopped: "렌더링을 멈췄어요",
  stop: "멈추기",
  log: "출력",
  previous: "이전 버전",
  shell: "에이전트가 셸에서 렌더링하고 있어서 진행률은 보이지 않아요.",
};
