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
    ideas: "이렇게 시작해 봐도 좋아요",
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
    title: "새 영상",
    description:
      "만들 영상을 적어 주세요. 에이전트가 바로 시작해요. 쓸 파일과 링크도 함께 넣을 수 있어요.",
    promptLabel: "어떤 영상을 만들까요?",
    promptPlaceholder: "새 알림 화면을 보여 주는 30초 영상, https://youtu.be/… 같은 느낌으로",
    files: "파일",
    drop: "파일을 여기에 놓거나 클릭해서 고르세요",
    removeFile: (name) => `${name} 빼기`,
    videoLink: "영상 · 이 영상의 파일로 받아요",
    pageLink: "링크 · 에이전트에게 주소를 전해요",
    removeLink: "링크 빼기",
    untitled: "새 영상",
    uploadFailed: (name, message) => `${withParticle(name, "을/를")} 넣지 못했어요: ${message}`,
    filesFailed: (message) => `파일을 넣지 못했어요: ${message}`,
    linkFailed: (link) => `${link} 영상을 받지 못해서 링크로 전해요.`,
    sendFailed: "영상은 만들었지만 요청을 에이전트에게 보내지 못했어요",
    format: "템플릿",
    noFormat: "템플릿 없음",
    optional: "선택",
    formatHint: "템플릿을 고르면 에이전트가 그 구성을 따라 만들어요.",
    required: "필수",
    choose: "고르세요…",
    none: "없음",
    createError: "영상을 만들지 못했어요",
    creating: "만드는 중…",
    uploading: "파일을 넣는 중…",
    downloading: "영상을 받는 중…",
    sending: "시작하는 중…",
    create: "만들고 시작하기",
    fromLink: (source) =>
      source === undefined
        ? "웹 페이지의 링크에서 가져온 요청이에요. 시작하기 전에 확인해 주세요."
        : `링크(${source})에서 가져온 요청이에요. 시작하기 전에 확인해 주세요.`,
    linkHeld: "링크로 다른 요청이 왔어요. 쓰던 내용은 그대로 뒀어요.",
    useLink: "링크 요청으로 바꾸기",
  },
};
