import type { CheckRequest } from '@/types/domain'

/* 확인 요청 — 서버 시드와 같은 넷 (docs/api/check.md '시드 · 목업'). 배열 순서가 seq 순서다.
   c1 ~ c3 은 t2 의 결정(e3)을 한 번에 셋에게 보낸 것이다. u1 로 들어오면 받은 대기 1(c4),
   보낸 것 한 묶음(t2, 3명 중 1명 확인). t6 은 아직 안 보냈다 */
export const checkRequests: CheckRequest[] = [
  {
    id: 'c1',
    projectId: 'p1',
    threadId: 't2',
    entryId: 'e3',
    senderId: 'u1',
    recipientId: 'u3',
    createdAt: '2026-10-14T01:00:00Z',
    confirmedAt: null,
  },
  {
    id: 'c2',
    projectId: 'p1',
    threadId: 't2',
    entryId: 'e3',
    senderId: 'u1',
    recipientId: 'u2',
    createdAt: '2026-10-14T01:00:00Z',
    confirmedAt: '2026-10-14T05:00:00Z',
  },
  {
    id: 'c3',
    projectId: 'p1',
    threadId: 't2',
    entryId: 'e3',
    senderId: 'u1',
    recipientId: 'u4',
    createdAt: '2026-10-14T01:00:00Z',
    confirmedAt: null,
  },
  {
    id: 'c4',
    projectId: 'p1',
    threadId: 't1',
    entryId: 'e1',
    senderId: 'u3',
    recipientId: 'u1',
    createdAt: '2026-10-15T00:30:00Z',
    confirmedAt: null,
  },
]
