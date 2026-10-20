import { ATTENTION_SIGNAL_LABEL, rateLabel, statusSpan } from '@/lib/progress'
import type { ProgressFacts, TaskAttention } from '@/types/domain'

/*
 * 프로젝트 진행 리포트의 목업 글 — 계약 '답의 모양' 칸 순서를 지킨 고정 글(docs/api/report.md '시드 · 목업').
 * 근거 칩은 시드의 k20(오래 걸림) · k22(정해졌는데 막힘) · t3(기한 지난 안건)만 가리킨다.
 * 숫자 · 날짜는 '넣어 준 그대로' 여야 해서 받은 facts 에서 옮긴다 — 날이 바뀌어도 칩 옆 숫자가 거짓이 되지 않게.
 * facts 에 없는 근거는 그 줄째 뺀다(넣어 준 id 만 칩이 된다)
 */

/** 작업이 하나도 없으면 Claude 를 부르지 않고 이 한 줄을 저장한다 */
export const REPORT_EMPTY = '아직 작업이 없어 리포트를 쓸 것이 없습니다.'

export interface ReportBodyContext {
  /** 'HW-21 개발자 계정 배포' */
  taskLabel: (taskId: string) => string
  /** 작업 담당자 이름. 없으면 '담당자 없음' */
  ownerName: (taskId: string) => string
  /** 멤버 이름. null 이면 '담당자 없음' */
  memberName: (memberId: string | null) => string
}

function why(a: TaskAttention, ctx: ReportBodyContext) {
  const parts: string[] = []
  for (const s of a.signals) {
    if (s === 'longRunning')
      parts.push(
        `진행 중이 된 지 ${statusSpan(a)}${a.plannedDays !== null ? `(계획 ${a.plannedDays}일)` : ''}`,
      )
    else if (s === 'longBlocked') parts.push(`막힌 지 ${statusSpan(a)}`)
    else if (s === 'waitingOnPredecessor')
      parts.push(`선행 작업(${a.waitingOnTaskIds.map(ctx.taskLabel).join(' · ')})이 안 끝남`)
    else if (s === 'lateBlocker') continue
    else parts.push(ATTENTION_SIGNAL_LABEL[s])
  }
  return parts.join(' · ')
}

function weightLine(a: TaskAttention) {
  const w = a.weight
  const out: string[] = []
  if (w.openChildren > 0) out.push(`안 끝난 하위 작업 ${w.openChildren}개`)
  if (w.totalLines > 0) out.push(`체크리스트 ${w.totalLines}줄 중 ${w.openLines}줄 남음`)
  return out.length > 0 ? ` 무게는 ${out.join(', ')}입니다.` : ''
}

export function mockReportBody(facts: ProgressFacts, ctx: ReportBodyContext): string {
  const { progress, previous, decisions, attention, people } = facts
  const k20 = attention.find((a) => a.taskId === 'k20')
  const k22 = attention.find((a) => a.taskId === 'k22')
  const out: string[] = []

  out.push(
    k20
      ? `한 줄 총평 — 완료율 ${rateLabel(progress.doneRate)}, DB 설치 한 곳이 늦어 그 뒤 작업이 같이 밀리는 것이 이번 주 가장 큰 일입니다.`
      : `한 줄 총평 — 완료율 ${rateLabel(progress.doneRate)}, 손쓸 작업 ${attention.length}건이 있습니다.`,
  )

  out.push('', '이번 주 진척')
  out.push(
    `- 완료 ${progress.completedTaskIds.length}건 · 새로 시작 ${progress.startedTaskIds.length}건 · 새로 등록 ${progress.createdTaskIds.length}건 · 완료율 ${rateLabel(progress.doneRate)}` +
      (previous ? ` (지난 리포트 ${rateLabel(previous.doneRate)})` : ''),
  )
  out.push(
    `- 지금 진행 중 ${progress.doing} · 막힘 ${progress.blocked}` +
      (previous ? ` (지난 리포트 막힘 ${previous.blocked})` : '') +
      ` · 해야 할 일 ${progress.todo}`,
  )

  const decisionLines: string[] = []
  if (decisions.decidedThreadIds.length > 0)
    decisionLines.push(`- 이번 기간에 정해진 안건 ${decisions.decidedThreadIds.length}건`)
  if (decisions.deferredThreadIds.length > 0)
    decisionLines.push(`- 이번 기간에 미뤄진 안건 ${decisions.deferredThreadIds.length}건`)
  if (decisions.riskyThreadIds.includes('t3'))
    decisionLines.push(
      '- 아직 큰 병목 [[thread:t3]] — 결정 기한이 지났고 이력이 오래 멈춰 있습니다. 정보보안팀 확인을 받아 다음 회의에 올려 보세요.',
    )
  if (decisionLines.length > 0) out.push('', '결정', ...decisionLines)

  const first: string[] = []
  if (k20) {
    const waiting =
      k20.blockingTaskIds.length > 0
        ? ` 기다리는 작업(${k20.blockingTaskIds.map(ctx.taskLabel).join(' · ')})이 있어 늦을수록 같이 밀립니다.`
        : ''
    first.push(
      `${first.length + 1}. [[task:k20]] — ${why(k20, ctx)}.${waiting}${weightLine(k20)} ${ctx.ownerName('k20')} 님께 남은 일과 끝날 날을 확인해 보세요.`,
    )
  }
  if (k22) {
    const unblock = k22.signals.includes('decidedButBlocked')
      ? ' 걸린 안건은 모두 정해졌으니 막힌 까닭은 풀렸습니다.'
      : ''
    const pred =
      k22.waitingOnTaskIds.length > 0
        ? ` 선행이 끝나는 날에 맞춰 진행 중으로 돌릴지 정해 보세요.`
        : ' 진행 중으로 돌려도 됩니다.'
    first.push(
      `${first.length + 1}. [[task:k22]] — ${why(k22, ctx)}.${unblock}${pred} ${ctx.ownerName('k22')} 님께 권해 보세요.`,
    )
  }
  if (first.length > 0) out.push('', '먼저 손쓸 것', ...first)

  /* 몰린 사람 — 손쓸 작업이 셋 이상인 사람 */
  const crowded = people.filter((p) => p.memberId !== null && p.attentionTaskIds.length >= 3)
  if (crowded.length > 0) {
    out.push('', '사람')
    for (const p of crowded)
      out.push(
        `- ${ctx.memberName(p.memberId)} — 진행 중 ${p.doing} · 막힘 ${p.blocked} · 기한 지남 ${p.overdue}, 손쓸 작업 ${p.attentionTaskIds.length}건이 한 사람에게 모여 있습니다.`,
      )
  }

  out.push('', '다음 주 볼 것')
  if (k20) out.push(`- [[task:k20]] 이 끝나는지 — 끝나면 기다리던 뒤 작업이 같이 풀립니다.`)
  out.push(`- 기한 지난 작업이 줄어드는지 — 지금 손쓸 작업 ${attention.length}건입니다.`)
  return out.join('\n')
}
