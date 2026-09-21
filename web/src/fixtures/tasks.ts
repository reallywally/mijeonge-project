import type { MeetingTaskLink, Task, TaskLine, TaskStatus, TaskThreadLink } from '@/types/domain'

/**
 * 작업. memo 의 "기본 사용법" 에 적힌 트리를 그대로 깔았다.
 *
 * 기간이 안 잡힌 작업(HW-18)이 하나 있다 — 걸어 둔 안건이 안 정해져 멈춘 것이라 상태가 막힘이고,
 * 간트차트에는 막대가 없어 목록에서 챙겨야 한다.
 */

function mk(
  id: string,
  key: string,
  title: string,
  parentId: string | null,
  status: TaskStatus,
  ownerId: string | null,
  start: string | null,
  due: string | null,
  body: TaskLine[] = [],
): Task {
  return {
    id,
    projectId: 'p1',
    key,
    title,
    parentId,
    body,
    status,
    ownerId,
    start,
    due,
    priority: 'normal',
    createdAt: '2026-09-04',
  }
}

/** 개발 환경 설정(HW-4)의 본문 — 체크박스와 불릿 */
const envBody: TaskLine[] = [
  { id: 'l1', kind: 'check', text: '서버 신청서 제출', done: true, level: 0 },
  { id: 'l2', kind: 'check', text: '우분투 최신 버전 설치', done: true, level: 0 },
  { id: 'l3', kind: 'check', text: 'mysql 설치와 계정 발급', done: false, level: 0 },
  { id: 'l4', kind: 'check', text: '개발자 접속 계정 4개 만들기', done: false, level: 0 },
  {
    id: 'l5',
    kind: 'bullet',
    text: '방화벽은 정보보안팀에 따로 신청해야 한다 (사내 포털 > 보안)',
    done: false,
    level: 1,
  },
  {
    id: 'l6',
    kind: 'bullet',
    text: '백업 정책은 기간계와 같은 주기로 맞추기로 했다',
    done: false,
    level: 1,
  },
  { id: 'l7', kind: 'check', text: 'CI 러너 붙이기', done: false, level: 0 },
]

export const tasks: Task[] = [
  mk('k1', 'HW-1', '설계', null, 'doing', null, '2026-09-07', '2026-09-22'),
  mk('k2', 'HW-2', '데이터 설계', 'k1', 'done', 'u1', '2026-09-07', '2026-09-14'),
  mk('k3', 'HW-3', '프로그램 설계', 'k1', 'doing', 'u2', '2026-09-15', '2026-09-22'),
  mk('k4', 'HW-4', '개발 환경 설정', null, 'doing', 'u3', '2026-09-08', '2026-09-15', envBody),
  mk('k5', 'HW-5', '개발', null, 'todo', null, '2026-09-16', '2026-10-04'),
  mk('k6', 'HW-6', 'AI Biz', 'k5', 'todo', null, '2026-09-16', '2026-10-04'),
  mk('k7', 'HW-7', '가상비서', 'k6', 'doing', 'u4', '2026-09-16', '2026-09-25'),
  mk('k8', 'HW-8', 'tool01', 'k7', 'done', 'u4', '2026-09-16', '2026-09-18'),
  mk('k9', 'HW-9', 'tool02', 'k7', 'doing', 'u4', '2026-09-19', '2026-09-21'),
  mk('k10', 'HW-10', 'tool03', 'k7', 'todo', null, '2026-09-22', '2026-09-23'),
  mk('k11', 'HW-11', 'tool04', 'k7', 'todo', null, '2026-09-24', '2026-09-25'),
  mk('k12', 'HW-12', 'AI 심사', 'k6', 'todo', null, '2026-09-23', '2026-09-30'),
  mk('k13', 'HW-13', '모델링', 'k12', 'todo', 'u1', '2026-09-23', '2026-09-30'),
  mk('k14', 'HW-14', '상품 추천', 'k6', 'todo', null, '2026-09-26', '2026-10-04'),
  mk('k15', 'HW-15', '기존 상품 분석', 'k14', 'todo', 'u2', '2026-09-26', '2026-09-29'),
  mk('k16', 'HW-16', '모델링', 'k14', 'todo', null, '2026-09-30', '2026-10-04'),
  mk('k17', 'HW-17', '챗봇', 'k5', 'todo', null, '2026-09-28', '2026-10-04'),
  // 시나리오 2 — 안건이 안 정해져 멈췄고 기간도 못 잡았다
  mk('k18', 'HW-18', '보험료 산출 기간계 API 개발', 'k5', 'blocked', 'u4', null, null),
  // 개발 환경 설정의 하위 작업
  mk('k19', 'HW-19', '서버 발급받고 접속 확인', 'k4', 'done', 'u3', '2026-09-08', '2026-09-09'),
  mk('k20', 'HW-20', 'DB 설치와 초기 스키마 반영', 'k4', 'doing', 'u3', '2026-09-10', '2026-09-12'),
  mk('k21', 'HW-21', '개발자 계정 배포', 'k4', 'todo', 'u1', '2026-09-12', '2026-09-15'),
  // 다른 프로젝트
  {
    ...mk('x1', 'PAS-1', '현행 분석', null, 'doing', 'u2', '2026-09-14', '2026-09-30'),
    projectId: 'p2',
  },
  {
    ...mk('x2', 'PAS-2', '이관 대상 목록 만들기', 'x1', 'todo', 'u2', '2026-09-21', '2026-09-30'),
    projectId: 'p2',
  },
]

/** 작업 ↔ 안건. 작업을 하다가 정해야 했던 것들이다 */
export const taskThreadLinks: TaskThreadLink[] = [
  { taskId: 'k4', threadId: 't1' }, // 개발 환경 설정 ↔ 서버 OS 결정
  { taskId: 'k4', threadId: 't2' }, // 개발 환경 설정 ↔ DB 결정
  { taskId: 'k18', threadId: 't5' }, // 기간계 API ↔ in · out 정의
  { taskId: 'k13', threadId: 't8' }, // 모델링 ↔ 학습 데이터 범위
  { taskId: 'k3', threadId: 't9' }, // 프로그램 설계 ↔ 공통 코드 체계
]

/** 회의 ↔ 작업. 그 회의에서 정해진 것이 어느 작업을 움직이는지 */
export const meetingTaskLinks: MeetingTaskLink[] = [
  { meetingId: 'm3', taskId: 'k4' },
  { meetingId: 'm2', taskId: 'k18' },
  { meetingId: 'm5', taskId: 'k18' },
  { meetingId: 'm6', taskId: 'k1' },
  { meetingId: 'm6', taskId: 'k5' },
  { meetingId: 'm6', taskId: 'k18' },
]
