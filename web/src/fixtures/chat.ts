import type { ChatEvent, TaskProposal } from '@/types/domain'

type ToolEvent = Extract<ChatEvent, { type: 'tool' }>

export interface MockChatReply {
  /** 마지막 질문에 이 중 하나가 들어 있으면 이 답을 낸다 */
  keywords: string[]
  tools: Omit<ToolEvent, 'type'>[]
  answer: string
  /** 작업을 만들어 달라는 말이면 초안을 같이 낸다 — 서버처럼 답 본문은 짧게 */
  proposal?: TaskProposal
}

/* 작업 초안 예시 — "간담회 준비 작업 만들어줘. 김서연한테 일정체크, 박지훈한테 준비물 체크" */
const meetupProposal = (packOwnerId: string): TaskProposal => ({
  tasks: [
    {
      tempId: 't1',
      parentTempId: null,
      parentId: null,
      title: '간담회 준비',
      ownerId: null,
      start: null,
      due: null,
      priority: 'normal',
    },
    {
      tempId: 't2',
      parentTempId: 't1',
      parentId: null,
      title: '일정 체크',
      ownerId: 'u1',
      start: '2026-10-13',
      due: '2026-10-16',
      priority: 'high',
    },
    {
      tempId: 't3',
      parentTempId: 't1',
      parentId: null,
      title: '준비물 체크',
      ownerId: packOwnerId,
      start: null,
      due: null,
      priority: 'normal',
    },
  ],
})

const proposeTools: MockChatReply['tools'] = [
  { name: 'list_members', label: '멤버 확인 중' },
  { name: 'propose_tasks', label: '작업 초안 만드는 중' },
]

/*
 * 목업 챗봇의 답. 서버 없이 화면을 만들려는 것이라 질문을 이해하지 않고 낱말로만 고른다.
 * 근거 표시(`[[thread:ID]]`)는 칩(7-3)이 생기면 넣는다 — 지금 넣으면 글자 그대로 보인다.
 */
export const chatReplies: MockChatReply[] = [
  {
    keywords: ['OS', 'os', '운영체제'],
    tools: [
      { name: 'search_threads', label: '‘OS’ 안건 찾는 중' },
      { name: 'get_thread', label: '‘서버 OS 결정’ 이력 읽는 중' },
    ],
    answer:
      '서버 OS 는 우분투 최신 버전으로 정해졌습니다.\n' +
      '‘서버 OS 결정’ 안건에 2026-09-09 결정으로 남아 있고, PM 에게 전달받아 이도현이 정리했습니다.\n' +
      '후보였던 록키 · CentOS 는 고르지 않았습니다.',
  },
  {
    keywords: ['안 정해진', '안정해진', '미정', '아직'],
    tools: [{ name: 'search_threads', label: '결정 전 안건 찾는 중' }],
    answer:
      '아직 정해지지 않은 안건은 이렇습니다.\n' +
      '- 사내망에서 외부 모델 호출 허용 범위 — 한 번 미뤘습니다. 정보보안팀 확인이 먼저입니다.\n' +
      '- 보험료 산출 기간계 API 호출 in · out 정의 — 두 번 미뤘습니다. 업무 정의가 아직 없습니다.\n' +
      '- 개발 서버 백업 주기 · 가상비서 tool 만드는 순서 · AI 심사 학습 데이터 범위 · 공통 코드 체계 확정 — 등록만 되어 있습니다.',
  },
  {
    keywords: ['막힌', '막힘', 'blocked'],
    tools: [{ name: 'search_tasks', label: '막힌 작업 찾는 중' }],
    answer:
      '막힌 작업은 HW-18 보험료 산출 기간계 API 개발 하나입니다.\n' +
      '연결된 안건 ‘보험료 산출 기간계 API 호출 in · out 정의’ 가 아직 정해지지 않아 멈춰 있습니다.',
  },
  {
    keywords: ['만들어', '등록해', '추가해'],
    tools: proposeTools,
    answer: '‘간담회 준비’ 아래에 작업 둘을 두었습니다. 아래처럼 등록할까요?',
    proposal: meetupProposal('u2'),
  },
  {
    keywords: ['말고', '바꿔'],
    tools: proposeTools,
    answer: '준비물 체크 담당을 정하늘로 바꿨습니다. 아래처럼 등록할까요?',
    proposal: meetupProposal('u4'),
  },
]

export const chatFallback: MockChatReply = {
  keywords: [],
  tools: [{ name: 'search_threads', label: '안건 찾는 중' }],
  answer:
    '저장된 안건 · 작업에서 그 내용을 찾지 못했습니다.\n' +
    '목업 모드에서는 예시 질문에만 답합니다.',
}

/** 이 낱말이 들어 있으면 목업이 스트림 중 오류(error 이벤트)를 낸다 — 오류 줄을 화면에서 보려고 */
export const CHAT_MOCK_ERROR_KEYWORD = '오류 내 줘'

/** 계약의 챗봇 code 중 스트림 중에 날 수 있는 것 (API.md '오류' 표) */
export const chatMockError = {
  code: 'CHAT_UNAVAILABLE',
  message: '답을 만들지 못했습니다. 잠시 뒤 다시 물어 주세요.',
}
