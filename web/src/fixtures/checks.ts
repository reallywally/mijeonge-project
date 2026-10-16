import type { CheckRequest } from '@/types/domain'

/* 확인 요청 — 서버 시드와 같은 넷 (docs/api/check.md '시드 · 목업'). 배열 순서가 seq 순서다.
   c3 · c4 는 한 번에 둘에게 보낸 것이다. u1 로 들어오면 받은 대기 1(c4) · 확인 1(c2), 보낸 1(c1) */
export const checkRequests: CheckRequest[] = [
  {
    id: 'c1',
    projectId: 'p1',
    targetType: 'task',
    targetId: 'k22',
    senderId: 'u1',
    recipientId: 'u3',
    text: '스테이징 DB 구성 순서 봐 주세요',
    createdAt: '2026-10-14T01:00:00Z',
    confirmedAt: null,
  },
  {
    id: 'c2',
    projectId: 'p1',
    targetType: 'thread',
    targetId: 't3',
    senderId: 'u3',
    recipientId: 'u1',
    text: '외부 모델 호출 범위 의견 주세요',
    createdAt: '2026-10-13T02:00:00Z',
    confirmedAt: '2026-10-14T05:00:00Z',
  },
  {
    id: 'c3',
    projectId: 'p1',
    targetType: 'task',
    targetId: 'k18',
    senderId: 'u2',
    recipientId: 'u4',
    text: 'in · out 정의 초안 확인 부탁해요',
    createdAt: '2026-10-15T00:30:00Z',
    confirmedAt: null,
  },
  {
    id: 'c4',
    projectId: 'p1',
    targetType: 'task',
    targetId: 'k18',
    senderId: 'u2',
    recipientId: 'u1',
    text: 'in · out 정의 초안 확인 부탁해요',
    createdAt: '2026-10-15T00:30:00Z',
    confirmedAt: null,
  },
]
