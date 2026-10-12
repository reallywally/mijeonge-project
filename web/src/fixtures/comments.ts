import type { TaskComment } from '@/types/domain'

/** 작업 댓글. 작업마다 오래된 것부터 놓는다 — 서버가 내는 순서와 같다 */
export const taskComments: TaskComment[] = [
  {
    id: 'cm1',
    taskId: 'k4',
    authorId: 'u1',
    body: '방화벽 신청서는 제가 올려 두었습니다.\n승인까지 이틀 정도 걸린다고 합니다.',
    createdAt: '2026-09-09T01:12:00Z',
    editedAt: null,
  },
  {
    id: 'cm2',
    taskId: 'k4',
    authorId: 'u3',
    body: '확인했습니다. 승인 나면 계정 네 개 바로 만들겠습니다.',
    createdAt: '2026-09-09T02:40:00Z',
    editedAt: '2026-09-09T02:45:00Z',
  },
  {
    id: 'cm3',
    taskId: 'k18',
    authorId: 'u4',
    body: 'in · out 정의 안건이 정해져야 시작할 수 있습니다.',
    createdAt: '2026-09-15T05:00:00Z',
    editedAt: null,
  },
]
