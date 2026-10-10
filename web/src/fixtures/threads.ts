import type { Entry, Thread } from '@/types/domain'

/**
 * 안건과 그 이력. Entry 하나가 안건에 남긴 한 줄이다.
 * 시나리오 1 의 "PM 으로부터 우분투 최신버전이라 전달받음" 처럼 담당자 확인만으로 정한 것도 같은 줄이다.
 */

export const threads: Thread[] = [
  // 시나리오 1 — 개발 환경 설정 작업에서 갈라져 나온 둘
  {
    id: 't1',
    projectId: 'p1',
    title: '서버 OS 결정',
    description:
      '개발 환경 설정 작업에서 서버 OS가 정해지지 않아 서버 구성을 시작하지 못하고 있다.',
    options: ['우분투', '록키', 'CentOS'],
    dueDate: '2026-09-12',
    state: 'decided',
    ownerId: 'u3',
    parentThreadId: null,
    createdAt: '2026-09-08T00:30:00Z',
  },
  {
    id: 't2',
    projectId: 'p1',
    title: 'DB 결정',
    description: '개발 환경 설정 작업의 DB 선택. 기존 솔루션과의 호환성과 비용을 같이 봐야 한다.',
    options: ['PostgreSQL', 'MySQL', 'Supabase'],
    dueDate: '2026-09-15',
    state: 'decided',
    ownerId: 'u3',
    parentThreadId: null,
    createdAt: '2026-09-08T00:35:00Z',
  },
  {
    id: 't3',
    projectId: 'p1',
    title: '사내망에서 외부 모델 호출 허용 범위',
    description:
      '가상비서가 외부 LLM API를 불러야 하는데 사내망 보안 정책상 어디까지 허용되는지 정해지지 않았다.',
    options: ['전면 허용', '비식별 데이터만 허용', '사내 모델만 사용'],
    dueDate: '2026-09-30',
    state: 'open',
    ownerId: 'u1',
    parentThreadId: null,
    createdAt: '2026-09-09T02:10:00Z',
  },
  {
    id: 't4',
    projectId: 'p1',
    title: '개발 서버 백업 주기',
    description: '',
    options: [],
    dueDate: null,
    state: 'queued',
    ownerId: null,
    parentThreadId: null,
    createdAt: '2026-09-10T06:20:00Z',
  },
  // 시나리오 2 — 두 번 미뤄진 안건
  {
    id: 't5',
    projectId: 'p1',
    title: '보험료 산출 기간계 API 호출 in · out 정의',
    description:
      '보험료 산출 기간계 API 개발 중 호출에 필요한 in · out 정의가 없어 개발이 멈췄다. 기간계 업무 정의가 먼저 나와야 한다.',
    options: [],
    dueDate: '2026-10-19',
    state: 'open',
    ownerId: 'u4',
    parentThreadId: null,
    createdAt: '2026-09-07T00:10:00Z',
  },
  // 시나리오 3 — 한 번에 정해진 안건
  {
    id: 't6',
    projectId: 'p1',
    title: '일정 조율 — 전체 일정을 미룰지, 테스트 기간을 줄일지',
    description: '',
    options: [],
    dueDate: null,
    state: 'decided',
    ownerId: 'u1',
    parentThreadId: null,
    createdAt: '2026-09-14T01:00:00Z',
  },
  {
    id: 't7',
    projectId: 'p1',
    title: '가상비서 tool 만드는 순서',
    description: '',
    options: [],
    dueDate: null,
    state: 'queued',
    ownerId: 'u4',
    parentThreadId: null,
    createdAt: '2026-09-12T05:40:00Z',
  },
  {
    id: 't8',
    projectId: 'p1',
    title: 'AI 심사 학습 데이터 범위',
    description: '',
    options: [],
    dueDate: null,
    state: 'queued',
    ownerId: 'u1',
    parentThreadId: null,
    createdAt: '2026-09-12T05:45:00Z',
  },
  {
    id: 't9',
    projectId: 'p1',
    title: '공통 코드 체계 확정',
    description: '',
    options: [],
    dueDate: null,
    state: 'queued',
    ownerId: 'u2',
    parentThreadId: null,
    createdAt: '2026-09-15T00:20:00Z',
  },
  // 다른 프로젝트 — 프로젝트를 바꾸면 화면이 갈리는지 보려고 둔다
  {
    id: 't10',
    projectId: 'p2',
    title: '이관 범위 확정',
    description: '',
    options: [],
    dueDate: null,
    state: 'queued',
    ownerId: 'u2',
    parentThreadId: null,
    createdAt: '2026-09-16T01:05:00Z',
  },
]

/**
 * 안건에 남긴 줄. **배열 순서가 등록 순서다** (오래된 것 → 새 것, API.md Q4).
 *
 * 같은 날 같은 안건에 남긴 줄들은 날짜가 같아서 이 순서로 가른다.
 * id 는 순서가 아니다 — 서버가 UUID 를 주면 사전순이 등록순과 무관해진다.
 */
export const entries: Entry[] = [
  // 시나리오 2 — 첫 번째 미룸
  {
    id: 'e2',
    threadId: 't5',
    kind: 'defer',
    text: '이번 회의에서는 정하지 못했다',
    detail: [],
    note: '기간계 업무 정의가 안 돼 in · out 을 정할 수 없다. 다음 주 월요일에 다시 본다.',
    ownerId: 'u4',
    createdAt: '2026-09-07T07:30:00Z',
  },
  // 시나리오 1 — 공유가 안 됐을 뿐 이미 정해져 있던 것
  {
    id: 'e1',
    threadId: 't1',
    kind: 'decide',
    text: '우분투 최신 버전으로 한다',
    detail: [],
    note: 'PM 에게 전달받아 이도현이 정리했다. 회의로 다루지 않았다.',
    ownerId: 'u3',
    createdAt: '2026-09-09T02:00:00Z',
  },
  // 시나리오 1 — 함께 보고 정한 것
  {
    id: 'e3',
    threadId: 't2',
    kind: 'decide',
    text: 'mysql 을 쓴다',
    detail: ['postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺀다', 'supabase 는 비용 때문에 뺀다'],
    note: '',
    ownerId: 'u3',
    createdAt: '2026-09-10T06:05:00Z',
  },
  {
    id: 'e4',
    threadId: 't3',
    kind: 'defer',
    text: '이번 회의에서는 정하지 못했다',
    detail: [],
    note: '정보보안팀 확인이 먼저다. 다음 회의 후보로 올려 둔다.',
    ownerId: 'u1',
    createdAt: '2026-09-10T06:08:00Z',
  },
  // 시나리오 2 — 두 번째 미룸
  {
    id: 'e5',
    threadId: 't5',
    kind: 'defer',
    text: '여전히 업무 정의가 없어 또 미룬다',
    detail: [],
    note: '두 번째 미룸이다. 다음에는 기간계 담당자를 회의에 부르기로 했다.',
    ownerId: 'u4',
    createdAt: '2026-09-14T07:10:00Z',
  },
  // 시나리오 3
  {
    id: 'e6',
    threadId: 't6',
    kind: 'decide',
    text: '전체 일정은 그대로 두고 테스트 기간만 2주 줄인다',
    detail: ['늘어난 개발 기간은 그대로 둔다', '통합 테스트를 3주에서 1주로 줄인다'],
    note: '일정을 미루면 오픈 일정이 밀린다는 데에 이견이 없었다.',
    ownerId: 'u1',
    createdAt: '2026-09-15T07:00:00Z',
  },
]
