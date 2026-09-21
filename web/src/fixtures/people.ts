import type { Member, Project } from '@/types/domain'

/**
 * 목업 데이터. 백엔드가 붙으면 이 폴더가 통째로 빠진다.
 *
 * 값은 디자인 캔버스의 '작업 시안' · '회의 시안' 과 같은 것을 쓴다 —
 * memo.md 의 시나리오 넷을 한 프로젝트 안에서 따라갈 수 있게.
 */

export const members: Member[] = [
  { id: 'u1', name: '김서연' },
  { id: 'u2', name: '박지훈' },
  { id: 'u3', name: '이도현' },
  { id: 'u4', name: '정하늘' },
]

/** memo: "개발은 한화손보 차세대, 삼성생명 PAS, 사무직은 경영지원 파트 정도 단위로 생성" */
export const projects: Project[] = [
  { id: 'p1', name: '한화손보 차세대' },
  { id: 'p2', name: '삼성생명 PAS' },
  { id: 'p3', name: '경영지원 파트' },
]

/** 지금 로그인한 사람 */
export const currentMemberId = 'u3'
