import type { CheckRequest, Task, TaskAgendaLink, Agenda } from '@/types/domain'

/* 확인 요청의 규칙 (docs/api/check.md) — 목업 갈래와 안건 상세가 같이 쓴다.
   서버가 정하는 것을 화면이 미리 보여 주려고 같은 셈을 한 벌만 둔다 */

export const isPending = (c: CheckRequest) => c.confirmedAt === null

/** 그 결정 판으로 보낸 줄 — 들어온 순서(받는 사람 순서) 그대로 */
export const checksOfRev = (checks: CheckRequest[], agendaId: string, decisionRev: number) =>
  checks.filter((c) => c.agendaId === agendaId && c.decisionRev === decisionRev)

/** 받는 사람을 셀 때 쓰는 것 — 스냅샷의 작업 · 링크와 이 프로젝트의 활성 멤버 */
export interface CheckRecipientWorld {
  agenda: Agenda
  tasks: Task[]
  taskAgendas: TaskAgendaLink[]
  senderId: string | null
  /** 지금 이 프로젝트에 부여된 활성 멤버인가 */
  eligible: (memberId: string) => boolean
}

/**
 * 받는 사람 — ① 연결된 작업의 담당자(작업 순) ② 안건의 참조(ccIds 순) (docs/api/cc.md).
 * 겹치면 처음 자리 하나, 누른 사람은 빼고, 활성 멤버가 아니면 조용히 건너뛴다
 */
export function checkRecipients(w: CheckRecipientWorld): string[] {
  const linked = new Set(
    w.taskAgendas.filter((l) => l.agendaId === w.agenda.id).map((l) => l.taskId),
  )
  const owners = w.tasks
    .filter((t) => linked.has(t.id) && t.ownerId !== null)
    .map((t) => t.ownerId as string)
  const out: string[] = []
  for (const id of [...owners, ...w.agenda.ccIds]) {
    if (id === w.senderId || out.includes(id) || !w.eligible(id)) continue
    out.push(id)
  }
  return out
}

/** [확인 요청] 을 못 누르는 까닭 — 서버의 검사 순서와 같다. 누를 수 있으면 null */
export type CheckBlock = 'not-decided' | 'sent' | 'no-recipients'

export function checkBlock(
  agenda: Agenda,
  sent: boolean,
  recipientCount: number,
): CheckBlock | null {
  if (agenda.state !== 'decided') return 'not-decided'
  if (sent) return 'sent'
  if (recipientCount === 0) return 'no-recipients'
  return null
}

export const CHECK_BLOCK_LABEL: Record<CheckBlock, string> = {
  'not-decided': '결정된 안건만 보낼 수 있어요',
  sent: '이 결정은 보냈어요',
  'no-recipients': '받을 사람이 없어요 — 연결 작업에 담당자를 정하거나 참조를 더하세요',
}

/** 한 번에 보낸 묶음 — 같은 결정 판으로 보낸 줄들 */
export interface CheckBatch {
  /** 묶음을 가르는 이름 — agendaId#decisionRev */
  key: string
  agendaId: string
  decisionRev: number
  /** 보낼 때 찍어 둔 결정내용 */
  decision: string
  senderId: string
  createdAt: string
  rows: CheckRequest[]
  confirmed: number
}

/** 결정 판별로 묶는다. 묶음 순서는 처음 보낸 순서 */
export function groupByRev(rows: CheckRequest[]): CheckBatch[] {
  const by = new Map<string, CheckBatch>()
  for (const c of rows) {
    const key = `${c.agendaId}#${c.decisionRev}`
    let b = by.get(key)
    if (!b) {
      b = {
        key,
        agendaId: c.agendaId,
        decisionRev: c.decisionRev,
        decision: c.decision,
        senderId: c.senderId,
        createdAt: c.createdAt,
        rows: [],
        confirmed: 0,
      }
      by.set(key, b)
    }
    b.rows.push(c)
    if (!isPending(c)) b.confirmed += 1
  }
  return [...by.values()]
}

/* 시각이 같으면 들어온 순서(seq)대로 — 한 번에 보낸 줄이 받는 사람 순서 그대로 선다 */
const bySeq = <T>(rows: T[]) => rows.map((row, seq) => ({ row, seq }))

/** 받은 것 — 대기 먼저(오래된 순), 그다음 확인(최근 확인 순) */
export function sortReceived(rows: CheckRequest[]): CheckRequest[] {
  return bySeq(rows)
    .sort((a, b) => {
      const pa = isPending(a.row)
      const pb = isPending(b.row)
      if (pa !== pb) return pa ? -1 : 1
      if (pa) return a.row.createdAt.localeCompare(b.row.createdAt) || a.seq - b.seq
      return b.row.confirmedAt!.localeCompare(a.row.confirmedAt!) || a.seq - b.seq
    })
    .map((x) => x.row)
}

/** 보낸 것 — 묶음 하나가 한 줄, 최근 순 */
export function sortSentBatches(batches: CheckBatch[]): CheckBatch[] {
  return bySeq(batches)
    .sort((a, b) => b.row.createdAt.localeCompare(a.row.createdAt) || b.seq - a.seq)
    .map((x) => x.row)
}
