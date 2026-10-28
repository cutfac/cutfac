import type { ShellMessages } from "./shell-en.tsx";

export const shellKo: ShellMessages = {
  common: {
    somethingWrong: "문제가 생겼어요",
    cancel: "취소",
    close: "닫기",
    copy: "복사",
    couldNotCopy: (message) => `복사하지 못했어요: ${message}`,
  },
  app: {
    unreachable: "컷팩 서버에 연결할 수 없어요",
    quitting: "컷팩을 종료하고 있어요",
    quittingDetail: "로컬 서버와 에이전트 작업을 멈추고 있어요. 잠시 걸릴 수 있어요.",
  },
  nav: {
    appName: "컷팩",
    openWorkspace: "워크스페이스 열기…",
    newVideo: "새 영상",
    main: "메인",
    board: "영상",
    learn: "브리프",
    templates: "템플릿",
    setup: "설정",
    sendFeedback: "피드백 보내기",
    resize: "사이드바 너비 조절",
    videos: "영상",
    inProgress: "진행 중",
    allVideos: "모든 영상",
    toggle: "사이드바 열고 닫기",
    back: "뒤로",
    forward: "앞으로",
    waiting: (count) => `확인할 영상 ${count}개`,
    videoTitle: (title, status, state) =>
      state === undefined ? `${title} (${status})` : `${title} (${status}, ${state})`,
  },
  palette: {
    title: "명령 팔레트",
    description: "영상, 페이지, 명령을 찾아요.",
    placeholder: "영상과 명령 검색…",
    empty: "맞는 항목이 없어요.",
    thisVideo: "이 영상",
    actions: "작업",
    goTo: "이동",
  },
  language: {
    label: "언어",
  },
  teamFeedback: {
    title: "피드백 보내기",
    description:
      "버그, 헷갈렸던 부분, 있었으면 하는 기능을 컷팩 팀에 알려주세요. 모든 메시지를 직접 읽어요.",
    messageLabel: "내용",
    placeholder: "무슨 일이 있었는지, 무엇이 있으면 좋을지 적어주세요",
    emailLabel: "답장 받을 이메일",
    emailHint: "선택이에요. 비워두면 익명으로 보내져요.",
    send: "보내기",
    failed: "피드백을 보내지 못했어요",
    sent: "고마워요! 피드백이 컷팩 팀에 전달됐어요.",
    slashHint: "/feedback 뒤의 내용은 에이전트가 아니라 컷팩 팀에 전달돼요.",
    slashEmpty: "/feedback 뒤에 전할 내용을 적어주세요.",
    logsHint:
      "로그에는 앱이 최근에 한 일과 오류가 담겨 원인을 찾는 데 도움이 돼요. 영상, 프롬프트, 대화, 키는 들어가지 않아요.",
    showLogs: "보내는 내용 보기",
    recentErrors: (count: number) =>
      `최근에 오류가 ${count}번 있었어요. 로그를 함께 보내면 원인을 훨씬 빨리 찾을 수 있어요.`,
    sendWithLog: "로그와 함께 보내기",
    sendWithoutLog: "로그 없이 보내기",
  },
};
