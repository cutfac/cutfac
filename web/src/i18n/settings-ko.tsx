import { withParticle } from "../lib/korean.ts";
import type { SettingsMessages } from "./settings-en.tsx";

export const settingsKo: SettingsMessages = {
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
};
