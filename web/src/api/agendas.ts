import { id, mockError, request } from '@/api/client'
import { recordMockHistory } from '@/api/history'
import { forbidden, later, mockDb, mockWorld, requireMe } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { canDeleteAgenda, canSeeProject } from '@/lib/access'
import { change } from '@/lib/history'
import type { Agenda, AgendaInput, AgendaPatch } from '@/types/domain'

export const createAgenda = (projectId: string, input: AgendaInput) =>
  request<Agenda>('POST', `/projects/${id(projectId)}/agendas`, input)

/** 결정내용 · 상태도 여기서 바꾼다 — decidedAt · decisionRev 는 서버가 다시 찍어 돌려준다 */
export const patchAgenda = (agendaId: string, patch: AgendaPatch) =>
  request<Agenda>('PATCH', `/agendas/${id(agendaId)}`, patch)

/* 목업 갈래 — 안건 · 작업 연결은 데이터 스토어가 들고 있어 응답 뒤에 스토어가 뺀다.
   여기서는 서버처럼 404 → 403 순으로 보고, 목업 서버가 따로 든 확인 요청 · 테스트 태그를 걷고 이력을 남긴다 */
function mockDeleteAgenda(agendaId: string) {
  const me = requireMe()
  const agenda = mockWorld().agendas.find((t) => t.id === agendaId)
  if (!agenda || !canSeeProject(me, agenda.projectId))
    throw mockError(404, 'AGENDA_NOT_FOUND', '안건을 찾을 수 없습니다.')
  if (!canDeleteAgenda(me, agenda, agenda.projectId)) throw forbidden()
  const db = mockDb()
  db.checks = db.checks.filter((c) => c.agendaId !== agendaId)
  for (const t of db.tests)
    t.refs = t.refs.filter((r) => !(r.kind === 'agenda' && r.id === agendaId))
  recordMockHistory('agenda', agendaId, [change('deleted', null, null)])
}

/** 안건 지우기(논리 삭제) — 생성자 · 담당자 · 관리자. 작업 연결 · 확인 요청 · 테스트 태그도 어디서도 안 보이게 된다 */
export const deleteAgenda = (agendaId: string) =>
  isMockMode()
    ? later(() => mockDeleteAgenda(agendaId))
    : request<void>('DELETE', `/agendas/${id(agendaId)}`)
