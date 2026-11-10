import { isRecord, MOCK_STEP_MS, postSseMessages, settle, sleep, type SseMessage } from '@/api/chat'
import { id, mockError, request, unreachable } from '@/api/client'
import { recordMockHistory } from '@/api/history'
import { later, mockDb, mockWorld, requireMe } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import type { MockTestCase } from '@/fixtures'
import { mockPatchTest, mockPutTestRef } from '@/api/tests'
import { canEditTask, canSeeProject } from '@/lib/access'
import { firstLine } from '@/lib/agenda'
import { nowIso } from '@/lib/date'
import { bodyChanged, bodyText, change, diffChanges } from '@/lib/history'
import {
  bareLines,
  IMPACT_EMPTY_SUMMARY,
  inReview,
  linkOnly,
  sameBody,
  taskProposalProblems,
  taskUnchanged,
  testUnchanged,
  UNCHANGED_TEXT,
} from '@/lib/impact'
import { TEST_REF_MAX, testFieldProblems } from '@/lib/testcase'
import type {
  Agenda,
  AgendaImpact,
  AgendaImpactState,
  ImpactApplyInput,
  ImpactApplyResult,
  ImpactBodyLine,
  ImpactConflict,
  ImpactEvent,
  ImpactTask,
  ImpactTest,
  Me,
  Task,
  TaskAgendaLink,
  TaskLine,
  TestCase,
} from '@/types/domain'

/* AI 영향도 분석 (docs/api/impact.md). 칸 그리기(GET) · 분석(SSE, 끝까지 받으면 서버가 남긴다) · 반영(한 트랜잭션).
   스트림은 챗봇 · 회의록과 같은 틀(postSseMessages) — event 는 tool · impact · done · error.
   목업 갈래는 같은 규칙으로 고르고, 반영 검사도 서버와 같은 순서로 본다 */

/** 넣어 주는 상한 — 계약 '무엇을 Claude 에 넣나' */
const TASK_LIMIT = 40
const TEST_LIMIT = 40
const AGENDA_LIMIT = 80

const agendaNotFound = () => mockError(404, 'AGENDA_NOT_FOUND', '안건을 찾을 수 없습니다.')
const impactNotFound = () => mockError(404, 'IMPACT_NOT_FOUND', '영향도 분석을 찾을 수 없습니다.')
const invalid = (detail: Record<string, string>) =>
  mockError(422, 'VALIDATION_ERROR', '입력값이 올바르지 않습니다.', detail)

/* 화면의 반응형 배열(Proxy)을 그대로 쥐면 structuredClone 이 못 한다 — JSON 으로 한 번 거친다 */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** 못 보는 프로젝트 · 지운 안건은 없는 것처럼 404 */
function requireAgenda(me: Me, agendaId: string): Agenda {
  const agenda = mockWorld().agendas.find((t) => t.id === agendaId)
  if (!agenda || !canSeeProject(me, agenda.projectId)) throw agendaNotFound()
  return agenda
}

/** 분석에 넣는 셋 — 연결 작업(seq 순) · 닿는 테스트(seq 순) · 다른 결정된 안건(결정 시각 최신 순) */
function gather(agenda: Agenda) {
  const world = mockWorld()
  const linked = new Set(
    world.taskAgendas.filter((l) => l.agendaId === agenda.id).map((l) => l.taskId),
  )
  const tasks = world.tasks.filter((t) => linked.has(t.id) && t.projectId === agenda.projectId)
  /* 이 안건을 직접 태그했거나, 이 안건에 걸린 작업을 태그한 테스트 (test.md '닿는 안건' 의 거꾸로) */
  const tests = mockDb().tests.filter(
    (t) =>
      t.projectId === agenda.projectId &&
      t.refs.some(
        (r) =>
          (r.kind === 'agenda' && r.id === agenda.id) || (r.kind === 'task' && linked.has(r.id)),
      ),
  )
  const decided = world.agendas
    .filter(
      (t) =>
        t.projectId === agenda.projectId &&
        t.id !== agenda.id &&
        t.state === 'decided' &&
        t.decision.trim() !== '',
    )
    /* 결정 시각 최신 순, 같으면 나중에 등록한 것, 결정 시각이 없으면 맨 뒤 */
    .sort(
      (a, b) =>
        (b.decidedAt ?? '').localeCompare(a.decidedAt ?? '') ||
        b.createdAt.localeCompare(a.createdAt),
    )
  return { tasks, tests, decided, linked }
}

/** 결정 전 — 안건 이력에서 결정내용이 바뀐 가장 최근 줄의 from. 없거나 비어 있으면 처음 결정(null) */
function decisionBefore(agendaId: string): string | null {
  const rows = mockDb().agendaHistory[agendaId] ?? []
  for (let i = rows.length - 1; i >= 0; i--) {
    const c = rows[i].changes.find((x) => x.field === 'decision')
    if (c) return typeof c.from === 'string' && c.from.trim() !== '' ? c.from.trim() : null
  }
  return null
}

const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s)

/* ── 숨은 영향 — 목업 검색 ────────────────────────────── */

/* 낱말 끝의 조사를 떼어 '우분투로' 와 '우분투' 가 같은 낱말이 되게 — 남는 것이 두 자 이상일 때만 */
const PARTICLES = ['으로', '로', '을', '를', '은', '는', '이', '가', '에', '의', '와', '과', '도']
function stem(word: string) {
  const p = PARTICLES.find((x) => word.endsWith(x) && word.length - x.length >= 2)
  return p ? word.slice(0, -p.length) : word
}

/** 결정 첫 줄의 낱말 — 두 자 이상만(조사 · 한 글자는 검색어로 너무 넓다) */
const wordsOf = (text: string) =>
  firstLine(text)
    .split(/[\s,.·()[\]'"/:;!?~-]+/)
    .map(stem)
    .filter((w) => w.length >= 2)

/**
 * 결정 전 → 후에서 바뀐 낱말 짝 — 전에만 있는 낱말(옛 값)과 후에만 있는 낱말(새 값)을 차례로 짝짓는다.
 * 새 값이 모자라면 첫 새 값과. 전이 없거나 새 값이 없으면 찾을 것이 없다
 */
function changedWords(before: string | null, after: string): { from: string; to: string }[] {
  if (before === null) return []
  const a = wordsOf(before)
  const b = wordsOf(after)
  const lower = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()))
  const inA = lower(a)
  const inB = lower(b)
  const gone = [
    ...new Map(
      a.filter((w) => !inB.has(w.toLowerCase())).map((w) => [w.toLowerCase(), w]),
    ).values(),
  ]
  const fresh = b.filter((w) => !inA.has(w.toLowerCase()))
  if (fresh.length === 0) return []
  return gone.map((from, i) => ({ from, to: fresh[i] ?? fresh[0] }))
}

const hit = (text: string, word: string) => text.toLowerCase().includes(word.toLowerCase())
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const swap = (text: string, from: string, to: string) =>
  text.replace(new RegExp(escapeRe(from), 'gi'), to)

/** 검색으로 찾은 것 — 연결 안 된 작업 하나(update) · 테스트 하나(check), 걸린 낱말 짝과 함께 */
interface HiddenHits {
  searched: boolean
  task: { task: Task; from: string; to: string } | null
  test: { test: MockTestCase; from: string; to: string } | null
}

/**
 * 목업의 search_tasks · search_tests — 바뀐 낱말의 옛 값으로 그 프로젝트의 연결 안 된 작업(제목 · 본문 줄) ·
 * 닿지 않는 테스트(제목 · 내용 · 테스트 데이터)를 찾는다. 낱말 짝 순서대로 처음 걸린 것 하나씩
 */
function searchHidden(
  agenda: Agenda,
  linkedTasks: Set<string>,
  linkedTests: Set<string>,
  before: string | null,
): HiddenHits {
  const pairs = changedWords(before, agenda.decision.trim())
  const out: HiddenHits = { searched: pairs.length > 0, task: null, test: null }
  for (const { from, to } of pairs) {
    if (!out.task) {
      const task = mockWorld().tasks.find(
        (t) =>
          t.projectId === agenda.projectId &&
          !linkedTasks.has(t.id) &&
          (hit(t.title, from) || t.body.some((l) => hit(l.text, from))),
      )
      if (task) out.task = { task, from, to }
    }
    if (!out.test) {
      const test = mockDb().tests.find(
        (t) =>
          t.projectId === agenda.projectId &&
          !linkedTests.has(t.id) &&
          (hit(t.title, from) || hit(t.content, from) || hit(t.testData, from)),
      )
      if (test) out.test = { test, from, to }
    }
  }
  return out
}

/** 연결 안 된 작업의 고칠 안 — 옛 낱말이 든 첫 본문 줄을, 본문에 없으면 제목을 */
function hiddenTask({ task, from, to }: NonNullable<HiddenHits['task']>): ImpactTask {
  const base = {
    taskId: task.id,
    before: taskBefore(task),
    appliedAt: null,
    linked: false,
    linkedOnApply: false,
  }
  const reason = `결정이 '${from}' 에서 '${to}' 로 바뀌었는데 이 작업은 아직 '${from}' 를 전제로 합니다. 이 안건에 연결되어 있지 않습니다.`
  const at = task.body.findIndex((l) => hit(l.text, from))
  if (at < 0) return { ...base, verdict: 'update', reason, title: swap(task.title, from, to) }
  const body = bareLines(plain(task.body))
  body[at] = { ...body[at], text: swap(body[at].text, from, to) }
  return { ...base, verdict: 'update', reason, body }
}

const taskBefore = (t: Task): ImpactTask['before'] => ({
  title: t.title,
  body: bareLines(plain(t.body)),
})

const testBefore = (t: MockTestCase): ImpactTest['before'] => ({
  title: t.title,
  content: t.content,
  testData: t.testData,
})

/**
 * 목업의 판정 — 본문이 있는 첫 연결 작업을 update(본문 한 줄을 고친 안, 본문이 하나도 없으면 첫 작업 제목),
 * 첫 닿는 테스트를 update(내용 끝에 한 줄), 나머지는 ok, 다른 결정 안건이 있으면 첫 것을 check.
 * 검색으로 찾은 연결 안 된 작업은 update(옛 낱말 → 새 낱말), 테스트는 check — 둘 다 linked false
 */
function mockJudge(agenda: Agenda, me: Me, hidden: HiddenHits): AgendaImpact {
  const { tasks, tests, decided } = gather(agenda)
  const before = decisionBefore(agenda.id)
  const after = agenda.decision.trim()
  const afterLine = clip(firstLine(after))
  const why = before
    ? `결정이 '${clip(firstLine(before))}' 에서 '${afterLine}' 로 바뀌어`
    : `새 결정 '${afterLine}' 에 비춰 보면`
  const linkFlags = { linked: true, linkedOnApply: false }

  const picked = tasks.slice(0, TASK_LIMIT)
  const target = picked.find((t) => t.body.length > 0) ?? picked[0]
  const impactTasks: ImpactTask[] = picked.map((t) => {
    const base = { taskId: t.id, before: taskBefore(t), appliedAt: null, ...linkFlags }
    if (t !== target) return { ...base, verdict: 'ok', reason: '바뀐 결정과 상관없는 작업입니다.' }
    if (t.body.length === 0)
      return {
        ...base,
        verdict: 'update',
        reason: `${why} 작업 제목이 이제 맞지 않습니다.`,
        title: clip(`${t.title} (${afterLine})`, 190),
      }
    const body = bareLines(plain(t.body))
    body[0] = { ...body[0], text: `${body[0].text} — ${afterLine} 기준` }
    return { ...base, verdict: 'update', reason: `${why} 본문 첫 줄이 이제 맞지 않습니다.`, body }
  })

  const impactTests: ImpactTest[] = tests.slice(0, TEST_LIMIT).map((t, i) => {
    const base = { testId: t.id, before: testBefore(t), appliedAt: null, ...linkFlags }
    if (i > 0) return { ...base, verdict: 'ok', reason: '바뀐 결정과 상관없는 테스트입니다.' }
    const line = `바뀐 결정 확인: ${afterLine}`
    return {
      ...base,
      verdict: 'update',
      reason: `${why} 테스트 내용에 확인할 것이 하나 늘었습니다.`,
      content: t.content ? `${t.content}\n${line}` : line,
    }
  })

  /* 찾은 줄은 넣어 준 줄(seq 순) 다음에 — 서버 '결과 줄 순서' */
  if (hidden.task) impactTasks.push(hiddenTask(hidden.task))
  if (hidden.test) {
    const { test, from, to } = hidden.test
    impactTests.push({
      testId: test.id,
      verdict: 'check',
      reason: `결정이 '${from}' 에서 '${to}' 로 바뀌었는데 이 테스트에 '${from}' 가 적혀 있어 확인이 필요합니다. 이 안건에 닿지 않는 테스트입니다.`,
      before: testBefore(test),
      appliedAt: null,
      linked: false,
      linkedOnApply: false,
    })
  }

  const conflicts: ImpactConflict[] = decided
    .slice(0, AGENDA_LIMIT)
    .slice(0, 1)
    .map((t) => ({
      agendaId: t.id,
      verdict: 'check',
      reason: `'${clip(t.title)}' 의 결정('${clip(firstLine(t.decision))}')과 범위가 겹치는지 확인이 필요합니다.`,
      decision: t.decision,
    }))

  const found = (hidden.task ? 1 : 0) + (hidden.test ? 1 : 0)
  const empty = tasks.length === 0 && tests.length === 0 && decided.length === 0
  const db = mockDb()
  db.impactSeq += 1
  return {
    id: `ai${db.impactSeq}`,
    projectId: agenda.projectId,
    agendaId: agenda.id,
    decisionRev: agenda.decisionRev,
    decisionBefore: before,
    decisionAfter: after,
    summary: empty
      ? IMPACT_EMPTY_SUMMARY
      : `${why} 고칠 작업 ${impactTasks.filter((t) => t.verdict === 'update').length} · 테스트 ${
          impactTests.filter((t) => t.verdict === 'update').length
        }건을 냈습니다. 다른 결정 ${conflicts.length}건은 확인해 보세요.${
          found > 0 ? ` 연결 안 된 작업 · 테스트 ${found}건을 찾았습니다.` : ''
        }`,
    tasks: impactTasks,
    tests: impactTests,
    conflicts: empty ? [] : conflicts,
    createdBy: me.id,
    createdAt: nowIso(),
  }
}

/* 1단계에서 남긴 분석(linked 칸이 없는 것)은 연결된 줄 · 연결 안 함으로 읽는다 — 계약 '모양 (늘어나는 것)' */
function fillLinkFlags(row: AgendaImpact) {
  for (const r of [...row.tasks, ...row.tests]) {
    const loose = r as { linked?: boolean; linkedOnApply?: boolean }
    loose.linked ??= true
    loose.linkedOnApply ??= false
  }
  return row
}

function mockState(agendaId: string): AgendaImpactState {
  const agenda = requireAgenda(requireMe(), agendaId)
  const { tasks, tests, decided } = gather(agenda)
  const latest = mockDb()
    .impacts.filter((r) => r.agendaId === agendaId)
    .at(-1)
  return {
    latest: latest ? structuredClone(fillLinkFlags(latest)) : null,
    taskCount: tasks.length,
    testCount: tests.length,
    decidedAgendaCount: decided.length,
  }
}

const TOOL = {
  read: { name: 'read_tasks', label: '연결 작업 읽는 중' },
  searchTasks: { name: 'search_tasks', label: '관련 작업 · 테스트 찾는 중' },
  searchTests: { name: 'search_tests', label: '관련 작업 · 테스트 찾는 중' },
  getTask: { name: 'get_task', label: '관련 작업 · 테스트 읽는 중' },
  compare: { name: 'compare_decisions', label: '다른 결정 비교 중' },
  propose: { name: 'propose_impact', label: '고칠 안 만드는 중' },
}

/**
 * 서버처럼 안건 · 결정내용은 스트림 전에 본다. 셋 다 비면 진행 줄 없이 빈 결과(검색도 안 한다).
 * 결정 전 → 후에서 바뀐 낱말이 있으면 검색 진행 줄, 찾은 작업이 있으면 읽는 진행 줄이 더 온다
 */
async function* mockStream(agendaId: string, signal: AbortSignal): AsyncGenerator<ImpactEvent> {
  const { me, agenda } = await later(() => {
    const me = requireMe()
    const agenda = requireAgenda(me, agendaId)
    if (!agenda.decision.trim())
      throw mockError(409, 'IMPACT_NO_DECISION', '결정내용이 없는 안건은 분석하지 않습니다.')
    return { me, agenda }
  })
  const { tasks, tests, decided, linked } = gather(agenda)
  const empty = tasks.length + tests.length + decided.length === 0
  const hidden: HiddenHits = empty
    ? { searched: false, task: null, test: null }
    : searchHidden(agenda, linked, new Set(tests.map((t) => t.id)), decisionBefore(agenda.id))
  if (!empty) {
    /* 서버와 같은 차례 — 넣어 줄 것을 읽고 견준 뒤, 읽기 도구를 부를 때마다 한 줄, 끝에 내기 */
    const tools = [
      TOOL.read,
      TOOL.compare,
      ...(hidden.searched ? [TOOL.searchTasks, TOOL.searchTests] : []),
      ...(hidden.task ? [TOOL.getTask] : []),
      TOOL.propose,
    ]
    for (const tool of tools) {
      await sleep(MOCK_STEP_MS * 3, signal)
      yield { type: 'tool', ...tool }
    }
  }
  await sleep(MOCK_STEP_MS * 3, signal)
  /* 끝까지 받았을 때만 남긴다 — 멈추면 아무것도 안 남는다 */
  const impact = mockJudge(agenda, me, hidden)
  mockDb().impacts.push(impact)
  yield { type: 'impact', impact: structuredClone(impact) }
  yield { type: 'done' }
}

/* ── 반영 ─────────────────────────────────────────────── */

let mockLineSeq = 0

const taskFixOf = (t: ImpactApplyInput['tasks'][number]) =>
  (['title', 'body'] as const).filter((f) => t[f] !== undefined)
const testFixOf = (t: ImpactApplyInput['tests'][number]) =>
  (['title', 'content', 'testData'] as const).filter((f) => t[f] !== undefined)

/* 줄 하나의 고칠 칸 · link 짝 — 자리 · 글은 서버(services/impact.py _line_problems)와 같다 */
const LINK_ON_LINKED = '이미 이 안건에 연결된 줄입니다 — 연결은 연결 안 된 줄에서만 합니다.'
const CHECK_WITH_FIX = '확인 필요 줄은 고칠 안이 없습니다 — 연결(link)만 보냅니다.'
const CHECK_NO_LINK = '확인 필요 줄은 연결(link)로만 고릅니다.'

function lineProblems(
  at: string,
  plan: { verdict: string; linked: boolean },
  link: boolean,
  hasFix: boolean,
  places: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (link && plan.linked) out[`${at}.link`] = LINK_ON_LINKED
  if (plan.verdict === 'check') {
    if (hasFix) out[at] = CHECK_WITH_FIX
    else if (!link) out[`${at}.link`] = CHECK_NO_LINK
  } else if (!hasFix && !link)
    out[at] = plan.linked
      ? `고칠 칸(${places})이 하나도 없습니다.`
      : `고칠 칸(${places})도 연결(link)도 없습니다.`
  return out
}

/**
 * 서버와 같은 순서로 본다 — 404 분석 → 422 모양(고른 줄 · 칸 · 연결) → 403 권한 → 409 결정 바뀜 → 409 대상 바뀜.
 * 하나라도 걸리면 아무것도 안 바꾼다. 작업은 데이터 스토어가 들고 있어 바뀐 사본 · 새 링크를 내고(넣는 것은 스토어가),
 * 테스트는 목업 서버의 것을 일반 수정 · 태그 걸기와 같은 길(mockPatchTest · mockPutTestRef)로 고친다. 이력은 둘 다 남는다.
 * 고칠 칸 없이 연결만 하는 줄은 글을 덮어쓰지 않으니 분석 뒤 바뀜을 보지 않는다(지운 대상만 본다)
 */
function mockApply(impactId: string, input: ImpactApplyInput): ImpactApplyResult {
  const me = requireMe()
  const db = mockDb()
  const world = mockWorld()
  const row = db.impacts.find((r) => r.id === impactId)
  const agenda = row ? world.agendas.find((t) => t.id === row.agendaId) : undefined
  if (!row || !agenda || !canSeeProject(me, row.projectId)) throw impactNotFound()
  fillLinkFlags(row)

  /* 걸린 자리를 한 번에 다 — 고른 줄 · 겹침 · 연결 · 칸 검사 · 분석 때와 다른 칸이 하나는 있어야 */
  const shape: Record<string, string> = {}
  if (input.tasks.length === 0 && input.tests.length === 0) shape.tasks = '반영할 줄이 없습니다.'
  input.tasks.forEach((t, i) => {
    const plan = row.tasks.find((x) => x.taskId === t.taskId && inReview(x))
    if (!plan) shape[`tasks.${i}.taskId`] = '이 분석의 고칠 작업이 아닙니다.'
    else if (input.tasks.findIndex((x) => x.taskId === t.taskId) < i)
      shape[`tasks.${i}.taskId`] = '같은 작업이 두 번 있습니다.'
    const fix = taskFixOf(t)
    const pair = plan
      ? lineProblems(`tasks.${i}`, plan, !!t.link, fix.length > 0, 'title · body')
      : {}
    Object.assign(shape, pair)
    const problems = taskProposalProblems(t)
    for (const [field, message] of Object.entries(problems)) shape[`tasks.${i}.${field}`] = message
    if (
      plan &&
      !linkOnly(plan) &&
      fix.length > 0 &&
      Object.keys(problems).length === 0 &&
      taskUnchanged(t, plan.before)
    )
      shape[`tasks.${i}`] = UNCHANGED_TEXT
  })
  input.tests.forEach((t, i) => {
    const plan = row.tests.find((x) => x.testId === t.testId && inReview(x))
    if (!plan) shape[`tests.${i}.testId`] = '이 분석의 고칠 테스트가 아닙니다.'
    else if (input.tests.findIndex((x) => x.testId === t.testId) < i)
      shape[`tests.${i}.testId`] = '같은 테스트가 두 번 있습니다.'
    const fix = testFixOf(t)
    const pair = plan
      ? lineProblems(`tests.${i}`, plan, !!t.link, fix.length > 0, 'title · content · testData')
      : {}
    Object.assign(shape, pair)
    const problems = testFieldProblems({ title: t.title, content: t.content, testData: t.testData })
    for (const [field, message] of Object.entries(problems)) shape[`tests.${i}.${field}`] = message
    if (
      plan &&
      !linkOnly(plan) &&
      fix.length > 0 &&
      Object.keys(problems).length === 0 &&
      testUnchanged(t, plan.before)
    )
      shape[`tests.${i}`] = UNCHANGED_TEXT
  })
  if (Object.keys(shape).length > 0) throw invalid(shape)

  /* 작업은 작업 상세가 칸을 잠그는 것과 같은 판단 — 연결도 같다. 테스트는 그 프로젝트 멤버 누구나라 따로 막지 않는다 */
  const denied: Record<string, string> = {}
  input.tasks.forEach((t, i) => {
    /* 지운 작업은 권한을 보지 않고 '지워짐' 으로 간다 */
    const task = world.tasks.find((x) => x.id === t.taskId)
    if (task && !canEditTask(me, task, task.projectId))
      denied[`tasks.${i}`] = '이 작업을 고칠 권한이 없습니다.'
  })
  if (Object.keys(denied).length > 0) throw mockError(403, 'FORBIDDEN', '권한이 없습니다.', denied)

  if (agenda.decisionRev !== row.decisionRev)
    throw mockError(409, 'IMPACT_STALE', '결정이 바뀌어 다시 분석해야 합니다.')

  /* 분석 뒤 바뀌었거나 지웠거나 이미 반영한 줄 — 걸린 자리 전부 */
  const moved: Record<string, string> = {}
  const changedText = '분석 뒤에 바뀌었습니다.'
  const goneText = '분석 뒤에 지워졌습니다.'
  input.tasks.forEach((t, i) => {
    const plan = row.tasks.find((x) => x.taskId === t.taskId)!
    const task = world.tasks.find((x) => x.id === t.taskId)
    if (!task) moved[`tasks.${i}`] = goneText
    else if (
      taskFixOf(t).length > 0 &&
      (plan.appliedAt !== null ||
        task.title !== plan.before.title ||
        !sameBody(task.body, plan.before.body))
    )
      moved[`tasks.${i}`] = changedText
  })
  input.tests.forEach((t, i) => {
    const plan = row.tests.find((x) => x.testId === t.testId)!
    const test = db.tests.find((x) => x.id === t.testId)
    if (!test) moved[`tests.${i}`] = goneText
    else if (
      testFixOf(t).length > 0 &&
      (plan.appliedAt !== null ||
        test.title !== plan.before.title ||
        test.content !== plan.before.content ||
        test.testData !== plan.before.testData)
    )
      moved[`tests.${i}`] = changedText
  })
  if (Object.keys(moved).length > 0)
    throw mockError(
      409,
      'IMPACT_TARGET_CHANGED',
      '분석 뒤에 바뀐 작업 · 테스트가 있어 반영하지 않았습니다.',
      moved,
    )

  /* 태그 상한은 태그 걸기 서비스 그대로(400 TEST_REF_LIMIT) — 서버는 걸 때 나서 되돌리고 그 줄 자리로 낸다.
     목업은 되돌릴 수 없어 바꾸기 전에 본다. 이미 걸려 있으면 멱등이라 세지 않는다 */
  input.tests.forEach((t, i) => {
    const test = db.tests.find((x) => x.id === t.testId)!
    if (
      t.link &&
      !test.refs.some((r) => r.kind === 'agenda' && r.id === agenda.id) &&
      test.refs.length >= TEST_REF_MAX
    ) {
      const message = `태그는 ${TEST_REF_MAX}개까지 걸 수 있습니다.`
      throw mockError(400, 'TEST_REF_LIMIT', message, { [`tests.${i}.link`]: message })
    }
  })

  const at = nowIso()
  const links: TaskAgendaLink[] = []
  const tasks: Task[] = input.tasks.map((t) => {
    const task = world.tasks.find((x) => x.id === t.taskId)!
    const title = t.title === undefined ? undefined : t.title.trim()
    /* 같은 자리의 줄은 기존 id 를 이어 쓴다 — 일반 PATCH 의 id 유지와 같은 효과 */
    const body: TaskLine[] | undefined = t.body?.map((l, i) => {
      const kept = task.body[i]?.id
      if (kept) return { id: kept, ...l }
      mockLineSeq += 1
      return { id: `${task.id}-i${mockLineSeq}`, ...l }
    })
    const changes = diffChanges(task, { title }, 'task')
    if (body && bodyChanged(task.body, body))
      changes.push(change('body', bodyText(task.body), bodyText(body)))
    recordMockHistory('task', task.id, changes)
    /* 이 안건에 연결 — 링크 PUT 과 같은 몸통이라 이력도 따로 한 줄. 이미 걸려 있으면 그대로(멱등),
       새로 건 것만 낸다. 링크는 데이터 스토어가 응답의 links 로 더한다 */
    if (
      t.link &&
      !world.taskAgendas.some((l) => l.taskId === task.id && l.agendaId === agenda.id)
    ) {
      links.push({ taskId: task.id, agendaId: agenda.id })
      recordMockHistory('task', task.id, [change('agenda', null, agenda.id)])
    }
    /* 반영한 값을 남긴다 — 보낸 칸이 고친 안이 되고 안 보낸 고친 안 칸은 빠진다 */
    const plan = row.tasks.find((x) => x.taskId === t.taskId)!
    plan.appliedAt = at
    if (t.link) plan.linkedOnApply = true
    delete plan.title
    delete plan.body
    if (title !== undefined) plan.title = title
    if (t.body) plan.body = bareLines(t.body)
    return { ...plain(task), ...(title !== undefined ? { title } : {}), ...(body ? { body } : {}) }
  })
  const tests: TestCase[] = input.tests.map((t) => {
    const patch: { title?: string; content?: string; testData?: string } = {}
    if (t.title !== undefined) patch.title = t.title
    if (t.content !== undefined) patch.content = t.content
    if (t.testData !== undefined) patch.testData = t.testData
    const plan = row.tests.find((x) => x.testId === t.testId)!
    plan.appliedAt = at
    if (t.link) plan.linkedOnApply = true
    delete plan.title
    delete plan.content
    delete plan.testData
    Object.assign(plan, {
      ...patch,
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    })
    let out: TestCase | null = Object.keys(patch).length > 0 ? mockPatchTest(t.testId, patch) : null
    if (t.link) out = mockPutTestRef(t.testId, { kind: 'agenda', id: agenda.id })
    return out!
  })
  return { tasks, tests, links, impact: structuredClone(row) }
}

/* ── 서버 스트림 읽기 ─────────────────────────────────── */

const str = (v: unknown): v is string => typeof v === 'string'
const isVerdict = (v: unknown) => v === 'update' || v === 'check' || v === 'ok'

function toLines(v: unknown): ImpactBodyLine[] | null {
  if (!Array.isArray(v)) return null
  const out = v.map((l) =>
    isRecord(l) &&
    (l.kind === 'check' || l.kind === 'bullet') &&
    str(l.text) &&
    typeof l.done === 'boolean' &&
    typeof l.level === 'number'
      ? { kind: l.kind, text: l.text, done: l.done, level: l.level }
      : null,
  )
  return out.every((l): l is ImpactBodyLine => l !== null) ? out : null
}

/* 1단계에서 남긴 분석은 linked 칸이 없다 — 서버가 채워 주지만 없으면 연결된 줄 · 연결 안 함으로 읽는다 */
const linkFlagsOf = (v: Record<string, unknown>) => ({
  linked: typeof v.linked === 'boolean' ? v.linked : true,
  linkedOnApply: typeof v.linkedOnApply === 'boolean' ? v.linkedOnApply : false,
})

/* 아는 칸만 옮긴다 — 반영 때 고친 값을 다시 보내므로 모르는 칸을 싣지 않는다 */
function toTask(v: unknown): ImpactTask | null {
  if (!isRecord(v) || !str(v.taskId) || !isVerdict(v.verdict) || !str(v.reason)) return null
  const before = isRecord(v.before) ? v.before : null
  const beforeBody = before ? toLines(before.body) : null
  if (!before || !str(before.title) || !beforeBody) return null
  if (v.appliedAt != null && !str(v.appliedAt)) return null
  const out: ImpactTask = {
    taskId: v.taskId,
    verdict: v.verdict as ImpactTask['verdict'],
    reason: v.reason,
    before: { title: before.title, body: beforeBody },
    appliedAt: (v.appliedAt as string | null | undefined) ?? null,
    ...linkFlagsOf(v),
  }
  if (v.title != null) {
    if (!str(v.title)) return null
    out.title = v.title
  }
  if (v.body != null) {
    const body = toLines(v.body)
    if (!body) return null
    out.body = body
  }
  return out
}

function toTest(v: unknown): ImpactTest | null {
  if (!isRecord(v) || !str(v.testId) || !isVerdict(v.verdict) || !str(v.reason)) return null
  const before = isRecord(v.before) ? v.before : null
  if (!before || !str(before.title) || !str(before.content) || !str(before.testData)) return null
  if (v.appliedAt != null && !str(v.appliedAt)) return null
  const out: ImpactTest = {
    testId: v.testId,
    verdict: v.verdict as ImpactTest['verdict'],
    reason: v.reason,
    before: { title: before.title, content: before.content, testData: before.testData },
    appliedAt: (v.appliedAt as string | null | undefined) ?? null,
    ...linkFlagsOf(v),
  }
  for (const field of ['title', 'content', 'testData'] as const) {
    const value = v[field]
    if (value == null) continue
    if (!str(value)) return null
    out[field] = value
  }
  return out
}

function toConflict(v: unknown): ImpactConflict | null {
  if (!isRecord(v) || !str(v.agendaId) || !str(v.reason)) return null
  if (v.verdict !== 'conflict' && v.verdict !== 'check') return null
  return {
    agendaId: v.agendaId,
    verdict: v.verdict,
    reason: v.reason,
    decision: str(v.decision) ? v.decision : '',
  }
}

function every<T>(v: unknown, to: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null
  const out = v.map(to)
  return out.every((x): x is T => x !== null) ? out : null
}

/** 분석 하나 — GET 의 latest 와 SSE impact 가 같은 모양이다 */
export function toImpact(v: unknown): AgendaImpact | null {
  if (!isRecord(v)) return null
  const { id: impactId, projectId, agendaId, decisionRev, decisionAfter, summary, createdAt } = v
  if (!str(impactId) || !str(projectId) || !str(agendaId) || typeof decisionRev !== 'number')
    return null
  if (!str(decisionAfter) || !str(summary) || !str(createdAt)) return null
  const decisionBefore = v.decisionBefore ?? null
  const createdBy = v.createdBy ?? null
  if (decisionBefore !== null && !str(decisionBefore)) return null
  if (createdBy !== null && !str(createdBy)) return null
  const tasks = every(v.tasks, toTask)
  const tests = every(v.tests, toTest)
  const conflicts = every(v.conflicts, toConflict)
  if (!tasks || !tests || !conflicts) return null
  return {
    id: impactId,
    projectId,
    agendaId,
    decisionRev,
    decisionBefore,
    decisionAfter,
    summary,
    tasks,
    tests,
    conflicts,
    createdBy,
    createdAt,
  }
}

/** event 줄이 type 이다. 모르는 event 는 건너뛰고(null), 아는 event 의 data 가 모양이 아니면 깨진 스트림이다 */
export function toImpactEvent({ event, data }: SseMessage, status = 200): ImpactEvent | null {
  if (!['tool', 'impact', 'done', 'error'].includes(event)) return null
  let body: unknown
  try {
    body = JSON.parse(data)
  } catch {
    throw unreachable(status)
  }
  if (isRecord(body)) {
    if (event === 'tool' && str(body.label))
      return { type: 'tool', name: str(body.name) ? body.name : '', label: body.label }
    if (event === 'impact') {
      const impact = toImpact(body.impact)
      if (impact) return { type: 'impact', impact }
    }
    if (event === 'done') return { type: 'done' }
    if (event === 'error' && str(body.code) && str(body.message))
      return { type: 'error', code: body.code, message: body.message }
  }
  throw unreachable(status)
}

async function* serverStream(agendaId: string, signal: AbortSignal) {
  /* 본문 없음 — 서버가 지금 결정내용으로 본다 */
  const path = `/agendas/${id(agendaId)}/impact`
  for await (const { message, status } of postSseMessages(path, undefined, signal)) {
    const event = toImpactEvent(message, status)
    if (event) yield event
  }
}

/** 결과는 꼭 한 번 done 보다 먼저 — 없이 done 이면 깨진 스트림이다 */
async function* needImpact(events: AsyncIterable<ImpactEvent>): AsyncGenerator<ImpactEvent> {
  let got = false
  for await (const event of events) {
    if (event.type === 'impact') got = true
    if (event.type === 'done' && !got) throw unreachable(200)
    yield event
  }
}

/* GET 의 latest 는 서버 응답을 그대로 믿지 않고 같은 읽기를 거친다 — 모양이 아니면 없는 것으로 */
const readState = (s: AgendaImpactState): AgendaImpactState => ({
  latest: s.latest ? toImpact(s.latest) : null,
  taskCount: s.taskCount ?? 0,
  testCount: s.testCount ?? 0,
  decidedAgendaCount: s.decidedAgendaCount ?? 0,
})

/** 칸 그리기 — 가장 최근 분석 + 지금 세는 것(AI 없이) */
export const fetchAgendaImpact = (agendaId: string) =>
  isMockMode()
    ? later(() => mockState(agendaId))
    : request<AgendaImpactState>('GET', `/agendas/${id(agendaId)}/impact`).then(readState)

/** 분석 — tool … → impact → done. 멈추면 AbortError(DOMException)로 끝나고 아무것도 남지 않는다 */
export async function* streamAgendaImpact(
  agendaId: string,
  signal: AbortSignal,
): AsyncGenerator<ImpactEvent> {
  const events = isMockMode() ? mockStream(agendaId, signal) : serverStream(agendaId, signal)
  yield* needImpact(settle(events))
}

/** 고른 줄을 한 번에 반영 — 하나라도 틀리면 아무것도 안 바뀐다 */
export const applyAgendaImpact = (impactId: string, input: ImpactApplyInput) =>
  isMockMode()
    ? later(() => mockApply(impactId, plain(input)))
    : request<ImpactApplyResult>('POST', `/agenda-impacts/${id(impactId)}/apply`, input).then(
        (r) => ({ ...r, links: r.links ?? [] }),
      )
