import { id, mockError, request } from '@/api/client'
import { forbidden, later, mockDb, requireMe, requireManager } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { canManageProject, canSeeProject } from '@/lib/access'
import { partNameProblem } from '@/lib/part'
import type { Part, PartInput, PartMember, PartPatch } from '@/types/domain'

/* 파트 관리 — 쓰기는 그 프로젝트 관리자 · 시스템 관리자 (docs/api/part.md). 읽기는 스냅샷이 싣는다.
   목업 갈래도 서버와 같은 규칙 · 코드를 낸다 */

const partNotFound = () => mockError(404, 'PART_NOT_FOUND', '파트를 찾을 수 없습니다.')
const nameTaken = () =>
  mockError(409, 'PART_NAME_TAKEN', '이 프로젝트에 같은 이름의 파트가 있습니다.', {
    name: '같은 이름의 파트가 있습니다.',
  })

/** 경로의 파트 — 부여받지 않은 프로젝트의 파트도 '없다' 로 답한다 */
function requirePartManager(partId: string): Part {
  const me = requireMe()
  const part = mockDb().parts.find((p) => p.id === partId)
  if (!part || !canSeeProject(me, part.projectId)) throw partNotFound()
  if (!canManageProject(me, part.projectId)) throw forbidden()
  return part
}

function checkName(projectId: string, name: string, exceptPartId: string | null) {
  const problem = partNameProblem(name)
  if (problem)
    throw mockError(422, 'VALIDATION_ERROR', '입력값이 올바르지 않습니다.', { name: problem })
  const trimmed = name.trim()
  /* 보관한 파트와도 겹치면 안 된다 — 되살릴 때 둘이 된다 */
  if (
    mockDb().parts.some(
      (p) => p.projectId === projectId && p.name === trimmed && p.id !== exceptPartId,
    )
  )
    throw nameTaken()
  return trimmed
}

let mockSeq = 0

const mock = {
  create(projectId: string, input: PartInput): Part {
    requireManager(projectId)
    const name = checkName(projectId, input.name, null)
    mockSeq += 1
    const part: Part = { id: `mpt${mockSeq}`, projectId, name, active: true }
    mockDb().parts.push(part)
    return structuredClone(part)
  },
  patch(partId: string, patch: PartPatch): Part {
    const part = requirePartManager(partId)
    const name =
      patch.name === undefined ? undefined : checkName(part.projectId, patch.name, partId)
    if (name !== undefined) part.name = name
    if (patch.active !== undefined) part.active = patch.active
    return structuredClone(part)
  },
  join(partId: string, memberId: string): PartMember {
    const part = requirePartManager(partId)
    const db = mockDb()
    if (!db.grants.some((g) => g.projectId === part.projectId && g.memberId === memberId))
      throw mockError(400, 'MEMBER_NOT_IN_PROJECT', '이 프로젝트에 부여되지 않은 사람입니다.')
    if (!db.partMembers.some((pm) => pm.partId === partId && pm.memberId === memberId))
      db.partMembers.push({ partId, memberId })
    return { partId, memberId }
  },
  leave(partId: string, memberId: string) {
    requirePartManager(partId)
    const db = mockDb()
    db.partMembers = db.partMembers.filter(
      (pm) => !(pm.partId === partId && pm.memberId === memberId),
    )
  },
}

/** 이름은 앞뒤 공백을 떼고 1 ~ 50자. 같은 프로젝트에 같은 이름(보관 포함)이 있으면 409 PART_NAME_TAKEN */
export const createPart = (projectId: string, input: PartInput) =>
  isMockMode()
    ? later(() => mock.create(projectId, input))
    : request<Part>('POST', `/projects/${id(projectId)}/parts`, input)

/** 이름 바꾸기 · 보관(active=false) · 되살리기. 지우는 길은 없다 — 지난 작업 · 안건이 가리킨다 */
export const patchPart = (partId: string, patch: PartPatch) =>
  isMockMode()
    ? later(() => mock.patch(partId, patch))
    : request<Part>('PATCH', `/parts/${id(partId)}`, patch)

/** 파트에 넣기 (멱등). 그 프로젝트에 부여되지 않은 사람은 400 MEMBER_NOT_IN_PROJECT */
export const putPartMember = (partId: string, memberId: string) =>
  isMockMode()
    ? later(() => mock.join(partId, memberId))
    : request<PartMember>('PUT', `/parts/${id(partId)}/members/${id(memberId)}`)

/** 파트에서 빼기 (멱등) */
export const deletePartMember = (partId: string, memberId: string) =>
  isMockMode()
    ? later(() => mock.leave(partId, memberId))
    : request<void>('DELETE', `/parts/${id(partId)}/members/${id(memberId)}`)
