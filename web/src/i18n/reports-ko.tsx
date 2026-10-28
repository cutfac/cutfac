import type { ReportsMessages } from "./reports-en.tsx";

/** 오류 보고와 사용 통계를 공유할지 묻는 문구와, 각각을 바꾸는 설정, 해요체. */
export const reportsKo: ReportsMessages = {
  askTitle: "컷팩 팀과 공유할까요?",
  askBody:
    "각각 컷팩을 고치고 다듬는 데 도움이 돼요. 앱 버전과 이 설치에 만든 ID만 담기고 영상, 프롬프트, 대화, 파일 내용, 경로, 키는 담기지 않아요. 설정에서 언제든 바꿀 수 있어요.",
  errorReports: "오류 보고",
  usageStats: "사용 통계",
  share: "공유하기",
  dontShare: "공유 안 함",
  title: "컷팩 팀과 공유",
  description: "영상, 프롬프트, 대화, 파일 내용, 경로, 키는 보내지 않아요. 켜 둔 것만 보내요.",
  toggle: "오류 보고 보내기",
  toggleHint: "무엇이 어디서 실패했는지 그때그때 보내요.",
  usageToggle: "사용 통계 보내기",
  usageHint: "만든 영상, 요청한 수정, 고른 버전처럼 어떤 기능을 몇 번 쓰는지만 보내요.",
  installId: "설치 ID",
  installIdHint:
    "보내 주신 피드백과 오류 보고를 이어 보는 데 써요. 새로 만들면 이전 보고와는 이어지지 않아요.",
  newId: "새로 만들기",
  failed: "공유 설정을 바꾸지 못했어요",
};
