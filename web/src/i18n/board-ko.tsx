import { withParticle } from "../lib/korean.ts";
import type { BoardMessages } from "./board-en.tsx";

export const boardKo: BoardMessages = {
  status: {
    drafting: "제작 중",
    review: "검토",
    done: "완료",
    archived: "보관",
  },
  itemActions: {
    open: "열기",
    moveTo: "옮기기",
    showFolder: "폴더 보기",
    rename: "이름 바꾸기",
    archive: "보관",
    archived: (titles) =>
      titles.length === 1
        ? `${withParticle(`"${titles[0]}"`, "을/를")} 보관했어요`
        : `영상 ${titles.length}개를 보관했어요`,
    undo: "실행 취소",
  },
  board: {
    title: "영상",
    loadError: "영상을 불러오지 못했어요",
    layout: "보기 방식",
    gallery: "갤러리",
    board: "보드",
    count: (count) => `${count}개`,
    allFormats: "모든 템플릿",
    filterByFormat: "템플릿으로 거르기",
    archived: "보관됨",
    emptyTitle: "첫 영상을 만들어 보세요. 에이전트가 제작해요",
    emptyBody:
      "무엇을 만들지 말해 주세요. 에이전트가 브리프를 먼저 읽고 만들고, 결과는 여기서 검토하고 수정을 요청하면 돼요.",
    known: (titles) =>
      titles.length === 1
        ? `에이전트가 ${titles[0]}에 대해 알고 있어요`
        : `에이전트가 자료 ${titles.length}개를 알고 있어요`,
    reading: (titles) =>
      titles.length === 1
        ? `에이전트가 ${withParticle(titles[0] ?? "", "을/를")} 읽고 있어요…`
        : `에이전트가 자료 ${titles.length}개를 읽고 있어요…`,
    ideaPrompt: (platform, seconds, about) => {
      const lead = [seconds === undefined ? undefined : `${seconds}초`, platform ?? "영상"]
        .filter((part) => part !== undefined)
        .join(" ");

      return `${lead} 만들어 줘. ${about}`;
    },
    emptyColumn: "비어 있어요",
    openFeedback: (count) => `${count}개 남음`,
    selected: "선택됨",
    selectedCount: (count) => `영상 ${count}개 선택됨`,
    learnHint: {
      title: "에이전트에게 제품을 알려 주세요",
      body: "앱이나 사이트 링크를 붙여 넣거나 프로젝트 폴더를 가리키면, 다음 영상부터 제품에 더 잘 맞춰 만들어요.",
      action: "자료 추가",
      dismiss: "나중에",
    },
  },
  newItem: {
    open: "새 영상",
    untitled: "새 영상",
  },
};
