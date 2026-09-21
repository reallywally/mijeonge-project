import type { Entry, Thread } from '@/types/domain'

/**
 * 안건과 그 이력.
 *
 * Entry 하나가 (회의 × 안건) 한 줄이다. meetingId 가 null 이면 회의 없이 담당자 확인으로
 * 처리한 줄이다 — 시나리오 1 의 "PM 으로부터 우분투 최신버전이라 전달받음" 이 그것이다.
 */

export const threads: Thread[] = [
  // 시나리오 1 — 개발 환경 설정 작업에서 갈라져 나온 둘
  {
    id: 't1',
    projectId: 'p1',
    title: '서버 OS 결정',
    state: 'decided',
    ownerId: 'u3',
    parentThreadId: null,
    createdAt: '2026-09-08',
  },
  {
    id: 't2',
    projectId: 'p1',
    title: 'DB 결정',
    state: 'decided',
    ownerId: 'u3',
    parentThreadId: null,
    createdAt: '2026-09-08',
  },
  {
    id: 't3',
    projectId: 'p1',
    title: '사내망에서 외부 모델 호출 허용 범위',
    state: 'open',
    ownerId: 'u1',
    parentThreadId: null,
    createdAt: '2026-09-09',
  },
  {
    id: 't4',
    projectId: 'p1',
    title: '개발 서버 백업 주기',
    state: 'queued',
    ownerId: null,
    parentThreadId: null,
    createdAt: '2026-09-10',
  },
  // 시나리오 2 — 두 번 미뤄진 안건
  {
    id: 't5',
    projectId: 'p1',
    title: '보험료 산출 기간계 API 호출 in · out 정의',
    state: 'open',
    ownerId: 'u4',
    parentThreadId: null,
    createdAt: '2026-09-07',
  },
  // 시나리오 3 — 회의만으로 끝난 안건
  {
    id: 't6',
    projectId: 'p1',
    title: '일정 조율 — 전체 일정을 미룰지, 테스트 기간을 줄일지',
    state: 'decided',
    ownerId: 'u1',
    parentThreadId: null,
    createdAt: '2026-09-14',
  },
  {
    id: 't7',
    projectId: 'p1',
    title: '가상비서 tool 만드는 순서',
    state: 'queued',
    ownerId: 'u4',
    parentThreadId: null,
    createdAt: '2026-09-12',
  },
  {
    id: 't8',
    projectId: 'p1',
    title: 'AI 심사 학습 데이터 범위',
    state: 'queued',
    ownerId: 'u1',
    parentThreadId: null,
    createdAt: '2026-09-12',
  },
  {
    id: 't9',
    projectId: 'p1',
    title: '공통 코드 체계 확정',
    state: 'queued',
    ownerId: 'u2',
    parentThreadId: null,
    createdAt: '2026-09-15',
  },
  // 다른 프로젝트 — 프로젝트를 바꾸면 화면이 갈리는지 보려고 둔다
  {
    id: 't10',
    projectId: 'p2',
    title: '이관 범위 확정',
    state: 'queued',
    ownerId: 'u2',
    parentThreadId: null,
    createdAt: '2026-09-16',
  },
]

export const entries: Entry[] = [
  // 시나리오 1 — 회의 밖 처리. 공유가 안 됐을 뿐 이미 정해져 있던 것
  {
    id: 'e1',
    threadId: 't1',
    meetingId: null,
    kind: 'decide',
    text: '우분투 최신 버전으로 한다',
    detail: [],
    note: 'PM 에게 전달받아 이도현이 정리했다. 회의로 다루지 않았다.',
    ownerId: 'u3',
    createdAt: '2026-09-09',
  },
  // 시나리오 2 — 첫 번째 미룸
  {
    id: 'e2',
    threadId: 't5',
    meetingId: 'm2',
    kind: 'defer',
    text: '이번 회의에서는 정하지 못했다',
    detail: [],
    note: '기간계 업무 정의가 안 돼 in · out 을 정할 수 없다. 다음 주 월요일에 다시 본다.',
    ownerId: 'u4',
    createdAt: '2026-09-07',
  },
  // 시나리오 1 — 회의에서 정한 것
  {
    id: 'e3',
    threadId: 't2',
    meetingId: 'm3',
    kind: 'decide',
    text: 'mysql 을 쓴다',
    detail: ['postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺀다', 'supabase 는 비용 때문에 뺀다'],
    note: '',
    ownerId: 'u3',
    createdAt: '2026-09-10',
  },
  {
    id: 'e4',
    threadId: 't3',
    meetingId: 'm3',
    kind: 'defer',
    text: '이번 회의에서는 정하지 못했다',
    detail: [],
    note: '정보보안팀 확인이 먼저다. 다음 회의 후보로 올려 둔다.',
    ownerId: 'u1',
    createdAt: '2026-09-10',
  },
  // 시나리오 2 — 두 번째 미룸
  {
    id: 'e5',
    threadId: 't5',
    meetingId: 'm5',
    kind: 'defer',
    text: '여전히 업무 정의가 없어 또 미룬다',
    detail: [],
    note: '두 번째 미룸이다. 다음에는 기간계 담당자를 회의에 부르기로 했다.',
    ownerId: 'u4',
    createdAt: '2026-09-14',
  },
  // 시나리오 3
  {
    id: 'e6',
    threadId: 't6',
    meetingId: 'm6',
    kind: 'decide',
    text: '전체 일정은 그대로 두고 테스트 기간만 2주 줄인다',
    detail: ['늘어난 개발 기간은 그대로 둔다', '통합 테스트를 3주에서 1주로 줄인다'],
    note: '일정을 미루면 오픈 일정이 밀린다는 데에 이견이 없었다.',
    ownerId: 'u1',
    createdAt: '2026-09-15',
  },
]
