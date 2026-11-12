import type { Part, PartMember } from '@/types/domain'

/*
 * 파트 — docs/api/part.md '시드 · 목업' 표 그대로다. 서버 시드와 같은 id · 소속이라
 * 목업과 서버를 오가도 '내 파트' 에 보이는 것이 같다. p2 · p3 에는 파트가 없다(전환이 숨는 경우).
 * 작업 · 안건의 partId 는 tasks.ts · agendas.ts 가 단다.
 */

/** 이름 순 — 스냅샷이 내는 순서와 같다 */
export const parts: Part[] = [
  { id: 'pt2', projectId: 'p1', name: 'AI', active: true },
  { id: 'pt3', projectId: 'p1', name: '기간계 연동', active: true },
  { id: 'pt1', projectId: 'p1', name: '인프라', active: true },
]

/* 지금 소속은 다 네 권한이 켜져 있다 — 2026-11-12 전 소속을 서버가 옮긴 모양과 같다 */
const all = { canView: true, canCreate: true, canUpdate: true, canDelete: true }

/** (partId, memberId) 순 */
export const partMembers: PartMember[] = [
  { partId: 'pt1', memberId: 'u3', ...all },
  { partId: 'pt2', memberId: 'u1', ...all },
  { partId: 'pt2', memberId: 'u4', ...all },
  { partId: 'pt3', memberId: 'u2', ...all },
]
