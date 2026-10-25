import { withParticle } from "../lib/korean.ts";
import type { ToolKind } from "../lib/run.ts";
import { approvalKo } from "./approval-ko.tsx";
import type { Messages } from "./en.tsx";
import { galleryKo } from "./gallery-ko.tsx";
import { mcpKo } from "./mcp-ko.tsx";
import { onboardingKo } from "./onboarding-ko.tsx";
import { permissionsKo } from "./permissions-ko.tsx";
import { renderKo } from "./render-ko.tsx";
import { startKo } from "./start-ko.tsx";
import { trustKo } from "./trust-ko.tsx";

const TOOL_PHRASES: Record<ToolKind, (count: number) => string> = {
  read: (count) => `파일 ${count}개 읽음`,
  search: (count) => `${count}번 검색함`,
  edit: (count) => `파일 ${count}개 수정함`,
  command: (count) => `명령 ${count}개 실행함`,
  other: (count) => `도구 ${count}번 사용함`,
};

/** Korean copy, in the polite 해요체 the rest of the product uses. */
export const ko: Messages = {
  common: {
    somethingWrong: "문제가 생겼어요",
    cancel: "취소",
    close: "닫기",
    copy: "복사",
    couldNotCopy: (message) => `복사하지 못했어요: ${message}`,
  },
  app: {
    unreachable: "컷팩 서버에 연결할 수 없어요",
  },
  nav: {
    appName: "컷팩",
    openWorkspace: "워크스페이스 열기…",
    newVideo: "새 영상",
    main: "메인",
    board: "영상",
    learn: "학습",
    templates: "템플릿",
    setup: "설정",
    sendFeedback: "피드백 보내기",
    videos: "영상",
    inProgress: "진행 중",
    allVideos: "모든 영상",
    toggle: "사이드바 열고 닫기",
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
  language: {
    label: "언어",
  },
  status: {
    drafting: "제작 중",
    review: "검토",
    done: "완료",
    archived: "보관",
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
    emptyBody: "제목을 정하고 템플릿을 고르세요. 결과는 여기서 검토하고 수정을 요청하면 돼요.",
    emptyColumn: "비어 있어요",
    openFeedback: (count) => `${count}개 남음`,
    selected: "선택됨",
    selectedCount: (count) => `영상 ${count}개 선택됨`,
    learnHint: {
      title: "에이전트에게 제품을 알려 주세요",
      body: "앱이나 사이트 링크를 붙여 넣거나 프로젝트 폴더를 가리키면, 다음 영상부터 제품에 더 잘 맞춰 만들어요.",
      action: "학습하기",
      dismiss: "나중에",
    },
  },
  learn: {
    title: "학습",
    description:
      "제품, 시청자, 마음에 드는 영상을 에이전트에게 알려 주세요. 모두 about.md에 모이고, 에이전트는 영상을 만들기 전에 이 파일을 읽어요.",
    loadError: "학습한 내용을 불러오지 못했어요",
    input: "링크 또는 경로",
    placeholder: "링크나 이 컴퓨터의 폴더 경로를 붙여 넣으세요",
    submit: "학습",
    drop: "또는 파일을 여기에 끌어 놓거나 클릭해서 고르세요",
    choose: "폴더나 파일 고르기…",
    reading: (source) => `${source} 읽는 중…`,
    learned: (title) => `${withParticle(`"${title}"`, "을/를")} 학습했어요`,
    error: "학습하지 못했어요",
    warnings: "학습했지만 확인할 점이 있어요",
    emptyTitle: "아직 학습한 게 없어요",
    emptyBody:
      "앱의 스토어 페이지나 웹사이트로 시작해 보세요. 프로젝트 폴더나 마음에 드는 영상도 돼요.",
    unread: "아직 안 읽음",
    unreadHint: "에이전트가 이 내용이 필요한 작업 전에 읽어요.",
    kinds: {
      page: "웹 페이지",
      app: "앱",
      video: "영상",
      folder: "폴더",
      file: "파일",
    },
    uploaded: "업로드한 파일",
    forget: "지우기",
    forgetTitle: (title) => `${withParticle(`"${title}"`, "을/를")} 지울까요?`,
    forgetBody: "저장한 파일과 about.md의 해당 부분이 지워져요.",
    forgotten: (title) => `${withParticle(`"${title}"`, "을/를")} 지웠어요`,
    forgetError: "지우지 못했어요",
    aboutTitle: "에이전트가 아는 것",
    aboutBody: "에이전트가 읽는 about.md 그대로예요. 에이전트가 채우고, 직접 고쳐도 돼요.",
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
  },
  license: {
    title: "라이선스 키",
    description: (portal) => (
      <>
        라이선스 키를 넣으면 유료 요금제가 열려서 영상을 제한 없이 만들 수 있어요. 결제한 뒤 Polar가
        보낸 메일이나 {portal("고객 포털")}에서 찾을 수 있어요.
      </>
    ),
    label: "라이선스 키",
    placeholder: "라이선스 키를 붙여넣으세요",
    replace: "저장된 키가 있어요. 새 키를 넣으면 바뀌어요.",
    invalid: "유효하지 않은 키예요. 구매 메일이나 고객 포털에서 다시 복사해 주세요.",
    checking: "확인하는 중…",
    save: "저장",
    granted: "라이선스 키를 저장했어요.",
    ended: "라이선스 키를 저장했지만 요금제가 끝나서 무료 버전으로 쓰고 있어요.",
    unavailable: "라이선스 키를 저장했어요. cutfac.com에 연결하지 못해서 아직 확인하지 못했어요.",
  },
  plan: {
    freeTitle: "무료 버전",
    used: (used, limit) => `영상 ${limit}개 중 ${used}개 사용`,
    upgrade: "업그레이드",
    enterKey: "라이선스 키 넣기",
    openSource: "오픈소스 버전",
    getDesktop: "데스크톱 앱 받기",
    lastFree: "마지막 무료 영상이에요.",
    limitTitle: (limit) => `무료 영상 ${limit}개를 모두 만들었어요`,
    limitBody:
      "새 영상을 만들려면 업그레이드해 주세요. 지금 있는 영상은 계속 고치고 새 버전도 만들 수 있어요.",
  },
  setup: {
    title: "설정",
    description: "영상을 만들 에이전트, 에이전트가 할 수 있는 일, 파일이 있는 곳을 정해요.",
    agents: {
      claude: "Claude Code",
      codex: "Codex",
      queue: "복사해서 붙여넣기",
    },
    connectTitle: "에이전트",
    connectBody:
      "보드에서 시작한 작업은 연결하지 않아도 컷팩의 도구로 에이전트를 실행해요. 연결하면 에이전트 자체 채팅에서도 컷팩을 쓸 수 있어요.",
    agentsError: "설치된 에이전트를 확인하지 못했어요",
    workspaceTitle: "워크스페이스",
    workspaceBody:
      "컷팩이 만드는 모든 것은 이 폴더의 일반 파일이에요. 백업하거나 git에 올려도 돼요.",
    name: "이름",
    folder: "폴더",
    defaultAgent: "기본 에이전트",
    showFolder: "폴더 보기",
    connected: (agent) => `${withParticle(agent, "을/를")} 연결했어요`,
    connectFailed: (agent) => `${withParticle(agent, "을/를")} 연결하지 못했어요`,
    agentReady: "연결됐어요. 에이전트 자체 채팅에서도 컷팩의 도구를 쓸 수 있어요.",
    agentFound:
      "이 컴퓨터에 설치되어 있어요. 연결하면 에이전트 자체 채팅에서도 컷팩을 쓸 수 있어요.",
    agentMissing: "이 컴퓨터에 설치되어 있지 않아요.",
    connectedBadge: "연결됨",
    connecting: "연결하는 중…",
    connect: "연결",
    notInstalled: "설치 안 됨",
    agentOutdated: (agent, version, minimum, command) => (
      <>
        {withParticle(`${agent} ${version}`, "은/는")} 컷팩이 지원하는 최소 버전인 {minimum}보다
        낮아서 일부 기능이 제대로 동작하지 않을 수 있어요. 터미널에서 {command} 명령을 실행해
        업데이트해 주세요.
      </>
    ),
  },
  item: {
    openError: "이 영상을 열 수 없어요",
    imageHint: "이미지 위를 드래그해서 수정할 영역을 표시하세요.",
    chat: "채팅",
    checks: "점검",
    details: "상세",
    history: "히스토리",
    editing: (agent) => `${withParticle(agent, "이/가")} 편집하는 중`,
    asking: (agent) => `${withParticle(agent, "이/가")} 허락을 기다려요`,
    status: "상태",
    noMediaTitle: "아직 영상이 없어요",
    noMediaBody: "찍어 둔 영상이나 이미지가 있으면 여기에 놓으세요.",
    addMedia: "영상이나 이미지 추가",
    add: "추가",
    format: "템플릿",
    title: "제목",
    hook: "훅",
    notes: "메모",
    hookPlaceholder: "끝까지 보게 만드는 첫 문장",
    notesPlaceholder: "이 영상에 대해 기억해 둘 것",
    titleRequired: "제목은 비워 둘 수 없어요.",
  },
  layout: {
    chat: "채팅 패널",
    move: (section) => `${section} 옮기기`,
    place: (section) => `${section} 위치`,
    below: "미리보기 아래",
    left: "미리보기 왼쪽",
    right: "미리보기 오른쪽",
    leftEdge: "화면 왼쪽",
    rightEdge: "화면 오른쪽",
    swap: "순서 바꾸기",
    reset: "기본 배치로 되돌리기",
    narrow: "창이 좁아서 지금은 둘 수 없어요",
    folded: "창이 좁아서 잠시 아래로 옮겨 두었어요. 창을 넓히면 제자리로 돌아가요.",
    resize: "드래그해서 크기 조절, 더블클릭하면 원래 크기",
  },
  checks: {
    template: "템플릿",
    templateMissing: (id) => `이 워크스페이스에 "${id}" 템플릿이 없어요.`,
    checklist: "에이전트는 렌더할 때마다 이 체크리스트로 확인해요:",
    frames: "프레임 검토",
    framesBody:
      "에이전트가 각 영상을 마지막으로 확인할 때 본 화면이에요. 처음부터 끝까지의 프레임과 컷마다의 움직임이에요.",
    noReview: (file) => `${withParticle(file, "은/는")} 아직 검토하지 않았어요.`,
    noReviewHint: "에이전트는 영상을 넘기기 전에 검토해요. 지금 검토하려면 채팅으로 요청하세요.",
    reviewed: (ago) => `${ago} 검토함`,
    stale: "검토한 뒤에 영상이 바뀌었어요.",
    sheet: (file) => `${file}의 프레임`,
    strip: (time) => `${time} 전후의 움직임`,
    safeZone: ({ top, bottom, left, right }) =>
      `어둡게 칠한 가장자리(위 ${top}%, 아래 ${bottom}%, 왼쪽 ${left}%, 오른쪽 ${right}%)는 릴스, 쇼츠, 틱톡이 캡션과 버튼을 올리는 곳이에요. 중요한 내용은 여기에 두지 않아요.`,
    rules: "업로드 기준",
    rulesBody: "영상이 각 플랫폼의 업로드 기준에 맞는지 확인해요.",
    run: "점검하기",
    runAgain: "다시 점검",
    noVideos: "점검할 영상이 없어요.",
  },
  history: {
    undo: "실행 취소",
    redo: "다시 실행",
    undone: (change) => `실행 취소: ${change}`,
    redone: (change) => `다시 실행: ${change}`,
    backTo: (change) => `이 변경 직후로 이동: ${change}`,
    backToOriginal: "처음 상태로 이동",
    restoredVersion: (media) => `${media} 이전 버전 복원`,
    running: "에이전트가 이 영상을 작업하는 중이에요. 끝나거나 멈춘 뒤에 되돌릴 수 있어요.",
    emptyTitle: "아직 변경이 없어요",
    emptyBody: "편집, 되돌리기, 상세 정보 변경이 여기 쌓이고, 언제든 그 시점으로 돌아갈 수 있어요.",
    changes: "변경 기록",
    changesHint:
      "변경을 클릭하면 그 직후 상태로 돌아가요. 취소한 변경은 새로 변경하기 전까지 남아 있어요.",
    original: "처음 상태",
    originalHint: "여기 기록된 첫 변경 전",
    now: "현재",
    undoneHint: "취소됨. 클릭하면 여기까지 다시 실행해요.",
    versions: "저장된 버전",
    versionsHint: "파일마다 거쳐 온 모든 버전이에요. 복원도 실행 취소할 수 있는 변경이에요.",
    restore: "복원",
    inUse: "사용 중",
    edit: (request) => `편집 “${request}”`,
    editMedia: (media) => `${media} 편집`,
    rollback: (media) => `${media} 되돌림`,
    version: (media) => `${media} 이전 버전 복원`,
    outside: (media) => `${withParticle(media, "을/를")} 요청 밖에서 변경`,
    renamed: (title) => `제목을 “${title}”(으)로 변경`,
    moved: (status) => `상태를 ${status}(으)로 변경`,
    changed: (fields) => `${fields} 변경`,
    fields: {
      title: "제목",
      status: "상태",
      hook: "훅",
      notes: "메모",
    },
  },
  shortcuts: {
    open: "키보드 단축키",
    title: "키보드 단축키",
    description: "한 글자 단축키는 입력란에 타이핑하지 않을 때 동작해요.",
    playback: "재생",
    playPause: "재생 또는 일시정지",
    step: "0.1초 이동",
    stepLong: "1초 이동",
    selection: "선택",
    markIn: "재생 위치를 선택 시작점으로",
    markOut: "재생 위치를 선택 끝점으로",
    loop: "선택 구간 반복",
    clear: "선택 해제",
    changes: "변경",
    undo: "마지막 변경 실행 취소",
    redo: "다시 실행",
    request: "요청",
    send: "요청 보내기",
    newLine: "줄바꿈",
    help: "단축키 보기",
  },
  chat: {
    agent: "에이전트",
    rolledBack: (media) =>
      media === undefined
        ? "미디어를 이전 상태로 되돌렸어요"
        : `${withParticle(media, "을/를")} 이전 상태로 되돌렸어요`,
    editTitle: "가리키고, 말하세요",
    editBody:
      "타임라인을 드래그해서 구간을 고르거나 영상 위에 박스를 그리세요. 그다음 바꿀 내용을 쓰고 Enter를 누르면 에이전트가 편집하고, 전후를 비교할 수 있어요.",
    newTitle: "첫 버전을 요청하세요",
    newBody: "원하는 영상을 아래에 설명하면 에이전트가 첫 버전을 만들어요.",
    showTarget: "영상에서 이 부분 보기",
    newMedia: "새 미디어",
    working: "작업하는 중…",
    compacting: "대화를 압축하는 중…",
    compacted: "대화를 압축했어요",
    compactedHint: "대화가 길어져서 에이전트가 앞부분을 요약하고 이어서 작업해요.",
    stop: "중지",
    failed: "에이전트가 실패했어요.",
    stopped: "끝나기 전에 중지했어요.",
    notSent:
      "아직 에이전트에게 보내지 않았어요. 여기서 실행하거나 프롬프트를 복사해서 Claude Code나 Codex에 붙여넣으세요.",
    showSteps: (count) => `단계 ${count}개 보기`,
    toolSummary: (counts) => counts.map(({ kind, count }) => TOOL_PHRASES[kind](count)).join(", "),
    runWith: (agent) => `${agent}로 실행`,
    retryWith: (agent) => `${agent}로 다시 시도`,
    copyPrompt: "프롬프트 복사",
    connectAgent: "에이전트 연결",
    edited: (media) => (
      <>
        <span className="font-medium">{withParticle(media, "을/를")}</span> 편집했어요. 괜찮아
        보이나요?
      </>
    ),
    keep: "유지",
    restore: "이전으로 되돌리기",
    askAgain: "다시 요청",
    answerHint: (choices) =>
      choices
        ? "답을 기다려요. 하나를 고르거나 아래에 직접 적어 보내세요."
        : "답을 기다려요. 아래에 적어 보내세요.",
    kept: "유지함",
    rolledBackBadge: "되돌림",
    versionsReady: (media, saved, wanted) =>
      wanted !== undefined && wanted > saved ? (
        <>
          {media}의 버전 {wanted}개 중 {saved}개가 준비됐어요.
        </>
      ) : (
        <>
          {media}의 버전 {saved}개가 준비됐어요. 비교하고 하나를 골라 주세요.
        </>
      ),
    keepNone: "모두 버리기",
    keptNone: "모두 버림",
    keptVersion: (label) => `“${label}” 유지`,
    discarded: "버전을 모두 버렸어요. 미디어는 원래대로예요.",
    waiting: (agent, ahead) =>
      ahead === 0 ? `다음 차례 · ${agent}` : `${agent} 기다리는 중 · 앞에 ${ahead}개`,
    reword: "수정",
    save: "저장",
    cancel: "취소",
    cancelRequest: "요청 취소",
    paused: (count) => `앞선 실행이 끝나지 않아서 요청 ${count}개가 멈춰 있어요.`,
    resume: "계속",
    cancelAll: "모두 취소",
  },
  boxPrompt: {
    label: "이 박스에 대한 요청",
    hint: (agent) =>
      agent === undefined
        ? "Enter로 프롬프트 복사 · Esc로 닫기"
        : `Enter로 ${agent}에게 보내기 · Esc로 닫기`,
    send: "보내기",
  },
  pins: {
    state: {
      working: "작업 중",
      waiting: "대기 중",
      halted: "끝나지 않음",
      review: "확인 대기",
    },
    title: (number, state) => `#${number} · ${state}`,
  },
  composer: {
    queue: "프롬프트 복사",
    ideas: {
      range: ["이 부분 잘라내기", "이 부분 빠르게", "여기에 자막 넣기", "더 밝게"],
      box: ["박스 부분 확대", "이 영역 흐리게", "여기에 화살표 표시"],
      whole: ["템포를 더 빠르게", "말하는 내용에 자막 달기", "첫 1초에 시선 잡기"],
      new: ["제품을 소개하는 15초 세로 영상 만들기", "학습시킨 영상 스타일로 짧은 티저 만들기"],
    },
    placeholder: {
      range: "이 부분에서 무엇을 바꿀까요?",
      box: "박스 안에서 무엇을 바꿀까요?",
      whole: "무엇을 바꿀까요? 구간을 먼저 고르면 더 정확해요.",
      answer: "에이전트에게 보낼 답을 적으세요…",
      new: "원하는 영상을 설명하세요…",
    },
    promptCopied: "프롬프트를 복사했어요. 이 워크스페이스의 Claude Code나 Codex에 붙여넣으세요.",
    promptReady: "프롬프트를 복사할 준비가 됐어요",
    wholeVideo: "영상 전체",
    clear: "선택 해제",
    request: "편집 요청",
    agent: "보낼 에이전트",
    models: {
      label: "모델과 추론 강도",
      model: "모델",
      effort: "추론 강도",
      defaultModel: "기본 모델",
      byDefault: (pick) => (pick === undefined ? "기본" : `기본 (${pick})`),
      efforts: {
        none: "없음",
        minimal: "최소",
        low: "낮음",
        medium: "보통",
        high: "높음",
        xhigh: "매우 높음",
        max: "최대",
      },
      cacheModel: (model) =>
        `${model}(으)로 바꾸면 다음 요청 때 에이전트가 이 대화를 처음부터 다시 읽어요. 그만큼 느려지고 토큰을 더 써요.`,
      cacheEffort: (effort) =>
        `추론 강도를 ${effort}(으)로 바꾸면 다음 요청 때 에이전트가 이 대화를 처음부터 다시 읽어요. 그만큼 느려지고 토큰을 더 써요.`,
    },
    sources: {
      add: "에이전트가 읽을 폴더, 파일, 링크 추가",
      list: "에이전트가 읽는 자료",
      title: "참고 자료",
      description: "에이전트가 이 영상을 작업할 때마다 읽어요.",
      placeholder: "링크나 폴더 경로를 붙여넣으세요",
      submit: "추가",
      choose: "폴더나 파일 고르기…",
      workspace: "이 워크스페이스",
      remove: (name) => `${name} 빼기`,
    },
    versions: {
      label: "만들 버전 수",
      count: (count) => `버전 ${count}개`,
    },
    stop: "에이전트 중지",
    send: "보내기 (Enter)",
  },
  attachments: {
    drop: {
      composer: "첨부하기",
      stage: "채팅에 첨부",
      box: "박스 요청에 첨부",
      references: "참고 파일로 추가",
      media: "새 미디어로 추가",
      reply: "답장에 첨부",
      withLink: "링크와 함께 보내기",
    },
    attach: "파일 첨부",
    uploading: "올리는 중…",
    folder: (name, files) => `${name}/ · ${files}개`,
    detach: (name) => `${name} 첨부 빼기`,
    media: "미디어",
    references: "참고 파일",
    referencesEmpty: "에이전트가 쓸 파일을 여기에 놓으세요",
    attachTile: (name) => `${withParticle(name, "을/를")} 채팅에 첨부`,
    remove: (name) => `${name} 삭제`,
    removed: "삭제했어요",
    undo: "되돌리기",
  },
  compare: {
    open: "비교",
    title: "전후 비교",
    before: "이전",
    after: "이후",
    image: (media, side) => `${media ?? "미디어"}, ${side}`,
    playBoth: (time) => `${time}부터 함께 재생`,
    restore: "이전으로 되돌리기",
    keep: "편집 유지",
  },
  versions: {
    title: "버전 비교",
    now: "지금",
    use: "이걸로",
    playAll: (time) => `${time}부터 모두 재생`,
  },
  transport: {
    play: "재생",
    pause: "일시정지",
    in: "시작",
    inHint: "재생 위치를 선택 시작점으로",
    out: "끝",
    outHint: "재생 위치를 선택 끝점으로",
    loop: "선택 구간 반복",
    loopHint: "선택 구간을 계속 반복 재생",
    hint: "타임라인을 드래그해 구간 선택 · 영상 위를 드래그해 영역 표시",
  },
  target: {
    boxAt: (time) => `${time} 박스`,
    box: (time) => `박스 · ${time}`,
    boxMarker: (time) => `${time} 박스`,
    goToBox: "이 박스가 있는 프레임으로 이동",
    removeBox: "박스 지우기",
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
  },
  onboarding: onboardingKo,
  start: startKo,
  trust: trustKo,
  mcp: mcpKo,
  permissions: permissionsKo,
  gallery: galleryKo,
  render: renderKo,
  approval: approvalKo,
};
