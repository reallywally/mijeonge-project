import type { Member, Project } from '@/types/domain'

/**
 * 목업 데이터. 백엔드가 붙으면 이 폴더가 통째로 빠진다.
 *
 * 값은 디자인 캔버스의 '작업 시안' · '회의 시안' 과 같은 것을 쓴다 —
 * memo.md 의 시나리오 넷을 한 프로젝트 안에서 따라갈 수 있게.
 */

export const members: Member[] = [
  { id: 'u1', name: '김서연', active: true, avatarUrl: null },
  { id: 'u2', name: '박지훈', active: true, avatarUrl: null },
  { id: 'u3', name: '이도현', active: true, avatarUrl: null },
  { id: 'u4', name: '정하늘', active: true, avatarUrl: null },
  /* 사용자를 관리하는 사람 — 어느 프로젝트에도 부여되지 않았지만 다 본다 */
  { id: 'u0', name: '관리자', active: true, avatarUrl: null },
  /* 떠난 사람 — 지우지 않고 끈다. 로그인할 수 없고 담당자로 고를 수 없다 */
  { id: 'u5', name: '한예린', active: false, avatarUrl: null },
]

/**
 * memo: "개발은 한화손보 차세대, 삼성생명 PAS, 사무직은 경영지원 파트 정도 단위로 생성"
 *
 * taskKeyPrefix 는 프로젝트마다 하나고 서로 겹치지 않는다 — 말로 'HW-4' 한 마디로 가리킨다.
 */
export const projects: Project[] = [
  {
    id: 'p1',
    name: '한화손보 차세대',
    taskKeyPrefix: 'HW',
    description:
      '한화손해보험 차세대 시스템 구축 — 인프라 · AI 상담 · 데이터 이관을 한 사업으로 묶는다.',
    startDate: '2026-03-02',
    endDate: '2026-12-31',
    status: 'active',
    closedAt: null,
  },
  /* 준비 중인 프로젝트 — 진행 다음에 서고 '준비' 가 붙는다 */
  {
    id: 'p2',
    name: '삼성생명 PAS',
    taskKeyPrefix: 'PAS',
    description: null,
    startDate: '2026-12-01',
    endDate: null,
    status: 'planned',
    closedAt: null,
  },
  /* 종료한 프로젝트 — 목록 · 고르기에서 뒤로 가고 '종료' 가 붙는다. 쓰기는 막지 않는다 */
  {
    id: 'p3',
    name: '경영지원 파트',
    taskKeyPrefix: 'OPS',
    description: '사무직 파트 업무 — 분기마다 정리한다.',
    startDate: null,
    endDate: null,
    status: 'closed',
    closedAt: '2026-10-30T09:00:00Z',
  },
]
