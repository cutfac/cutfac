import type { GalleryMessages } from "./gallery-en.tsx";

/** 갤러리 타일에 뜨는 영상의 지금 상태와, 타일에서 바로 할 수 있는 일. 해요체. */
export const galleryKo: GalleryMessages = {
  versions: (count) => (count === 1 ? "확인할 버전 1개" : `버전 ${count}개 중 고르기`),
  halted: "멈춤",
  approval: "허락을 기다려요",
  working: "작업 중",
  result: "새 결과",
  compare: "비교하러 가기",
};
