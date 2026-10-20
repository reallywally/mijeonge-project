import { isRecord, mockDeltas, postSseMessages, settle, type SseMessage } from '@/api/chat'
import { id, mockError, request, unreachable } from '@/api/client'
import {
  forbidden,
  later,
  memberOf,
  mockDb,
  mockWorld,
  requireMe,
  requireProject,
} from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { fetchRisks } from '@/api/risk'
import { mockReportBody, REPORT_EMPTY } from '@/fixtures'
import { canDeleteComment, canSeeProject } from '@/lib/access'
import { collectRefs } from '@/lib/chat'
import { kstToday, nowIso } from '@/lib/date'
import { progressFacts } from '@/lib/progress'
import type { ChatRef, Me, ProgressFacts, Report, ReportEvent, ReportItem } from '@/types/domain'

/* 프로젝트 진행 리포트 (docs/api/report.md). 만들기는 SSE(facts → delta → done), 다 받아야 서버가 저장한다.
   목업 갈래는 목업 데이터로 같은 규칙(lib/progress)을 돌리고 고정 글을 흘린 뒤 목업 저장소에 넣는다 */

const notFound = () => mockError(404, 'REPORT_NOT_FOUND', '리포트를 찾을 수 없습니다.')

/** 부여받지 않은 프로젝트의 리포트는 없는 것처럼 404 */
function requireReport(me: Me, reportId: string): Report {
  const row = mockDb().reports.find((r) => r.id === reportId)
  if (!row || !canSeeProject(me, row.projectId)) throw notFound()
  return row
}

const itemOf = (r: Report): ReportItem => ({
  id: r.id,
  projectId: r.projectId,
  periodStart: r.periodStart,
  periodEnd: r.periodEnd,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  doneRate: r.doneRate,
  attentionCount: r.attentionCount,
})

/* 서버 응답처럼 늘 새 객체를 낸다 — 스토어가 받은 것을 고쳐도 목업 저장소가 따라 바뀌지 않게 */
const mock = {
  list(projectId: string): ReportItem[] {
    requireProject(requireMe(), projectId)
    return mockDb()
      .reports.filter((r) => r.projectId === projectId)
      .reverse()
      .map(itemOf)
  },
  get: (reportId: string): Report => structuredClone(requireReport(requireMe(), reportId)),
  remove(reportId: string) {
    const me = requireMe()
    const row = requireReport(me, reportId)
    if (!canDeleteComment(me, { authorId: row.createdBy }, row.projectId)) throw forbidden()
    const db = mockDb()
    db.reports = db.reports.filter((r) => r.id !== reportId)
  },
  /** 지금 목업 데이터로 계산한다 — 서버와 같은 규칙. 리스크 high · medium 은 리스크 목업 보고서에서 */
  async facts(projectId: string): Promise<{ facts: ProgressFacts; me: Me; empty: boolean }> {
    const me = await later(() => {
      const me = requireMe()
      requireProject(me, projectId)
      return me
    })
    const risk = await fetchRisks(projectId)
    const world = mockWorld()
    const tasks = world.tasks.filter((t) => t.projectId === projectId)
    const threads = world.threads.filter((t) => t.projectId === projectId)
    const threadIds = new Set(threads.map((t) => t.id))
    const taskIds = new Set(tasks.map((t) => t.id))
    const prev = mockDb()
      .reports.filter((r) => r.projectId === projectId)
      .at(-1)
    const facts = progressFacts({
      tasks,
      threads,
      entries: world.entries.filter((e) => threadIds.has(e.threadId)),
      links: world.taskThreads.filter((l) => taskIds.has(l.taskId)),
      dependencies: world.taskDependencies.filter((d) => taskIds.has(d.taskId)),
      settings: risk.settings,
      today: kstToday(),
      previous: prev
        ? {
            reportId: prev.id,
            periodEnd: prev.periodEnd,
            doneRate: prev.facts.progress.doneRate,
            blocked: prev.facts.progress.blocked,
          }
        : null,
      /* 굳혀 둔 보고서라 그사이 정해진 안건은 뺀다 */
      riskyThreadIds: risk.threads
        .filter(
          (t) =>
            (t.level === 'high' || t.level === 'medium') &&
            threads.some((th) => th.id === t.threadId && th.state !== 'decided'),
        )
        .map((t) => t.threadId),
    })
    return { facts, me, empty: tasks.length === 0 }
  },
  save(projectId: string, me: Me, facts: ProgressFacts, body: string): Report {
    const db = mockDb()
    db.reportSeq += 1
    const row: Report = {
      id: `rp${db.reportSeq}`,
      projectId,
      periodStart: facts.periodStart,
      periodEnd: facts.periodEnd,
      createdBy: me.id,
      createdAt: nowIso(),
      doneRate: facts.progress.doneRate,
      attentionCount: facts.attention.length,
      facts: structuredClone(facts),
      body,
    }
    db.reports.push(row)
    return row
  },
}

/** 그 프로젝트의 리포트 — 최근 것 먼저 */
export const fetchReports = (projectId: string) =>
  isMockMode()
    ? later(() => mock.list(projectId))
    : request<ReportItem[]>('GET', `/projects/${id(projectId)}/reports`)

export const fetchReport = (reportId: string) =>
  isMockMode()
    ? later(() => mock.get(reportId))
    : request<Report>('GET', `/reports/${id(reportId)}`)

/** 지우기 — 만든 사람 · 프로젝트 관리자 · 시스템 관리자(403) */
export const deleteReport = (reportId: string) =>
  isMockMode()
    ? later(() => mock.remove(reportId))
    : request<void>('DELETE', `/reports/${id(reportId)}`)

async function* mockEvents(projectId: string, signal: AbortSignal): AsyncGenerator<ReportEvent> {
  const { facts, me, empty } = await mock.facts(projectId)
  yield { type: 'facts', facts: structuredClone(facts) }

  const body = empty
    ? REPORT_EMPTY
    : mockReportBody(facts, {
        taskLabel: (taskId) => {
          const t = mockWorld().tasks.find((x) => x.id === taskId)
          return t ? `${t.key} ${t.title}` : taskId
        },
        ownerName: (taskId) => {
          const ownerId = mockWorld().tasks.find((x) => x.id === taskId)?.ownerId
          return (ownerId && memberOf(ownerId)?.name) || '담당자 없음'
        },
        memberName: (memberId) => (memberId && memberOf(memberId)?.name) || '담당자 없음',
      })
  /* 멈추면 sleep 이 AbortError 로 끝낸다 — 저장까지 가지 않는다 */
  for await (const e of mockDeltas(body, signal)) if (e.type === 'delta') yield e
  const saved = mock.save(projectId, me, facts, body)
  yield { type: 'done', report: itemOf(saved), refs: collectRefs(body) }
}

/** event 줄이 type 이다. 모르는 event 는 건너뛰고(null), 아는 event 의 data 가 모양이 아니면 깨진 스트림이다 */
export function toReportEvent({ event, data }: SseMessage, status = 200): ReportEvent | null {
  if (!['facts', 'delta', 'done', 'error'].includes(event)) return null
  let body: unknown
  try {
    body = JSON.parse(data)
  } catch {
    throw unreachable(status)
  }
  if (isRecord(body)) {
    const { facts, report } = body
    if (
      event === 'facts' &&
      isRecord(facts) &&
      isRecord(facts.progress) &&
      isRecord(facts.decisions) &&
      Array.isArray(facts.attention) &&
      Array.isArray(facts.people)
    )
      return { type: 'facts', facts: facts as unknown as ProgressFacts }
    if (event === 'delta' && typeof body.text === 'string')
      return { type: 'delta', text: body.text }
    if (event === 'done' && isRecord(report) && typeof report.id === 'string')
      return {
        type: 'done',
        report: report as unknown as ReportItem,
        refs: Array.isArray(body.refs) ? (body.refs as ChatRef[]) : [],
      }
    if (event === 'error' && typeof body.code === 'string' && typeof body.message === 'string')
      return { type: 'error', code: body.code, message: body.message }
  }
  throw unreachable(status)
}

async function* serverEvents(projectId: string, signal: AbortSignal): AsyncGenerator<ReportEvent> {
  for await (const { message, status } of postSseMessages(
    `/projects/${id(projectId)}/reports`,
    undefined,
    signal,
  )) {
    const event = toReportEvent(message, status)
    if (event) yield event
  }
}

/**
 * 리포트를 만든다 — facts → delta 조각들 → done(저장됨). 멈추면 AbortError(DOMException)로 끝나고 저장되지 않는다.
 * error 이벤트는 ApiError 로 던진다(settle)
 */
export async function* streamCreateReport(
  projectId: string,
  signal: AbortSignal,
): AsyncGenerator<ReportEvent> {
  if (isMockMode()) yield* settle(mockEvents(projectId, signal))
  else yield* settle(serverEvents(projectId, signal))
}
