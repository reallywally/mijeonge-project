// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_ADMIN_PASSWORD, MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import { useTaskStore } from '@/stores/task'
import { useAgendaStore } from '@/stores/agenda'
import type { TaskInput } from '@/types/domain'

/* 파트 — 목업 갈래로 로그인해서 [내 파트 | 전체] 와 파트 관리가 서버처럼 도는지 본다.
   보기 규칙 자체는 lib/part.test.ts 가 꼼꼼히 본다. 여기는 스토어 · 목업 서버에 닿는지 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

async function signedIn(email: string, password = MOCK_PASSWORD) {
  await useAuthStore().login(email, password)
  await useDataStore().retry()
}

const ALL_RIGHTS = { canView: true, canCreate: true, canUpdate: true, canDelete: true }

const lastError = () => vi.mocked(toastError).mock.calls.at(-1)?.[0]

const blankTask = (over: Partial<TaskInput> = {}): TaskInput => ({
  title: '새 작업',
  parentId: null,
  body: [],
  status: 'todo',
  ownerId: null,
  start: null,
  due: null,
  priority: 'normal',
  agendaIds: [],
  ...over,
})

beforeEach(() => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
})

describe('[내 파트 | 전체]', () => {
  it('업무(작업 · 테스트 · 리스크)는 내 파트 전부로, 안건은 전체로 시작한다', async () => {
    await signedIn('u3@inno-ax.com')
    const part = usePartStore()
    expect(part.canNarrow).toBe(true)
    expect(part.scope).toBe('mine')
    expect(part.pickedIds).toEqual(['pt1'])
    expect(useTaskStore().visibleRows).toHaveLength(10)
    expect(part.scopeOf('agenda')).toBe('all')
    expect(useAgendaStore().visibleRows).toHaveLength(useAgendaStore().rows.length)
  })

  it('두 묶음은 따로 기억한다 — 안건에서 고른 것이 작업에 번지지 않는다', async () => {
    await signedIn('u3@inno-ax.com')
    const part = usePartStore()
    part.setScope('mine', 'agenda')
    part.setScope('all')
    expect(part.pickedIdsOf('agenda')).toEqual(['pt1'])
    expect(part.pickedIds).toEqual([])
    expect(JSON.parse(localStorage.getItem('innoflow.partPick.agenda.u3.p1')!)).toEqual(['pt1'])
    expect(localStorage.getItem('innoflow.partPick.u3.p1')).toBe('[]')

    setActivePinia(createPinia())
    await signedIn('u3@inno-ax.com')
    expect(usePartStore().scope).toBe('all')
    expect(usePartStore().scopeOf('agenda')).toBe('mine')
  })

  it('내 파트는 보기 권한이 있는 소속만 — 보기를 끄면 고르기에서도 빠진다', async () => {
    await signedIn('u3@inno-ax.com')
    const data = useDataStore()
    const pm = data.partMembers.find((x) => x.partId === 'pt1' && x.memberId === 'u3')!
    pm.canView = false
    const part = usePartStore()
    expect(part.myPartIds.size).toBe(0)
    expect(part.canNarrow).toBe(false)
    expect(part.scope).toBe('all')
    /* 소속은 남는다 — 파트 관리가 그린다 */
    expect(part.partIdsOf('u3').has('pt1')).toBe(true)
  })

  it('일반 사용자(u3 · 인프라)가 내 파트를 고르면 목록 · 수가 같이 줄어든다', async () => {
    await signedIn('u3@inno-ax.com')
    const part = usePartStore()
    const task = useTaskStore()
    const agenda = useAgendaStore()

    part.setScope('mine')
    part.setScope('mine', 'agenda')
    expect(part.scope).toBe('mine')
    expect(task.visibleRows.map((r) => r.task.key)).not.toContain('HW-7')
    expect(task.visibleRows.map((r) => r.task.key)).toContain('HW-4')
    expect(task.statusCounts.all).toBe(10)
    expect(task.undatedCount).toBe(0)
    expect(agenda.visibleRows.map((r) => r.agenda.id).sort()).toEqual([
      't1',
      't2',
      't4',
      't6',
      't9',
    ])
    /* 원본 행은 그대로다 — 상세 · 챗봇은 거르지 않는다 */
    expect(task.rows).toHaveLength(22)
    expect(task.taskDetail('k7')).not.toBeNull()
  })

  it('전체로 바꾸면 다 보이고, 그 값은 프로젝트마다 브라우저에 남는다', async () => {
    await signedIn('u3@inno-ax.com')
    const part = usePartStore()
    part.setScope('all')
    expect(useTaskStore().visibleRows).toHaveLength(22)
    expect(localStorage.getItem('innoflow.partPick.u3.p1')).toBe('[]')

    /* 새로 들어와도(스토어를 새로 세워도) 기억한 값으로 선다 */
    setActivePinia(createPinia())
    await signedIn('u3@inno-ax.com')
    expect(usePartStore().scope).toBe('all')
  })

  it('프로젝트 관리자(u1)도 업무는 내 파트로 시작한다 — 조상은 흐리게 선다', async () => {
    await signedIn('u1@inno-ax.com')
    const part = usePartStore()
    expect(part.scope).toBe('mine')
    expect(useTaskStore().visibleRows.map((r) => r.task.id)).toContain('k21')
    expect(part.isContextTask('k4')).toBe(true)
  })

  it('속한 파트가 없으면 전환이 숨고 전체다 — 시스템 관리자 · 파트 없는 프로젝트', async () => {
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    expect(usePartStore().canNarrow).toBe(false)
    expect(usePartStore().scope).toBe('all')

    setActivePinia(createPinia())
    await signedIn('u2@inno-ax.com')
    const data = useDataStore()
    usePartStore().setScope('mine')
    expect(usePartStore().scope).toBe('mine')
    data.setProject('p2')
    expect(usePartStore().parts).toEqual([])
    expect(usePartStore().canNarrow).toBe(false)
    expect(useTaskStore().visibleRows.map((r) => r.task.key)).toEqual(['PAS-1', 'PAS-2'])
  })

  it('예전 [내 파트 | 전체] 로 기억한 값을 이어받는다', async () => {
    localStorage.setItem('innoflow.partScope.u3.p1', 'all')
    await signedIn('u3@inno-ax.com')
    expect(usePartStore().scope).toBe('all')
  })

  it('파트를 빼면 그 자리에서 내 파트가 다시 계산된다', async () => {
    await signedIn('u1@inno-ax.com')
    const part = usePartStore()
    expect(part.myPartIds.has('pt2')).toBe(true)
    expect(await part.leavePart('pt2', 'u1')).toBe(true)
    expect(part.canNarrow).toBe(false)
  })
})

describe('볼 파트 고르기 — 여럿을 고르고 비우면 전체', () => {
  /* 목업에는 파트가 둘인 사람이 없다 — u3(인프라)를 AI 에도 넣는다 */
  async function twoParts() {
    await signedIn('u3@inno-ax.com')
    useDataStore().partMembers.push({ partId: 'pt2', memberId: 'u3', ...ALL_RIGHTS })
    const part = usePartStore()
    part.setScope('mine')
    return part
  }
  const keys = () => useTaskStore().visibleRows.map((r) => r.task.key)

  it('내 파트를 고르면 전부가 골라진다. 하나를 빼면 그 파트 것만 빠지고, 브라우저에 남는다', async () => {
    const part = await twoParts()
    expect([...part.pickedIds].sort()).toEqual(['pt1', 'pt2'])
    const both = keys()

    part.togglePicked('pt2')
    expect(part.pickedIds).toEqual(['pt1'])
    const infraOnly = keys()
    expect(infraOnly.length).toBeLessThan(both.length)
    expect(infraOnly).toContain('HW-4')
    expect(JSON.parse(localStorage.getItem('innoflow.partPick.u3.p1')!)).toEqual(['pt1'])

    part.togglePicked('pt2')
    expect(keys()).toEqual(both)
  })

  it('다 빼면 전체다', async () => {
    const part = await twoParts()
    part.togglePicked('pt2')
    part.togglePicked('pt1')
    expect(part.pickedIds).toEqual([])
    expect(part.scope).toBe('all')
    expect(useTaskStore().visibleRows).toHaveLength(22)
  })

  it('고른 파트에서 빠지면 내 파트 전부로 돌아간다 — 내 파트 밖의 값은 버린다', async () => {
    const part = await twoParts()
    part.togglePicked('pt1')
    expect(part.pickedIds).toEqual(['pt2'])
    const data = useDataStore()
    data.partMembers = data.partMembers.filter(
      (pm) => !(pm.partId === 'pt2' && pm.memberId === 'u3'),
    )
    expect(part.pickedIds).toEqual(['pt1'])
  })
})

describe('작업 · 안건의 partId (목업 서버)', () => {
  it('작업 등록에서 partId 를 안 보내면 상위를 따르고, null 이면 공통이다', async () => {
    await signedIn('u1@inno-ax.com')
    const task = useTaskStore()
    const data = useDataStore()
    const inherited = await task.addTask(blankTask({ parentId: 'k7' }))
    const common = await task.addTask(blankTask({ parentId: 'k7', partId: null }))
    const top = await task.addTask(blankTask())
    const byId = (id: string | null) => data.allTasks.find((t) => t.id === id)!
    expect(byId(inherited).partId).toBe('pt2')
    expect(byId(common).partId).toBeNull()
    expect(byId(top).partId).toBeNull()
  })

  it('다른 프로젝트 · 없는 파트는 PART_NOT_FOUND, 보관 파트를 새로 달면 PART_ARCHIVED', async () => {
    await signedIn('u1@inno-ax.com')
    const task = useTaskStore()
    const part = usePartStore()

    expect(await task.addTask(blankTask({ partId: 'nope' }))).toBeNull()
    expect(lastError()).toMatchObject({ status: 400, code: 'PART_NOT_FOUND' })

    await part.setPartActive('pt1', false)
    expect(await task.addTask(blankTask({ partId: 'pt1' }))).toBeNull()
    expect(lastError()).toMatchObject({ code: 'PART_ARCHIVED' })

    /* 이미 달린 보관 파트를 그대로 두는 수정은 막지 않는다 — 다른 칸은 고쳐진다 */
    task.setPart('k1', 'pt1')
    expect(useDataStore().allTasks.find((t) => t.id === 'k1')!.partId).toBeNull()
    task.setTitle('k4', '개발 환경 설정 2')
    expect(useDataStore().allTasks.find((t) => t.id === 'k4')!.partId).toBe('pt1')
  })

  it('상위의 파트가 보관이면 안 보낸 등록은 서버처럼 PART_ARCHIVED — 화면은 공통을 골라 싣는다 (Q32)', async () => {
    await signedIn('u1@inno-ax.com')
    const task = useTaskStore()
    const part = usePartStore()
    await part.setPartActive('pt1', false)

    expect(await task.addTask(blankTask({ parentId: 'k4' }))).toBeNull()
    expect(lastError()).toMatchObject({ code: 'PART_ARCHIVED' })

    expect(part.partForChildOf('k4')).toBeNull()
    expect(part.partForChildOf('k7')).toBe('pt2')
    const id = await task.addTask(blankTask({ parentId: 'k4', partId: part.partForChildOf('k4') }))
    expect(useDataStore().allTasks.find((t) => t.id === id)!.partId).toBeNull()
  })

  it('작업의 파트를 바꿔도 하위 작업은 따라 바뀌지 않는다', async () => {
    await signedIn('u1@inno-ax.com')
    const task = useTaskStore()
    const data = useDataStore()
    task.setPart('k4', 'pt2')
    expect(data.allTasks.find((t) => t.id === 'k4')!.partId).toBe('pt2')
    expect(data.allTasks.find((t) => t.id === 'k19')!.partId).toBe('pt1')
  })

  it('안건은 안 보내면 공통이고, 수정으로 파트를 바꾼다', async () => {
    await signedIn('u1@inno-ax.com')
    const agenda = useAgendaStore()
    const data = useDataStore()
    const id = await agenda.addAgenda({ title: '배포 창구' })
    expect(data.allAgendas.find((t) => t.id === id)!.partId).toBeNull()
    const placed = await agenda.addAgenda({ title: 'GPU 신청', partId: 'pt2' })
    expect(data.allAgendas.find((t) => t.id === placed)!.partId).toBe('pt2')

    expect(agenda.updateAgenda('t6', { partId: 'pt3' })).toBe(true)
    expect(data.allAgendas.find((t) => t.id === 't6')!.partId).toBe('pt3')
    expect(agenda.updateAgenda('t6', { partId: 'nope' })).toBe(false)
    expect(lastError()).toMatchObject({ code: 'PART_NOT_FOUND' })
  })
})

describe('파트 관리 (목업 서버)', () => {
  it('만들면 이름 순으로 서고, 같은 이름(보관 포함)은 PART_NAME_TAKEN', async () => {
    await signedIn('u1@inno-ax.com')
    const part = usePartStore()
    expect(await part.createPart('  디자인  ')).toBe(true)
    expect(part.parts.map((p) => p.name)).toEqual(['AI', '기간계 연동', '디자인', '인프라'])

    await part.setPartActive('pt1', false)
    expect(await part.createPart('인프라')).toBe(false)
    expect(lastError()).toMatchObject({ status: 409, code: 'PART_NAME_TAKEN' })
    expect(await part.renamePart('pt2', '기간계 연동')).toBe(false)
    expect(lastError()).toMatchObject({ code: 'PART_NAME_TAKEN' })
  })

  it('이름 바꾸기 · 보관 · 되살리기 — 보관하면 고를 수 있는 목록에서 빠진다', async () => {
    await signedIn('u1@inno-ax.com')
    const part = usePartStore()
    expect(await part.renamePart('pt1', '인프라 · 보안')).toBe(true)
    expect(part.partName('pt1')).toBe('인프라 · 보안')

    await part.setPartActive('pt1', false)
    expect(part.choicesFor(null).map((p) => p.id)).toEqual(['pt2', 'pt3'])
    expect(part.choicesFor('pt1').map((p) => p.id)).toContain('pt1')
    await part.setPartActive('pt1', true)
    expect(part.choicesFor(null).map((p) => p.id)).toContain('pt1')
  })

  it('일반 사용자는 못 만든다 — FORBIDDEN', async () => {
    await signedIn('u3@inno-ax.com')
    expect(await usePartStore().createPart('디자인')).toBe(false)
    expect(lastError()).toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })

  it('프로젝트에 부여되지 않은 사람은 파트에 못 넣는다 — MEMBER_NOT_IN_PROJECT. 넣기는 멱등', async () => {
    await signedIn('u1@inno-ax.com')
    const part = usePartStore()
    expect(await part.joinPart('pt1', 'u0')).toBe(false)
    expect(lastError()).toMatchObject({ status: 400, code: 'MEMBER_NOT_IN_PROJECT' })

    expect(await part.joinPart('pt1', 'u2')).toBe(true)
    expect(await part.joinPart('pt1', 'u2')).toBe(true)
    expect(part.membersOf('pt1')).toEqual(['u3', 'u2'])
    expect(await part.joinPart('nope', 'u2')).toBe(false)
    expect(lastError()).toMatchObject({ status: 404, code: 'PART_NOT_FOUND' })
  })

  it('프로젝트에서 사람을 빼면 그 사람의 파트 소속도 같이 걷힌다', async () => {
    await signedIn('u1@inno-ax.com')
    const data = useDataStore()
    const part = usePartStore()
    expect(part.partIdsOf('u4').has('pt2')).toBe(true)
    expect(await data.revokeMember('p1', 'u4')).toBe(true)
    expect(part.partIdsOf('u4').size).toBe(0)
    expect(part.membersOf('pt2')).toEqual(['u1'])
    /* 다시 부여해도 파트는 비어 있다 — 목업 서버에서도 지워졌다 */
    await data.grantMember('p1', 'u4', 'user')
    expect(await part.joinPart('pt2', 'u4')).toBe(true)
  })
})

describe('파트 권한 (목업 서버)', () => {
  const rightsOf = (partId: string, memberId: string) => {
    const pm = usePartStore().membershipOf(partId, memberId)!
    return [pm.canView, pm.canCreate, pm.canUpdate, pm.canDelete]
  }

  it('새로 넣으면 보기 · 등록 · 수정, 삭제는 꺼져 있다. 바꾸면 서버가 맞춘 넷으로 갈아끼운다', async () => {
    await signedIn('u1@inno-ax.com')
    const part = usePartStore()
    expect(await part.joinPart('pt1', 'u2')).toBe(true)
    expect(rightsOf('pt1', 'u2')).toEqual([true, true, true, false])
    /* 다시 넣어도 바꾼 권한은 그대로다 */
    const none = { canView: false, canCreate: false, canUpdate: false, canDelete: false }
    expect(await part.setPartRights('pt1', 'u2', { ...none, canView: true })).toBe(true)
    expect(await part.joinPart('pt1', 'u2')).toBe(true)
    expect(rightsOf('pt1', 'u2')).toEqual([true, false, false, false])
    /* 삭제만 보내도 수정 · 보기가 따라 켜진다 */
    expect(await part.setPartRights('pt1', 'u2', { ...none, canDelete: true })).toBe(true)
    expect(rightsOf('pt1', 'u2')).toEqual([true, false, true, true])
    expect(part.membersOf('pt1')).toEqual(['u3', 'u2'])
  })

  it('일반 사용자는 권한을 못 바꾼다 — FORBIDDEN', async () => {
    await signedIn('u3@inno-ax.com')
    const all = { canView: true, canCreate: true, canUpdate: true, canDelete: true }
    expect(await usePartStore().setPartRights('pt1', 'u3', all)).toBe(false)
    expect(lastError()).toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })

  it('등록 권한이 없는 파트에는 작업을 못 만든다 — 고르기에서 빠지고, 하위 작업은 공통으로 둔다', async () => {
    /* 박지훈(u2)은 기간계 연동만 — AI 의 가상비서(k7) 밑에 만들면 공통이다 */
    await signedIn('u2@inno-ax.com')
    const part = usePartStore()
    const task = useTaskStore()
    expect(part.choicesFor(null, 'canCreate').map((p) => p.id)).toEqual(['pt3'])
    /* 안건은 권한을 따르지 않는다 */
    expect(part.choicesFor(null).map((p) => p.id)).toEqual(['pt2', 'pt3', 'pt1'])
    expect(part.partForChildOf('k7')).toBeNull()
    expect(part.partForChildOf('k18')).toBe('pt3')

    expect(await task.addTask(blankTask({ parentId: 'k7' }))).toBeNull()
    expect(lastError()).toMatchObject({ status: 403, code: 'FORBIDDEN' })
    expect(await task.addTask(blankTask({ partId: 'pt2' }))).toBeNull()
    const id = await task.addTask(blankTask({ parentId: 'k7', partId: part.partForChildOf('k7') }))
    expect(useDataStore().allTasks.find((t) => t.id === id)!.partId).toBeNull()

    /* 등록을 끄면 자기 파트에도 못 만든다 */
    useDataStore().partMembers.find((pm) => pm.memberId === 'u2')!.canCreate = false
    expect(part.choicesFor(null, 'canCreate')).toEqual([])
    expect(part.partForChildOf('k18')).toBeNull()
  })

  it('다른 파트로 옮기려면 옮겨 갈 파트의 수정 권한 — 지금 파트는 고르기에 남는다', async () => {
    /* 이도현(u3)은 인프라 — HW-21(인프라)을 AI 로는 못 옮기고 공통으로는 옮긴다 */
    await signedIn('u3@inno-ax.com')
    const part = usePartStore()
    const task = useTaskStore()
    const data = useDataStore()
    expect(part.choicesFor('pt1', 'canUpdate').map((p) => p.id)).toEqual(['pt1'])
    expect(part.choicesFor('pt2', 'canUpdate').map((p) => p.id)).toEqual(['pt2', 'pt1'])

    task.setPart('k21', 'pt2')
    expect(lastError()).toMatchObject({ status: 403, code: 'FORBIDDEN' })
    expect(data.allTasks.find((t) => t.id === 'k21')!.partId).toBe('pt1')
    task.setPart('k21', null)
    expect(data.allTasks.find((t) => t.id === 'k21')!.partId).toBeNull()
  })

  it('수정 권한을 끄면 등록한 작업도 못 고치고, 담당한 작업은 고친다', async () => {
    await signedIn('u3@inno-ax.com')
    const task = useTaskStore()
    const data = useDataStore()
    data.partMembers.find((pm) => pm.memberId === 'u3')!.canUpdate = false
    /* HW-21: 등록 u3 · 담당 u1. HW-20: 등록 · 담당 u3 */
    const k21 = data.allTasks.find((t) => t.id === 'k21')!
    expect(task.canEdit(k21)).toBe(false)
    task.setTitle('k21', '바꿈')
    expect(k21.title).toBe('개발자 계정 배포')
    expect(task.canEdit(data.allTasks.find((t) => t.id === 'k20')!)).toBe(true)
  })
})
