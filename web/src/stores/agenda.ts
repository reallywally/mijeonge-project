import { defineStore } from 'pinia'
import { computed } from 'vue'
import * as api from '@/api'
import { ApiError } from '@/api'
import { canDeleteAgenda, canEditAgenda } from '@/lib/access'
import { BLANK_DECISION, firstLine, nextDecisionMarks } from '@/lib/agenda'
import { kstToday, monthDay, nowIso } from '@/lib/date'
import { change, agendaPatchChanges } from '@/lib/history'
import { uniqueIds } from '@/lib/member'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useCheckStore } from '@/stores/check'
import { useDataStore } from '@/stores/data'
import { useHistoryStore } from '@/stores/history'
import { usePartStore } from '@/stores/part'
import { useTestStore } from '@/stores/test'
import type {
  HistoryChange,
  Agenda,
  AgendaInput,
  AgendaPatch,
  AgendaRow,
  AgendaState,
} from '@/types/domain'

/** 결정 기한이 지났는데 아직 못 정한 안건. 기한 당일은 아직 지난 게 아니다. */
export function isOverdue(agenda: Agenda, today: string) {
  return agenda.dueDate !== null && agenda.dueDate < today && agenda.state !== 'decided'
}

/**
 * 안건 — 제목 · 설명 · 결정내용 · 상태 (docs/api/agenda.md).
 * 상태는 사람이 고른다. 결정이 언제 어떻게 바뀌었는지는 변경 이력이 남긴다.
 */
export const useAgendaStore = defineStore('agenda', () => {
  const data = useDataStore()
  const partStore = usePartStore()
  const auth = useAuthStore()
  const history = useHistoryStore()

  /** 고른 프로젝트의 안건만 */
  const agendas = computed<Agenda[]>(() =>
    data.allAgendas.filter((t) => t.projectId === data.currentProjectId),
  )

  const rows = computed<AgendaRow[]>(() => {
    /* 오늘은 계산할 때 한 번만 읽는다 — 화면을 연 채 자정을 넘기는 경우까지는 쫓지 않는다 */
    const today = kstToday()
    return agendas.value.map((agenda) => ({
      agenda,
      ownerName: data.memberName(agenda.ownerId),
      decisionLine: firstLine(agenda.decision),
      dueLabel: agenda.dueDate ? monthDay(agenda.dueDate) : '—',
      overdue: isOverdue(agenda, today),
    }))
  })

  /** [내 파트 | 전체] 로 거른 행 — 안건 목록이 쓴다. 상세는 거르지 않는다 */
  const visibleRows = computed<AgendaRow[]>(() =>
    partStore.visible ? rows.value.filter((r) => partStore.showsAgenda(r.agenda.id)) : rows.value,
  )

  /* 아래 수는 보이는 것만 센다 */

  const queuedCount = computed(
    () => visibleRows.value.filter((r) => r.agenda.state === 'queued').length,
  )
  const openCount = computed(
    () => visibleRows.value.filter((r) => r.agenda.state === 'open').length,
  )
  /** 결정 기한을 넘긴 안건 */
  const overdueCount = computed(() => visibleRows.value.filter((r) => r.overdue).length)

  /** 고칠 수 있나 — 등록한 사람 · 담당자 · 프로젝트 관리자 · 시스템 관리자. 결정내용 · 상태도 같다 */
  const canEdit = (agenda: Agenda) => canEditAgenda(auth.me, agenda, agenda.projectId)
  /** 지울 수 있나 — 고치기와 같은 경계(작업과 달리 담당자도 지운다) */
  const canDelete = (agenda: Agenda) => canDeleteAgenda(auth.me, agenda, agenda.projectId)

  /** 목업은 서버가 없어 권한도 여기서 흉내 낸다 — 서버의 403 FORBIDDEN 과 같은 모양 */
  function rejectEdit(allowed: boolean) {
    if (!data.mock || allowed) return false
    toastError(new ApiError(403, { code: 'FORBIDDEN', message: '권한이 없습니다.' }))
    return true
  }

  /* 목업은 서버가 없어 변경 이력도 여기서 남긴다 — 서버는 요청을 받아 스스로 남긴다 (docs/api/history.md) */
  function logMock(agendaId: string, changes: HistoryChange[]) {
    if (!data.mock || changes.length === 0) return
    api.recordMockHistory('agenda', agendaId, changes)
    history.touched('agenda', agendaId)
  }

  /** 서버에 보낸 쓰기가 끝나면 펼쳐 둔 이력 칸이 다시 부르게 알린다 */
  function afterWrite(agendaId: string, done: Promise<unknown>) {
    void done.finally(() => history.touched('agenda', agendaId))
  }

  /** 서버가 돌려준 안건으로 갈아끼운다 — decidedAt · decisionRev 는 서버 값이 맞다 */
  function replaceAgenda(next: Agenda) {
    const at = data.allAgendas.findIndex((t) => t.id === next.id)
    if (at >= 0) data.allAgendas[at] = next
  }

  /**
   * 안건을 등록한다 — POST /api/projects/{id}/agendas. 제목 말고는 다 비워도 들어간다.
   * 서버 모드에서는 id 를 서버가 내므로 응답을 기다렸다가 넣는다. 실패하면 알리고 null 이다.
   */
  async function addAgenda(input: AgendaInput): Promise<string | null> {
    const clean = {
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      decision: input.decision?.trim() ?? '',
      state: input.state ?? ('queued' as AgendaState),
      dueDate: input.dueDate || null,
      ownerId: input.ownerId ?? null,
      ccIds: uniqueIds(input.ccIds ?? []),
      /* 안 보내면 공통 — 작업과 달리 따를 상위가 없다 */
      partId: input.partId ?? null,
    }
    if (!data.mock) {
      try {
        const agenda = await api.createAgenda(data.currentProjectId, clean)
        data.allAgendas.unshift(agenda)
        return agenda.id
      } catch (e) {
        toastError(e)
        return null
      }
    }
    if (data.rejectOwner(clean.ownerId, 'AGENDA_OWNER_NOT_FOUND')) return null
    if (data.rejectCc(clean.ccIds, 'AGENDA_CC_NOT_FOUND')) return null
    if (data.rejectPart(clean.partId)) return null
    const id = data.nextId('nt')
    const now = nowIso()
    data.allAgendas.unshift({
      id,
      projectId: data.currentProjectId,
      ...clean,
      createdAt: now,
      ...nextDecisionMarks(BLANK_DECISION, clean, now),
      minutesId: null,
      /* 목업에서는 등록한 사람을 여기서 찍는다 — 서버 모드는 서버가 찍어 돌려준다 */
      creatorId: data.currentMemberId,
    })
    logMock(id, [change('created', null, null)])
    return id
  }

  /**
   * 안건을 고친다 — PATCH /api/agendas/{id}. 보낸 필드만 바뀐다. 결정내용 · 상태도 이 길이다.
   * 제목을 비우려 하면 아무것도 바꾸지 않는다(서버도 요청째 거절한다).
   * 화면에 먼저 반영하고 서버에 보낸 뒤 돌아온 안건으로 갈아끼운다.
   */
  function updateAgenda(agendaId: string, patch: AgendaPatch) {
    const agenda = data.allAgendas.find((t) => t.id === agendaId)
    if (!agenda) return false
    if (patch.title !== undefined && !patch.title.trim()) return false
    if (rejectEdit(canEdit(agenda))) return false
    if (data.rejectOwner(patch.ownerId, 'AGENDA_OWNER_NOT_FOUND', agenda.ownerId)) return false
    if (data.rejectCc(patch.ccIds, 'AGENDA_CC_NOT_FOUND', agenda.ccIds)) return false
    if (data.rejectPart(patch.partId, agenda.partId)) return false
    const clean: AgendaPatch = {}
    if (patch.title !== undefined) clean.title = patch.title.trim()
    if (patch.description !== undefined) clean.description = patch.description.trim()
    if (patch.decision !== undefined) clean.decision = patch.decision.trim()
    if (patch.state !== undefined) clean.state = patch.state
    if (patch.dueDate !== undefined) clean.dueDate = patch.dueDate || null
    if (patch.ownerId !== undefined) clean.ownerId = patch.ownerId
    if (patch.ccIds !== undefined) clean.ccIds = uniqueIds(patch.ccIds)
    if (patch.partId !== undefined) clean.partId = patch.partId
    /* 이력은 고치기 전 값과 견준다 */
    logMock(agendaId, agendaPatchChanges(agenda, clean))
    /* 서버가 다시 찍어 줄 값을 먼저 흉내 낸다 — 확인 요청 버튼이 바로 서게 */
    const marks = nextDecisionMarks(
      agenda,
      { decision: clean.decision ?? agenda.decision, state: clean.state ?? agenda.state },
      nowIso(),
    )
    Object.assign(agenda, clean, marks)
    if (!data.mock) {
      afterWrite(
        agendaId,
        data.save(`agenda:${agendaId}`, () => api.patchAgenda(agendaId, clean), replaceAgenda),
      )
    }
    return true
  }

  /**
   * 안건을 지운다(논리 삭제) — 작업 연결 · 확인 요청 · 테스트 태그도 어디서도 안 보이게 된다.
   * 실패하면 ApiError 를 던진다 — 이유를 띄우는 것은 화면 몫이다
   */
  async function deleteAgenda(agendaId: string) {
    await api.deleteAgenda(agendaId)
    data.allAgendas = data.allAgendas.filter((t) => t.id !== agendaId)
    data.taskAgendas = data.taskAgendas.filter((l) => l.agendaId !== agendaId)
    /* 받아 둔 확인 요청 · 테스트 태그에서도 빠졌다 — 받아 둔 목록이 있으면 다시 받는다 */
    const checkStore = useCheckStore()
    if (checkStore.loaded) void checkStore.load()
    const testStore = useTestStore()
    if (testStore.loaded) void testStore.load()
  }

  return {
    agendas,
    rows,
    visibleRows,
    queuedCount,
    openCount,
    overdueCount,
    addAgenda,
    updateAgenda,
    canEdit,
    canDelete,
    deleteAgenda,
  }
})
