import { withParticle } from "../lib/korean.ts";
import type { StartMessages } from "./start-en.tsx";

/** 브리프와 첫 템플릿 문구, 해요체. */
export const startKo: StartMessages = {
  brief: {
    purpose: {
      promote: {
        title: "사업을 해요",
        hint: "제품, 앱, 가게, 서비스",
        example: "예: 대학생을 위한 가계부 앱. 밝고 친근하게.",
        short: "홍보",
      },
      tips: {
        title: "노하우를 나눠요",
        hint: "전문 지식, 팁, 강의",
        example: "예: 바쁜 사람을 위한 간단 요리 팁.",
        short: "정보·팁",
      },
      brand: {
        title: "크리에이터예요",
        hint: "내 일상, 생각, 이야기",
        example: "예: 디자이너의 하루를 담담하게 보여줘요.",
        short: "퍼스널 브랜드",
      },
      own: {
        title: "다른 일을 해요",
        hint: "직접 설명할게요",
        example: "예: 우리 밴드 노래의 가사 영상.",
        short: "직접 설명",
      },
    },
    bodyLabel: "에이전트가 알아야 할 게 있나요?",
    ownBodyLabel: "무엇을 만들고 싶나요?",
    platformsLabel: "어디에 올리나요?",
    platformsHint: "여러 개 골라도 돼요. 화면 비율과 길이가 여기에 맞춰져요.",
    platform: {
      tiktok: "틱톡",
      shorts: "유튜브 쇼츠",
      reels: "인스타그램 릴스",
      other: "기타",
    },
    platformShort: {
      tiktok: "틱톡",
      shorts: "쇼츠",
      reels: "릴스",
      other: "기타",
    },
    saveFailed: (message) => `브리프를 저장하지 못했어요: ${message}`,
  },
  whatToMake: {
    title: "무슨 일을 하나요?",
    body: "에이전트가 영상을 만들 때마다 먼저 읽어요. 나중에 사이드바의 브리프에서 언제든 바꿀 수 있어요.",
    details: {
      title: "에이전트가 더 알아야 할 게 있나요?",
      body: "떠오르는 건 뭐든 적어 주세요. 길고 자세해도 괜찮고, 비워 둬도 돼요.",
      ownBody: "떠오르는 건 뭐든 적어 주세요. 길고 자세해도 괜찮아요.",
    },
    material: {
      website: {
        title: "에이전트가 읽을 웹사이트가 있나요?",
        body: "제품 페이지나 앱 소개 페이지처럼요. 나중에 브리프에서 더 넣을 수 있어요.",
      },
      folder: {
        title: "에이전트가 읽을 폴더가 있나요?",
        body: "브랜드 키트나 영상 소재처럼요. 그 자리에 둔 채로 읽고, 나중에 브리프에서 더 넣을 수 있어요.",
      },
      placeholder: "yourwebsite.com",
      choose: "폴더를 골라 주세요",
      browse: "찾아보기…",
      remove: (source) => `${source} 빼기`,
    },
    next: "다음",
    back: "이전",
    skipPart: "건너뛰기",
    start: "만들기 시작",
    starting: "시작하는 중…",
    learnFailed: (source, message) => `${withParticle(source, "을/를")} 읽지 못했어요: ${message}`,
  },
  notify: {
    link: "알림 켜기",
    sample: { title: "컷팩", body: "에이전트가 기다리면 이렇게 알려 드릴게요." },
  },
  sample: {
    gettingReady: "에이전트가 준비하고 있어요.",
    ready: "에이전트가 준비됐어요.",
    title: "먼저 샘플을 만져 보세요",
    body: "짧은 샘플 영상을 말로 고쳐 보세요.",
    moods: { bold: "강렬함", calm: "차분함", playful: "발랄함" },
    reading: "에이전트가 뒤에서 자료를 읽고 있어요 · 기다리지 않아도 돼요",
    read: "에이전트가 다 읽었어요. 첫 영상 아이디어가 준비돼 있어요",
    adding: "샘플을 가져오는 중…",
    skip: "건너뛰고 바로 만들기",
    videoTitle: (title) => `샘플: ${title}`,
    failed: (message) => `샘플을 가져오지 못했어요: ${message}`,
  },
  saving: {
    title: "작업 공간을 준비하고 있어요",
    body: "알려 주신 내용을 에이전트가 읽을 수 있게 저장하는 중…",
  },
};
