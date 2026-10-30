import { withParticle } from "../lib/korean.ts";
import type { LibraryMessages } from "./library-en.tsx";

export const libraryKo: LibraryMessages = {
  learn: {
    title: "브리프",
    description:
      "에이전트가 영상을 만들 때마다 먼저 읽는 페이지예요. 여기서 바꾸면 다음 영상부터 반영돼요.",
    sheet: {
      title: "만드는 것",
      purpose: "하는 일",
      purposeHint: "가장 가까운 걸 골라 주세요.",
      choose: "고르기",
      platforms: "올리는 곳",
      aspect: "세로, 9:16",
      bodyLabel: "에이전트에게 남길 말",
      bodyPlaceholder: "누구를 위한 영상인지, 어떤 느낌이면 좋은지, 절대 하면 안 되는 말은 뭔지.",
      saving: "저장하는 중…",
      saved: "저장했어요",
    },
    materials: "에이전트가 읽은 자료",
    materialsBody:
      "만드는 것에 관한 링크, 폴더, 파일이에요. 에이전트가 각각에서 중요한 내용을 간추려 둬요.",
    loadError: "학습한 내용을 불러오지 못했어요",
    input: "링크 또는 경로",
    placeholder: "링크나 폴더 경로를 붙여 넣거나, 파일을 끌어 놓으세요",
    submit: "추가",
    choose: "고르기…",
    dropHere: "놓으면 추가돼요",
    reading: (source) => `${source} 추가하는 중…`,
    error: "추가하지 못했어요",
    warnings: "추가했지만 확인할 점이 있어요",
    emptyBody:
      "웹사이트나 앱의 스토어 페이지로 시작해 보세요. 프로젝트 폴더나 마음에 드는 영상도 돼요.",
    unread: "아직 안 읽음",
    unreadBody:
      "에이전트가 아직 읽지 않았어요. 다음 영상을 만들기 전에 읽거나, 지금 읽기를 누르면 바로 읽어요.",
    showMore: "더 보기",
    showLess: "접기",
    nothingKept: "에이전트가 여기서 간추린 내용이 없어요.",
    readNow: "지금 읽기",
    readNowHint: (count) =>
      count === 1
        ? "에이전트가 새 자료를 지금 읽어요."
        : `에이전트가 새 자료 ${count}개를 지금 읽어요.`,
    agentReading: "에이전트가 읽는 중…",
    readingOne: "읽는 중",
    readingBody: "에이전트가 지금 읽고 있어요. 간추린 내용이 여기에 나와요.",
    readFailed: "에이전트를 시작하지 못했어요",
    noAgent: "설정에서 에이전트를 연결하면 읽을 수 있어요.",
    kinds: {
      page: "웹 페이지",
      app: "앱",
      video: "영상",
      folder: "폴더",
      file: "파일",
    },
    uploaded: "업로드한 파일",
    open: "링크 열기",
    forget: "지우기",
    forgetTitle: (title) => `${withParticle(`"${title}"`, "을/를")} 지울까요?`,
    forgetBody: "저장한 파일과 에이전트가 정리한 내용이 함께 지워져요.",
    forgetError: "지우지 못했어요",
    notesTitle: "기타 메모",
    notesBody: "about.md에서 특정 자료에 관한 게 아닌, 직접 또는 에이전트가 적은 내용이에요.",
    fileNote: "모두 워크스페이스의 about.md에 들어 있어요.",
    showFile: "파일 보기",
  },
  templates: {
    title: "템플릿",
    description:
      "에이전트가 영상을 만들 때 따르는 레시피예요. 어떤 링크에서든 가져오거나, 학습한 영상에서 뽑아낼 수 있어요.",
    loadError: "템플릿을 불러오지 못했어요",
    add: "링크로 추가",
    addTitle: "링크로 템플릿 추가",
    addBody:
      "템플릿, 스킬, 게시물 링크를 붙여 넣으세요. 에이전트가 여기서 읽고 필요한 것을 알려 줘요. '허용'을 누르기 전에는 아무것도 설치하지 않아요.",
    link: "링크",
    linkPlaceholder: "링크를 붙여 넣으세요",
    files: "파일",
    filesHint: "없어도 돼요. 여기에 끌어다 놓거나 붙여 넣어도 되고, 에이전트가 링크와 함께 받아요.",
    copyPrompt: "프롬프트 복사",
    promptCopied: "프롬프트를 복사했어요. 에이전트에 붙여 넣으세요.",
    copyFix: "수정 프롬프트 복사",
    emptyTitle: "아직 템플릿이 없어요",
    emptyBody: (link) => (
      <>
        링크로 추가하거나, 마음에 드는 {link("영상을 학습")}시킨 뒤 에이전트에게 템플릿으로 저장해
        달라고 하세요.
      </>
    ),
    missingTitle: "템플릿을 찾을 수 없어요",
    missingBody: "이름이 바뀌었거나 삭제됐을 수 있어요.",
    state: {
      ready: "사용 가능",
      incomplete: "설정 필요",
      broken: "읽을 수 없음",
    },
    incompleteTitle: "이 템플릿을 쓰려면 몇 가지가 더 필요해요",
    brokenTitle: "이 템플릿의 format.yaml을 읽을 수 없어요",
    fixHint: "수정 프롬프트를 복사해 에이전트에게 주세요.",
    duration: (min, max) => `${min}–${max}초`,
    needsAudio: "오디오 필요",
    skills: "스킬",
    installed: "설치됨",
    missing: "설치 안 됨",
    programs: "프로그램",
    source: "출처",
    author: "만든 사람",
    license: "라이선스",
    inputs: "입력값",
    inputsBody: "이 템플릿으로 새 영상을 만들 때 고르거나 적는 값이에요.",
    required: "필수",
    freeText: "직접 입력",
    default: "기본값",
    defaultValue: (value) => `기본값: ${value}`,
    structure: "구성",
    hookRules: "훅 규칙",
    checklist: "체크리스트",
  },
  imports: {
    listTitle: "가져오는 중",
    agent: "에이전트",
    start: "가져오기",
    noAgent: (link) => (
      <>
        설치된 에이전트가 없어요. {link("에이전트를 연결")}하거나, 프롬프트를 복사해 쓰던 에이전트에
        붙여 넣으세요.
      </>
    ),
    state: {
      reading: "링크를 읽는 중…",
      waiting: "확인을 기다리는 중",
      installing: "설정하는 중…",
      done: "완료",
      failed: "실패",
      stopped: "중지됨",
      closed: "닫힘",
    },
    startMessage: (link) => <>{link}에서 템플릿을 가져와 주세요</>,
    fromBrief: "브리프로 만들기",
    briefMessage: (link) =>
      link === undefined ? (
        <>브리프대로 템플릿을 만들어 주세요</>
      ) : (
        <>브리프대로 템플릿을 만들어 주세요. 참고: {link}</>
      ),
    allowed: "설치 허용함",
    allowTitle: "에이전트가 설정하도록 허용할까요?",
    allowBody:
      "허용하면 에이전트가 위에 적은 것을 설치하고 이 워크스페이스에 템플릿을 만들어요. 링크의 출처를 믿을 수 있을 때만 허용하세요.",
    allow: "허용",
    askFirst: "궁금한 점이 있으면 먼저 아래에서 물어보세요.",
    retry: "다시 시도",
    retryBody: "멈춘 곳부터 이어서 해 주세요.",
    added: "추가했어요",
    addedNothing: "아직 추가된 게 없어요",
    addedNothingBody: "남은 일이 무엇인지 아래에서 물어보거나, 다 됐으면 마치세요.",
    finish: "마치기",
    close: "가져오기 닫기",
    closedNote: "닫힌 가져오기예요.",
    placeholder: {
      waiting: "질문하거나 '허용'을 누르세요",
      working: "에이전트가 작업하는 중이에요…",
      reply: "에이전트에게 답하세요",
    },
    reply: "답장",
    loadError: "가져오기를 불러오지 못했어요",
  },
};
