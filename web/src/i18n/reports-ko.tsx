import type { ReportsMessages } from "./reports-en.tsx";

/** 오류 보고를 보낼지 묻는 문구와, 답을 바꾸는 설정, 해요체. */
export const reportsKo: ReportsMessages = {
  askTitle: "컷팩 팀에 오류 보고를 보낼까요?",
  askBody:
    "앱에서 무언가 실패하면 무엇이 어디서 실패했는지 알려서 저희가 고칠 수 있게 해요. 보고에는 오류, 앱 버전, 이 설치에 만든 ID만 담기고 영상, 프롬프트, 대화, 파일 내용, 키는 담기지 않아요. 설정에서 언제든 바꿀 수 있어요.",
  send: "오류 보고 보내기",
  dontSend: "보내지 않기",
  title: "오류 보고",
  description:
    "무엇이 어디서 실패했는지 그때그때 컷팩 팀에 보내요. 영상, 프롬프트, 대화, 파일 내용, 키는 보내지 않아요.",
  toggle: "오류 보고 보내기",
  installId: "설치 ID",
  installIdHint:
    "보내 주신 피드백과 오류 보고를 이어 보는 데 써요. 새로 만들면 이전 보고와는 이어지지 않아요.",
  newId: "새로 만들기",
  failed: "오류 보고 설정을 바꾸지 못했어요",
};
