import { id, mockError, request } from '@/api/client'
import { forbidden, later, mockDb, mockWorld, requireMe, requireProject } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { projects } from '@/fixtures'
import type { MockTestCase } from '@/fixtures'
import { canDeleteComment, canSeeProject } from '@/lib/access'
import { kstToday, nowIso } from '@/lib/date'
import { DEFAULT_RISK_SETTINGS } from '@/lib/risk'
import {
  TEST_REF_MAX,
  testFieldProblems,
  testSignals,
  testStatusDays,
  testStatusProblem,
} from '@/lib/testcase'
import type { Me, TestCase, TestInput, TestPatch, TestRef, TestStatusInput } from '@/types/domain'

/* 테스트 (docs/api/test.md). 작업과 따로 — 스냅샷에 싣지 않고 프로젝트 단위로 받는다.
   며칠째 · 신호 · 기준 바뀜은 서버가 센다. 목업 갈래는 같은 규칙(lib/testcase)을 지금 목업 데이터로 돌린다 */

const notFound = () => mockError(404, 'TEST_NOT_FOUND', '테스트를 찾을 수 없습니다.')
const invalid = (detail: Record<string, string>) =>
  mockError(422, 'VALIDATION_ERROR', '입력값이 올바르지 않습니다.', detail)

/** 부여받지 않은 프로젝트의 테스트는 없는 것처럼 404 */
function requireTest(me: Me, testId: string): MockTestCase {
  const row = mockDb().tests.find((t) => t.id === testId)
  if (!row || !canSeeProject(me, row.projectId)) throw notFound()
  return row
}

const hasChildren = (testId: string) => mockDb().tests.some((t) => t.parentId === testId)

/** 닿는 안건 — 직접 태그한 안건 + 태그한 작업에 걸린 안건 */
function touchingThreadIds(refs: TestRef[]): Set<string> {
  const world = mockWorld()
  const ids = new Set(refs.filter((r) => r.kind === 'thread').map((r) => r.id))
  const taskIds = new Set(refs.filter((r) => r.kind === 'task').map((r) => r.id))
  for (const l of world.taskThreads) if (taskIds.has(l.taskId)) ids.add(l.threadId)
  return ids
}

/** 닿는 안건의 Entry 와 그 seq — 목업은 배열 순서가 등록 순서다 */
function touchingEntries(refs: TestRef[]) {
  const threads = touchingThreadIds(refs)
  return mockWorld()
    .entries.map((entry, i) => ({ entry, seq: i + 1 }))
    .filter((x) => threads.has(x.entry.threadId))
}

/** 기준을 지금으로 — 닿는 안건의 가장 큰 Entry seq. 없으면 null */
function latestSeq(refs: TestRef[]): number | null {
  const seqs = touchingEntries(refs).map((x) => x.seq)
  return seqs.length ? Math.max(...seqs) : null
}

function changedEntryIds(t: MockTestCase): string[] {
  const basis = t.basisSeq ?? 0
  return touchingEntries(t.refs)
    .filter((x) => (x.entry.kind === 'decide' || x.entry.kind === 'change') && x.seq > basis)
    .map((x) => x.entry.id)
}

/** 서버 응답처럼 늘 새 객체로 — 며칠째 · 신호를 지금 센다 */
function toCase(t: MockTestCase): TestCase {
  const { basisSeq: _basis, ...rest } = t
  void _basis
  const today = kstToday()
  const staleDays = (mockDb().riskSettings[t.projectId] ?? DEFAULT_RISK_SETTINGS).staleDays
  const statusDays = testStatusDays(t.statusChangedAt, today)
  const changed = changedEntryIds(t)
  const signals = testSignals(
    {
      status: t.status,
      statusDays,
      start: t.start,
      due: t.due,
      changedEntryIds: changed,
      isGroup: hasChildren(t.id),
    },
    today,
    staleDays,
  )
  return structuredClone({ ...rest, statusDays, signals, changedEntryIds: changed })
}

/** 태그 순서 — 작업 먼저, 그 안은 작업 · 안건의 seq(목업은 배열 순서) */
function sortRefs(refs: TestRef[]): TestRef[] {
  const world = mockWorld()
  const order = (r: TestRef) =>
    r.kind === 'task'
      ? world.tasks.findIndex((t) => t.id === r.id)
      : world.threads.findIndex((t) => t.id === r.id)
  return [...refs].sort((a, b) =>
    a.kind !== b.kind ? (a.kind === 'task' ? -1 : 1) : order(a) - order(b),
  )
}

/** 같은 프로젝트의 작업 · 안건인가 — 아니면 서버처럼 404 */
function requireRefTarget(projectId: string, ref: TestRef) {
  const world = mockWorld()
  if (ref.kind === 'task') {
    if (!world.tasks.some((t) => t.id === ref.id && t.projectId === projectId))
      throw mockError(404, 'TASK_NOT_FOUND', '작업을 찾을 수 없습니다.')
  } else if (ref.kind === 'thread') {
    if (!world.threads.some((t) => t.id === ref.id && t.projectId === projectId))
      throw mockError(404, 'THREAD_NOT_FOUND', '안건을 찾을 수 없습니다.')
  } else {
    throw invalid({ kind: 'task 또는 thread 여야 합니다.' })
  }
}

const refLimit = () =>
  mockError(400, 'TEST_REF_LIMIT', `태그는 ${TEST_REF_MAX}개까지 걸 수 있습니다.`)

/** 상위 테스트 — 같은 프로젝트에 있고, 자기 · 자손이 아니어야 한다 */
function checkParent(projectId: string, parentId: string, selfId: string | null) {
  const tests = mockDb().tests
  const parent = tests.find((t) => t.id === parentId)
  if (!parent || parent.projectId !== projectId)
    throw mockError(400, 'TEST_PARENT_NOT_FOUND', '상위 테스트를 찾을 수 없습니다.')
  if (selfId === null) return
  if (parentId === selfId)
    throw mockError(400, 'TEST_PARENT_SELF', '자기 자신을 상위 테스트로 둘 수 없습니다.')
  let cur: MockTestCase | undefined = parent
  const seen = new Set<string>()
  while (cur && cur.parentId !== null && !seen.has(cur.id)) {
    seen.add(cur.id)
    if (cur.parentId === selfId)
      throw mockError(400, 'TEST_PARENT_DESCENDANT', '하위 테스트를 상위 테스트로 둘 수 없습니다.')
    cur = tests.find((t) => t.id === cur!.parentId)
  }
}

/** 새로 지정하는 담당자는 그 프로젝트의 활성 멤버여야 한다. 이미 걸린 사람은 그대로 둘 수 있다 */
function checkOwner(projectId: string, ownerId: string | null | undefined, kept: string | null) {
  if (!ownerId || ownerId === kept) return
  const db = mockDb()
  const ok =
    db.members.some((m) => m.id === ownerId && m.active) &&
    db.grants.some((g) => g.projectId === projectId && g.memberId === ownerId)
  if (!ok)
    throw mockError(400, 'TEST_OWNER_NOT_FOUND', '담당자를 찾을 수 없습니다.', {
      ownerId: '담당자를 찾을 수 없습니다.',
    })
}

/** 파트 — 작업과 같은 검사 · 같은 code */
function checkPart(projectId: string, partId: string | null | undefined, kept: string | null) {
  if (!partId || partId === kept) return
  const part = mockDb().parts.find((p) => p.id === partId && p.projectId === projectId)
  if (!part)
    throw mockError(400, 'PART_NOT_FOUND', '파트를 찾을 수 없습니다.', {
      partId: '파트를 찾을 수 없습니다.',
    })
  if (!part.active)
    throw mockError(400, 'PART_ARCHIVED', '보관한 파트는 고를 수 없습니다.', {
      partId: '보관한 파트입니다.',
    })
}

/** 번호 — 프로젝트별로 세고 지운 번호를 다시 쓰지 않는다 */
function takeTestKey(projectId: string) {
  const db = mockDb()
  /* 화면에서 만든 목업 프로젝트는 픽스처에 없다 — 작업 번호처럼 TEST 로 둔다 */
  const prefix = projects.find((p) => p.id === projectId)?.taskKeyPrefix ?? 'TEST'
  const no =
    db.nextTestNo[projectId] ??
    db.tests
      .filter((t) => t.projectId === projectId)
      .reduce((max, t) => Math.max(max, Number(t.key.split('-T').pop()) || 0), 0) + 1
  db.nextTestNo[projectId] = no + 1
  return `${prefix}-T${no}`
}

const trimmed = (v: string | undefined) => (v === undefined ? undefined : v.trim())

function dedupeRefs(refs: TestRef[]): TestRef[] {
  const seen = new Set<string>()
  return refs.filter((r) => {
    const k = `${r.kind}:${r.id}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const mock = {
  list(projectId: string): TestCase[] {
    requireProject(requireMe(), projectId)
    return mockDb()
      .tests.filter((t) => t.projectId === projectId)
      .map(toCase)
  },
  get: (testId: string) => toCase(requireTest(requireMe(), testId)),
  create(projectId: string, input: TestInput): TestCase {
    const me = requireMe()
    requireProject(me, projectId)
    const problems = testFieldProblems({ ...input, title: input.title ?? '' })
    if (Object.keys(problems).length > 0) throw invalid(problems)
    const tests = mockDb().tests
    const parentId = input.parentId ?? null
    if (parentId !== null) checkParent(projectId, parentId, null)
    checkOwner(projectId, input.ownerId, null)
    const parent = parentId ? tests.find((t) => t.id === parentId) : undefined
    const partId = input.partId !== undefined ? input.partId : (parent?.partId ?? null)
    checkPart(projectId, partId, null)
    const refs = dedupeRefs(input.refs ?? [])
    if (refs.length > TEST_REF_MAX) throw refLimit()
    for (const r of refs) requireRefTarget(projectId, r)

    const db = mockDb()
    db.testSeq += 1
    const key = takeTestKey(projectId)
    const at = nowIso()
    const row: MockTestCase = {
      id: `nts${db.testSeq}`,
      projectId,
      key,
      title: input.title.trim(),
      parentId,
      purpose: input.purpose ?? '',
      precondition: input.precondition ?? '',
      testData: input.testData ?? '',
      steps: (input.steps ?? []).map((s) => ({ action: s.action.trim(), expected: s.expected })),
      refs: sortRefs(refs),
      status: 'draft',
      statusChangedAt: at,
      statusChangedBy: me.id,
      failedStep: null,
      resultNote: '',
      level: input.level ?? null,
      start: input.start ?? null,
      due: input.due ?? null,
      ownerId: input.ownerId ?? null,
      partId,
      createdBy: me.id,
      createdAt: at,
      basisSeq: latestSeq(refs),
    }
    db.tests.push(row)
    return toCase(row)
  },
  patch(testId: string, patch: TestPatch): TestCase {
    const me = requireMe()
    const row = requireTest(me, testId)
    const problems = testFieldProblems({
      ...patch,
      start: patch.start !== undefined ? patch.start : row.start,
      due: patch.due !== undefined ? patch.due : row.due,
    })
    if (Object.keys(problems).length > 0) throw invalid(problems)
    if (patch.parentId) checkParent(row.projectId, patch.parentId, row.id)
    if (patch.ownerId !== undefined) checkOwner(row.projectId, patch.ownerId, row.ownerId)
    if (patch.partId !== undefined) checkPart(row.projectId, patch.partId, row.partId)

    if (patch.title !== undefined) row.title = trimmed(patch.title)!
    if (patch.parentId !== undefined) row.parentId = patch.parentId
    if (patch.purpose !== undefined) row.purpose = patch.purpose
    if (patch.precondition !== undefined) row.precondition = patch.precondition
    if (patch.testData !== undefined) row.testData = patch.testData
    if (patch.steps !== undefined)
      row.steps = patch.steps.map((s) => ({ action: s.action.trim(), expected: s.expected }))
    if (patch.level !== undefined) row.level = patch.level
    if (patch.start !== undefined) row.start = patch.start
    if (patch.due !== undefined) row.due = patch.due
    if (patch.ownerId !== undefined) row.ownerId = patch.ownerId
    if (patch.partId !== undefined) row.partId = patch.partId
    /* 키를 하나라도 보내면 기준을 새로 찍는다(값이 같아도). 빈 {} 는 그대로 */
    if (Object.keys(patch).length > 0) row.basisSeq = latestSeq(row.refs)
    return toCase(row)
  },
  remove(testId: string) {
    const me = requireMe()
    const row = requireTest(me, testId)
    if (!canDeleteComment(me, { authorId: row.createdBy ?? '' }, row.projectId)) throw forbidden()
    if (hasChildren(row.id))
      throw mockError(409, 'TEST_HAS_CHILDREN', '하위 테스트가 있는 테스트는 지울 수 없습니다.')
    const db = mockDb()
    db.tests = db.tests.filter((t) => t.id !== testId)
  },
  status(testId: string, input: TestStatusInput): TestCase {
    const me = requireMe()
    const row = requireTest(me, testId)
    if (hasChildren(row.id))
      throw mockError(
        400,
        'TEST_GROUP_STATUS',
        '하위 테스트가 있는 테스트는 상태를 직접 바꾸지 않습니다.',
      )
    const problems = testStatusProblem(input.status, input.note, input.failedStep, row.steps.length)
    if (Object.keys(problems).length > 0) throw invalid(problems)
    /* 같은 상태로 다시 보내도 시각 · 사람을 새로 찍는다(덮어쓴다) */
    row.status = input.status
    row.statusChangedAt = nowIso()
    row.statusChangedBy = me.id
    row.failedStep = input.status === 'fail' ? (input.failedStep ?? null) : null
    row.resultNote =
      input.status === 'fail' || input.status === 'blocked' ? (input.note ?? '').trim() : ''
    return toCase(row)
  },
  putRef(testId: string, ref: TestRef): TestCase {
    const me = requireMe()
    const row = requireTest(me, testId)
    requireRefTarget(row.projectId, ref)
    if (row.refs.some((r) => r.kind === ref.kind && r.id === ref.id)) return toCase(row)
    if (row.refs.length >= TEST_REF_MAX) throw refLimit()
    row.refs = sortRefs([...row.refs, ref])
    row.basisSeq = latestSeq(row.refs)
    return toCase(row)
  },
  deleteRef(testId: string, ref: TestRef) {
    const me = requireMe()
    const row = requireTest(me, testId)
    const next = row.refs.filter((r) => !(r.kind === ref.kind && r.id === ref.id))
    if (next.length === row.refs.length) return
    row.refs = next
    row.basisSeq = latestSeq(row.refs)
  },
  basis(testId: string): TestCase {
    const row = requireTest(requireMe(), testId)
    row.basisSeq = latestSeq(row.refs)
    return toCase(row)
  },
}

/* 보낸 것을 서버처럼 JSON 으로 한 번 거친다 — 화면의 반응형 배열(Proxy)을 그대로 쥐면 structuredClone 이 못 한다 */
const sent = <T>(body: T): T => JSON.parse(JSON.stringify(body)) as T

/** 그 프로젝트의 테스트 전부(seq 순) — '지금' · 목록 · 간트 · 작업 · 안건 상세의 칩이 같이 쓴다 */
export const fetchTests = (projectId: string) =>
  isMockMode()
    ? later(() => mock.list(projectId))
    : request<TestCase[]>('GET', `/projects/${id(projectId)}/tests`)

export const createTest = (projectId: string, input: TestInput) =>
  isMockMode()
    ? later(() => mock.create(projectId, sent(input)))
    : request<TestCase>('POST', `/projects/${id(projectId)}/tests`, input)

export const fetchTest = (testId: string) =>
  isMockMode() ? later(() => mock.get(testId)) : request<TestCase>('GET', `/tests/${id(testId)}`)

export const patchTest = (testId: string, patch: TestPatch) =>
  isMockMode()
    ? later(() => mock.patch(testId, sent(patch)))
    : request<TestCase>('PATCH', `/tests/${id(testId)}`, patch)

export const deleteTest = (testId: string) =>
  isMockMode() ? later(() => mock.remove(testId)) : request<void>('DELETE', `/tests/${id(testId)}`)

export const setTestStatus = (testId: string, input: TestStatusInput) =>
  isMockMode()
    ? later(() => mock.status(testId, sent(input)))
    : request<TestCase>('POST', `/tests/${id(testId)}/status`, input)

export const putTestRef = (testId: string, ref: TestRef) =>
  isMockMode()
    ? later(() => mock.putRef(testId, sent(ref)))
    : request<TestCase>('PUT', `/tests/${id(testId)}/refs/${ref.kind}/${id(ref.id)}`)

export const deleteTestRef = (testId: string, ref: TestRef) =>
  isMockMode()
    ? later(() => mock.deleteRef(testId, sent(ref)))
    : request<void>('DELETE', `/tests/${id(testId)}/refs/${ref.kind}/${id(ref.id)}`)

export const confirmTestBasis = (testId: string) =>
  isMockMode()
    ? later(() => mock.basis(testId))
    : request<TestCase>('POST', `/tests/${id(testId)}/basis`)
