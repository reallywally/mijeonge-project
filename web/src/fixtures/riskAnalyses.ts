import { DEFAULT_RISK_SETTINGS, type StoredRiskAnalysisFacts } from '@/lib/risk'
import type { RiskAnalysis } from '@/types/domain'

/** 목업 저장소의 한 줄 — 서버 테이블 risk_analysis 처럼 임시 분석(savedAt null)도 같이 든다.
    facts 는 저장된 그대로라 옛 모양(작업 · 테스트 전)도 든다 — api 가 읽어 낼 때 맞춘다 */
export interface MockRiskAnalysis extends Omit<
  RiskAnalysis,
  'seq' | 'title' | 'savedAt' | 'agendaCount' | 'taskCount' | 'testCount' | 'highCount' | 'facts'
> {
  facts: StoredRiskAnalysisFacts
  /** 저장할 때 매긴다 — 임시는 null */
  seq: number | null
  title: string | null
  /** null 이면 임시 — 게시판 · 상세에 안 보인다 */
  savedAt: string | null
}

/*
 * 저장한 AI 리스크 분석 둘 (docs/api/risk-analysis.md '시드 · 목업') — p1 에만.
 * 1번은 앞 분석이 없어 compare null 이고 작업 · 테스트 전의 옛 모양(tasks · tests 없음)이다. 2번은 1번 대비로 세 종류를 담는다 —
 * 줄 값은 리스크 목업 보고서(2026-10-15)와 같다.
 * 작성자를 갈라 둬 권한(고치기는 작성자만 · 지우기는 작성자 · 관리자)을 화면에서 볼 수 있다
 */
type Level = 'high' | 'medium' | 'low'
const snapTask = (
  taskId: string,
  key: string,
  title: string,
  level: Level,
  score: number,
  signals: string[],
  ownerName: string | null,
) => ({ taskId, key, title, level, score, signals, ownerName })
const snapTest = (
  testId: string,
  key: string,
  title: string,
  level: Level,
  score: number,
  signals: string[],
  ownerName: string | null,
) => ({ testId, key, title, level, score, signals, ownerName })

const first: MockRiskAnalysis = {
  id: 'ra1',
  projectId: 'p1',
  seq: 1,
  title: '리스크 분석 2026-10-08',
  body: [
    '한 줄 총평 — 지금 가장 큰 병목은 [[agenda:t3]] 입니다(7점 · high).',
    '',
    '먼저 정할 것',
    '1. [[agenda:t3]] — 기한 지남 · 작업을 막는 중 · 다음 회의에 올려 결정내용을 적는다 · 김서연',
    '2. [[agenda:t5]] — 오래 멈춤 · 작업 1건([[task:k18]])이 기다립니다 · 기간계 담당과 in · out 초안을 맞춘다 · 정하늘',
    '3. [[agenda:t6]] — 기한 임박 · 일정 안을 둘로 좁혀 올린다 · 김서연',
  ].join('\n'),
  refs: [
    { kind: 'agenda', id: 't3' },
    { kind: 'agenda', id: 't5' },
    { kind: 'task', id: 'k18' },
    { kind: 'agenda', id: 't6' },
  ],
  facts: {
    asOf: '2026-10-08',
    settings: { ...DEFAULT_RISK_SETTINGS },
    agendas: [
      {
        agendaId: 't3',
        key: null,
        title: '사내망에서 외부 모델 호출 허용 범위',
        level: 'high',
        score: 7,
        signals: ['overdue', 'blocking'],
        ownerName: '김서연',
      },
      {
        agendaId: 't5',
        key: null,
        title: '보험료 산출 기간계 API 호출 in · out 정의',
        level: 'medium',
        score: 5,
        signals: ['stale', 'blocking'],
        ownerName: '정하늘',
      },
      {
        agendaId: 't6',
        key: null,
        title: '일정 조율 — 전체 일정을 미룰지, 테스트 기간을 줄일지',
        level: 'medium',
        score: 3,
        signals: ['dueSoon', 'decisionAfterTaskDue'],
        ownerName: '김서연',
      },
    ],
    compare: null,
  },
  createdBy: 'u1',
  createdAt: '2026-10-08T01:10:00Z',
  savedAt: '2026-10-08T01:12:00Z',
  titleEditedAt: null,
}

const second: MockRiskAnalysis = {
  id: 'ra2',
  projectId: 'p1',
  seq: 2,
  title: '10월 셋째 주 리스크',
  body: [
    '한 줄 총평 — 기한을 거듭 미룬 테스트 [[test:tc3]] 와 기한을 한 달 넘긴 [[task:k20]] 이 가장 급합니다.',
    '',
    '먼저 손쓸 것',
    '1. [[test:tc3]] — 기간 지남 · 오래 걸림 · 기한 거듭 미룸(기간 지남 7일) · 원인을 조치 내역에 적고 다시 돌린다 · 박지훈',
    '2. [[task:k20]] — 기한 넘김 · 오래 걸림(기한 넘김 33일) · 기한을 다시 잡거나 나눌지 정한다 · 이도현',
    '3. [[agenda:t5]] — 오래 멈춤 · 작업을 막는 중(막힌 작업 1건) · [[task:k18]] 이 기다립니다 · 정하늘',
    '4. [[agenda:t3]] — 기한 지남 · 오래 멈춤(기한 넘김 15일) · 허용 범위 초안을 보안 담당과 맞춘다 · 김서연',
    '',
    '흔들리는 일',
    '- [[task:k22]] [[test:tc2]] — 내용이 다섯 번 바뀌었고 결과가 두 번 뒤집혔습니다. 스테이징 구성이 아직 덜 정해진 것으로 보임.',
    '',
    '지난 분석 대비 — [[agenda:t6]] 이 풀렸고 [[agenda:t3]] 은 high 에서 medium 으로 내려왔지만, 작업 · 테스트가 새로 들어왔습니다.',
  ].join('\n'),
  refs: [
    { kind: 'test', id: 'tc3' },
    { kind: 'task', id: 'k20' },
    { kind: 'agenda', id: 't5' },
    { kind: 'task', id: 'k18' },
    { kind: 'agenda', id: 't3' },
    { kind: 'task', id: 'k22' },
    { kind: 'test', id: 'tc2' },
    { kind: 'agenda', id: 't6' },
  ],
  facts: {
    asOf: '2026-10-15',
    settings: { ...DEFAULT_RISK_SETTINGS },
    agendas: [
      {
        agendaId: 't5',
        key: null,
        title: '보험료 산출 기간계 API 호출 in · out 정의',
        level: 'medium',
        score: 5,
        signals: ['stale', 'blocking'],
        ownerName: '정하늘',
      },
      {
        agendaId: 't3',
        key: null,
        title: '사내망에서 외부 모델 호출 허용 범위',
        level: 'medium',
        score: 4,
        signals: ['overdue', 'stale'],
        ownerName: '김서연',
      },
      {
        agendaId: 't8',
        key: null,
        title: 'AI 심사 학습 데이터 범위',
        level: 'medium',
        score: 4,
        signals: ['stale', 'decisionAfterTaskDue', 'noDueDate'],
        ownerName: '김서연',
      },
      {
        agendaId: 't9',
        key: null,
        title: '공통 코드 체계 확정',
        level: 'medium',
        score: 4,
        signals: ['stale', 'decisionAfterTaskDue', 'noDueDate'],
        ownerName: '박지훈',
      },
    ],
    tasks: [
      snapTask(
        'k20',
        'HW-20',
        'DB 설치와 초기 스키마 반영',
        'high',
        6,
        ['overdue', 'longRunning'],
        '이도현',
      ),
      snapTask('k4', 'HW-4', '개발 환경 설정', 'high', 6, ['overdue', 'longRunning'], '이도현'),
      snapTask(
        'k18',
        'HW-18',
        '보험료 산출 기간계 API 개발',
        'medium',
        3,
        ['longBlocked'],
        '정하늘',
      ),
      snapTask('k22', 'HW-22', '스테이징 DB 구성', 'low', 1, ['contentChurn'], '이도현'),
    ],
    tests: [
      snapTest(
        'tc3',
        'HW-T3',
        '비밀번호 5회 틀림 잠금',
        'high',
        8,
        ['overdue', 'longRunning', 'dueSlipped'],
        '박지훈',
      ),
      snapTest(
        'tc4',
        'HW-T4',
        '비밀번호 변경 주기',
        'medium',
        3,
        ['basisChanged', 'notStarted'],
        '정하늘',
      ),
      snapTest('tc2', 'HW-T2', '올바른 계정으로 로그인', 'low', 2, ['flaky'], '박지훈'),
    ],
    compare: {
      previousId: 'ra1',
      previousTitle: '리스크 분석 2026-10-08',
      previousSavedAt: '2026-10-08T01:12:00Z',
      added: [
        { kind: 'agenda', id: 't8' },
        { kind: 'agenda', id: 't9' },
        { kind: 'task', id: 'k20' },
        { kind: 'task', id: 'k4' },
        { kind: 'task', id: 'k18' },
        { kind: 'task', id: 'k22' },
        { kind: 'test', id: 'tc3' },
        { kind: 'test', id: 'tc4' },
        { kind: 'test', id: 'tc2' },
      ],
      removed: [{ kind: 'agenda', id: 't6' }],
      kept: [
        { kind: 'agenda', id: 't5', levelFrom: 'medium', levelTo: 'medium' },
        { kind: 'agenda', id: 't3', levelFrom: 'high', levelTo: 'medium' },
      ],
    },
  },
  createdBy: 'u3',
  createdAt: '2026-10-15T02:30:00Z',
  savedAt: '2026-10-15T02:31:00Z',
  titleEditedAt: null,
}

export const riskAnalysisRows: MockRiskAnalysis[] = [first, second]
