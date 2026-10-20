import type { Minutes, MinutesDraft } from '@/types/domain'

/*
 * 회의록 — docs/api/minutes.md '시드 · 목업'.
 * MINUTES_EXAMPLE 은 시드 회의록 m1 의 본문이자 [새 회의록] 의 [예시 넣기] 글이다. 서버 시드가 글자 그대로 복사해 간다 — 바꾸지 않는다.
 * 목업 draft 는 회의록과 상관없이 mockMinutesDraft 를 낸다. quote 는 예시 글에서 글자 그대로 따왔다.
 */

export const MINUTES_EXAMPLE = `[한화손보 차세대] 주간 회의록

일시: 2026년 10월 16일(금) 14:00 ~ 15:00
장소: 본사 7층 소회의실
참석: 김서연, 박지훈, 이도현, 정하늘 / 기간계팀 최 선임(일부 참석)
작성: 정하늘

1. 지난 회의 후속
- 개발 서버 우분투 설치, 개발자 계정 배포 끝남(이도현).

2. 사내망 외부 모델 호출 허용 범위
- 정보보안팀 회신이 아직 없어 이번 회의에서도 정하지 못함.
- 다음 주 수요일 보안 검토 회의 결과를 보고 다시 논의하기로 함(담당 김서연).

3. 운영 DB 구성
- MySQL 로 정한 대로 운영 DB 도 같은 버전으로 구성.
- 계정 · 권한은 이도현 님이 10월 21일까지 표로 만들어 공유하기로 함.

4. 가상비서 대화 로그 보관 기간
- 대화 로그에 고객 개인정보가 섞일 수 있어 보관 기간을 정해야 한다는 의견.
- 후보는 30일 / 90일 / 1년. 법무 검토 의견을 받아 10월 30일까지 정하기로 함. 담당은 정하늘 님.
- 정하늘 님이 다음 주 목요일까지 지금 쌓이고 있는 대화 로그 현황을 조사해 오기로 함.

5. 기간계 테스트 데이터 마스킹
- 통합 테스트에 쓸 기간계 데이터를 어디까지 가릴지 논의. 전 항목 마스킹 vs 주민번호 · 연락처만 마스킹.
- 기간계팀 마스킹 기준 문서를 받은 뒤 다시 보기로 하고 이번에는 보류. 문서는 박지훈 님이 기간계팀에 요청해 둠.

6. 기타
- 통합 테스트 시나리오 초안은 최 선임이 10월 28일까지 공유해 주기로 함.

다음 회의: 2026년 10월 23일(금) 14:00
`

/** 시드 회의록 — p1 · 작성자 u1 · 요약 없음 · 출처를 단 줄 없음. 시연에서 [AI 정리] 를 바로 누를 수 있다 */
export const minutesRows: Minutes[] = [
  {
    id: 'm1',
    projectId: 'p1',
    title: '10월 셋째 주 주간 회의',
    meetingDate: '2026-10-16',
    authorId: 'u1',
    createdAt: '2026-10-16T06:30:00Z',
    updatedAt: '2026-10-16T06:30:00Z',
    body: MINUTES_EXAMPLE,
    summary: '',
  },
]

/** p1 기준 — 새 안건 2(n2 는 미룸 이력) · 기존 안건 t3 에 미룸 1 · 작업 3(n1 에 · t2 에 · ownerHint 만) */
export const mockMinutesDraft: MinutesDraft = {
  meetingDate: '2026-10-16',
  summary:
    '정보보안팀 회신이 없어 외부 모델 호출 허용 범위는 이번에도 미뤘다.\n' +
    '운영 DB 는 MySQL 같은 버전으로 구성하고, 계정 · 권한 표를 10월 21일까지 만든다.\n' +
    '가상비서 대화 로그 보관 기간을 새 안건으로 올렸다 — 10월 30일까지 정한다.\n' +
    '기간계 테스트 데이터 마스킹 범위는 기간계팀 기준 문서를 받은 뒤 다시 본다.',
  threads: [
    {
      tempId: 'n1',
      title: '가상비서 대화 로그 보관 기간',
      description:
        '대화 로그에 고객 개인정보가 섞일 수 있어 보관 기간을 정해야 한다. 법무 검토 의견을 받아 정한다.',
      options: ['30일', '90일', '1년'],
      ownerId: 'u4',
      ownerHint: '',
      dueDate: '2026-10-30',
      entry: null,
      quote:
        '후보는 30일 / 90일 / 1년. 법무 검토 의견을 받아 10월 30일까지 정하기로 함. 담당은 정하늘 님.',
    },
    {
      tempId: 'n2',
      title: '기간계 테스트 데이터 마스킹 범위',
      description: '통합 테스트에 쓸 기간계 데이터를 어디까지 가릴지.',
      options: ['전 항목 마스킹', '주민번호 · 연락처만 마스킹'],
      ownerId: 'u2',
      ownerHint: '',
      dueDate: null,
      entry: {
        kind: 'defer',
        text: '기간계팀 마스킹 기준 문서를 받은 뒤 다시 본다',
        detail: [],
        note: '기간계팀 기준 문서가 아직 없다. 박지훈이 기간계팀에 요청해 두었다.',
        ownerId: 'u2',
        ownerHint: '',
      },
      quote: '기간계팀 마스킹 기준 문서를 받은 뒤 다시 보기로 하고 이번에는 보류.',
    },
  ],
  entries: [
    {
      tempId: 'e1',
      threadId: 't3',
      kind: 'defer',
      text: '정보보안팀 회신이 없어 이번에도 정하지 못했다',
      detail: [],
      note: '다음 주 수요일 보안 검토 회의 결과를 보고 다시 논의한다.',
      ownerId: 'u1',
      ownerHint: '',
      quote: '정보보안팀 회신이 아직 없어 이번 회의에서도 정하지 못함.',
    },
  ],
  tasks: [
    {
      tempId: 't1',
      parentTempId: null,
      parentId: null,
      title: '가상비서 대화 로그 현황 조사',
      ownerId: 'u4',
      ownerHint: '',
      start: null,
      due: '2026-10-22',
      priority: 'normal',
      threadTempIds: ['n1'],
      threadIds: [],
      quote: '정하늘 님이 다음 주 목요일까지 지금 쌓이고 있는 대화 로그 현황을 조사해 오기로 함.',
    },
    {
      tempId: 't2',
      parentTempId: null,
      parentId: null,
      title: '운영 DB 계정 · 권한 표 작성',
      ownerId: 'u3',
      ownerHint: '',
      start: null,
      due: '2026-10-21',
      priority: 'normal',
      threadTempIds: [],
      threadIds: ['t2'],
      quote: '계정 · 권한은 이도현 님이 10월 21일까지 표로 만들어 공유하기로 함.',
    },
    {
      tempId: 't3',
      parentTempId: null,
      parentId: null,
      title: '통합 테스트 시나리오 초안 공유',
      /* 최 선임은 기간계팀 사람이라 멤버에 없다 — 비우고 부른 말을 남긴다 */
      ownerId: null,
      ownerHint: '최 선임',
      start: null,
      due: '2026-10-28',
      priority: 'normal',
      threadTempIds: [],
      threadIds: [],
      quote: '통합 테스트 시나리오 초안은 최 선임이 10월 28일까지 공유해 주기로 함.',
    },
  ],
}

/** 목업 draft 가 초안 앞에 흘리는 진행 줄 둘 — 라벨은 서버의 것과 같은 모양(minutes.md '구현') */
export const mockMinutesTools: { name: string; label: string }[] = [
  { name: 'search_threads', label: '"대화 로그" 기존 안건 찾는 중' },
  { name: 'list_members', label: '멤버 확인 중' },
]
