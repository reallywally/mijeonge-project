import type { TestCase } from '@/types/domain'

/**
 * 테스트 — docs/api/test.md '시드 · 목업' 표와 서버 시드('구현에서 메운 것' — server/scripts/seed.py 의 TESTS)
 * 그대로다. 오늘을 2026-10-15 로 두면 표의 신호가 나온다.
 * 며칠째 · 신호 · 기준 바뀜은 저장하지 않는다 — 목업 api 가 서버처럼 그때그때 센다.
 *
 * 태그 — T2 ↔ 작업 HW-4(안건 t1 · t2 에 걸려 있다), T3 ↔ 안건 t3, T4 ↔ 안건 t2, T6 ↔ 작업 HW-21.
 * T4 는 결정 e3 앞에서 확인한 것이라 기준 바뀜이다 — 계약 표는 change 줄이지만 시드에 change 가 없어
 * 서버처럼 decide 줄(e3)을 '바뀐 결정' 으로 쓴다.
 */

/** 목업이 들고 있는 한 줄 — 서버의 test_case 행. basisSeq 는 Entry 의 등록 순서(1부터, 픽스처 배열 순서)다 */
export type MockTestCase = Omit<TestCase, 'statusDays' | 'signals' | 'changedEntryIds'> & {
  basisSeq: number | null
}

const CREATED = '2026-09-30T01:00:00Z'
/** 바뀐 시각은 그날 12:00 KST */
const noon = (day: string) => `${day}T03:00:00Z`

function mk(
  no: number,
  title: string,
  owner: string,
  rest: Partial<MockTestCase> & Pick<MockTestCase, 'status'>,
): MockTestCase {
  return {
    id: `tc${no}`,
    projectId: 'p1',
    key: `HW-T${no}`,
    title,
    parentId: null,
    purpose: '',
    precondition: '',
    testData: '',
    steps: [],
    refs: [],
    statusChangedAt: CREATED,
    /* 담당 = 바꾼 사람 = 만든 사람 */
    statusChangedBy: owner,
    failedStep: null,
    resultNote: '',
    level: 'functional',
    start: null,
    due: null,
    ownerId: owner,
    partId: null,
    createdBy: owner,
    createdAt: CREATED,
    basisSeq: null,
    ...rest,
  }
}

export const testCases: MockTestCase[] = [
  mk(1, '로그인 시나리오', 'u2', {
    status: 'draft',
    level: 'acceptance',
    purpose: '사내 계정으로 들어오는 길을 처음부터 끝까지 따라간다.',
  }),
  mk(2, '올바른 계정으로 로그인', 'u2', {
    parentId: 'tc1',
    status: 'pass',
    statusChangedAt: noon('2026-10-10'),
    start: '2026-10-08',
    due: '2026-10-10',
    purpose: '발급받은 계정으로 들어갈 수 있는지 본다.',
    precondition: '개발 서버가 떠 있고 계정이 발급돼 있다.',
    testData: 'dev01 / 발급 메일의 임시 비밀번호',
    steps: [
      { action: '로그인 화면을 연다', expected: '' },
      {
        action: 'dev01 과 임시 비밀번호를 넣고 [로그인]',
        expected: '대시보드가 열리고 이름이 보인다',
      },
    ],
    refs: [{ kind: 'task', id: 'k4' }],
    basisSeq: 3,
  }),
  mk(3, '비밀번호 5회 틀림 잠금', 'u2', {
    parentId: 'tc1',
    status: 'testing',
    statusChangedAt: noon('2026-10-03'),
    start: '2026-10-06',
    due: '2026-10-08',
    purpose: '비밀번호를 거푸 틀리면 계정이 잠기는지 본다.',
    steps: [
      { action: '틀린 비밀번호로 네 번 로그인한다', expected: '매번 남은 횟수가 보인다' },
      { action: '다섯 번째로 틀린다', expected: '계정이 잠겼다는 안내가 뜬다' },
    ],
    refs: [{ kind: 'thread', id: 't3' }],
    basisSeq: 4,
  }),
  mk(4, '비밀번호 변경 주기', 'u4', {
    parentId: 'tc1',
    status: 'ready',
    statusChangedAt: noon('2026-10-01'),
    start: '2026-10-13',
    due: '2026-10-17',
    purpose: '정해 둔 주기가 지난 계정은 비밀번호를 바꾸게 하는지 본다.',
    steps: [
      { action: '주기가 지난 계정으로 로그인한다', expected: '비밀번호 바꾸기 화면으로 간다' },
    ],
    refs: [{ kind: 'thread', id: 't2' }],
    basisSeq: 2,
  }),
  mk(5, '계정 배포 시나리오', 'u3', {
    status: 'draft',
    level: 'integration',
    partId: 'pt1',
    purpose: '개발자 계정을 만들어 나눠 주고 권한을 거르는 흐름.',
  }),
  mk(6, '개발자 계정 일괄 생성', 'u3', {
    parentId: 'tc5',
    status: 'blocked',
    statusChangedAt: noon('2026-10-02'),
    resultNote: 'DB 설치(HW-20)가 안 끝나 계정을 만들 DB 가 없다.',
    level: 'integration',
    partId: 'pt1',
    steps: [
      { action: '계정 목록 파일을 올린다', expected: '' },
      { action: '[한 번에 만들기]', expected: '네 계정이 모두 만들어지고 메일이 나간다' },
    ],
    refs: [{ kind: 'task', id: 'k21' }],
  }),
  mk(7, '권한 없는 계정 접근 차단', 'u1', {
    parentId: 'tc5',
    status: 'fail',
    statusChangedAt: noon('2026-10-05'),
    failedStep: 2,
    resultNote: '관리 화면 주소를 직접 치면 열린다.',
    start: '2026-10-14',
    due: '2026-10-20',
    partId: 'pt1',
    steps: [
      { action: '일반 계정으로 로그인한다', expected: '' },
      { action: '관리 화면 주소를 직접 연다', expected: '권한이 없다는 화면이 뜬다' },
    ],
  }),
  mk(8, '계정 목록 내려받기', 'u4', {
    parentId: 'tc5',
    status: 'testing',
    statusChangedAt: noon('2026-10-14'),
    level: null,
    partId: 'pt1',
    steps: [{ action: '[계정 목록 내려받기]', expected: '모든 계정이 담긴 CSV 가 받아진다' }],
  }),
]
