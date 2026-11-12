import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_ADMIN_PASSWORD, MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { useDataStore } from '@/stores/data'
import { useTaskStore } from '@/stores/task'
import { useAgendaStore } from '@/stores/agenda'

/* 목업 모드의 부팅 · 로그아웃 · 프로젝트 멤버 — 서버처럼 내가 볼 수 있는 것만 받는지 본다 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

beforeEach(() => {
  resetMockAuth()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
})

async function signedIn(email: string, password = MOCK_PASSWORD) {
  await useAuthStore().login(email, password)
  const data = useDataStore()
  await data.retry()
  return data
}

describe('부팅', () => {
  it('로그인 전이면 anonymous 로 서고 아무것도 받지 않는다', async () => {
    const data = useDataStore()
    await data.retry()
    expect(data.status).toBe('anonymous')
    expect(useAuthStore().me).toBeNull()
  })

  it('부여받은 프로젝트만 보인다 — 박지훈은 경영지원 파트(p3)를 모른다', async () => {
    const data = await signedIn('u2@inno-ax.com')
    expect(data.status).toBe('ready')
    expect(data.currentMemberId).toBe('u2')
    expect(data.allProjects.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('시스템 관리자는 부여 없이도 다 본다', async () => {
    const data = await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    expect(data.allProjects.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('담당자 후보는 그 프로젝트의 활성 멤버만, 이름은 비활성이면 표시가 붙는다', async () => {
    const data = await signedIn('u2@inno-ax.com')
    expect(data.assignable.map((m) => m.id)).toEqual(['u1', 'u2', 'u3', 'u4'])
    expect(data.memberName('u5')).toBe('한예린 (비활성)')
    data.setProject('p2')
    expect(data.assignable.map((m) => m.id)).toEqual(['u1', 'u2', 'u3', 'u4'])
  })
})

describe('로그아웃', () => {
  it('들고 있던 레코드 · 나 · 챗봇 대화를 다 비운다', async () => {
    const data = await signedIn('u2@inno-ax.com')
    const chat = useChatStore()
    chat.lines.push({
      id: 'x',
      role: 'user',
      text: '서버 OS 뭐로 정했지?',
      status: 'done',
      tool: '',
      error: '',
    })

    await useAuthStore().logout()

    expect(useAuthStore().me).toBeNull()
    expect(data.status).toBe('anonymous')
    expect(data.allProjects).toEqual([])
    expect(data.allTasks).toEqual([])
    expect(data.allMembers).toEqual([])
    expect(chat.lines).toEqual([])

    /* 다른 사람이 들어오면 그 사람 것으로 다시 선다 */
    const next = await signedIn('u1@inno-ax.com')
    expect(next.currentMemberId).toBe('u1')
    expect(next.allProjects.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })
})

describe('프로젝트 멤버', () => {
  it('프로젝트 관리자가 사람을 더하면 담당자 후보에 바로 선다', async () => {
    const data = await signedIn('u1@inno-ax.com')
    expect(data.assignable.some((m) => m.id === 'u0')).toBe(false)
    expect(await data.grantMember('p1', 'u0', 'user')).toBe(true)
    expect(data.assignable.some((m) => m.id === 'u0')).toBe(true)
    expect(await data.revokeMember('p1', 'u3')).toBe(true)
    expect(data.assignable.some((m) => m.id === 'u3')).toBe(false)
  })

  it('나를 user 로 내리면 내 역할도 그 자리에서 바뀐다', async () => {
    const data = await signedIn('u1@inno-ax.com')
    await data.grantMember('p1', 'u1', 'user')
    expect(useAuthStore().me!.projectRoles.p1).toBe('user')
  })

  it('나를 빼면 그 프로젝트는 목록에서 사라지고 다른 프로젝트로 옮긴다', async () => {
    const data = await signedIn('u1@inno-ax.com')
    await data.revokeMember('p1', 'u1')
    expect(data.allProjects.map((p) => p.id)).toEqual(['p2', 'p3'])
    expect(data.currentProjectId).toBe('p2')
  })

  it('일반 사용자가 부르면 서버처럼 거절되고 알린다', async () => {
    const data = await signedIn('u2@inno-ax.com')
    expect(await data.grantMember('p1', 'u0', 'user')).toBe(false)
    expect(vi.mocked(toastError).mock.calls[0][0]).toMatchObject({ code: 'FORBIDDEN' })
  })

  it('프로젝트 등록 · 이름 수정도 권한을 본다', async () => {
    const data = await signedIn('u2@inno-ax.com')
    expect(await data.addProject('새 프로젝트', '')).toBeNull()
    expect(await data.renameProject('p1', '새 이름')).toBe(false)

    await useAuthStore().logout()
    const admin = await signedIn('u1@inno-ax.com')
    expect(await admin.renameProject('p1', '한화손보 차세대 2기')).toBe(true)
    expect(admin.currentProject?.name).toBe('한화손보 차세대 2기')
  })
})

describe('담당자 거르기 (목업 갈래 · API.md Q30)', () => {
  const codeOfLastToast = () => vi.mocked(toastError).mock.calls.at(-1)?.[0]

  it('프로젝트의 활성 멤버가 아니면 서버와 같은 코드로 거절한다', async () => {
    await signedIn('u2@inno-ax.com')
    const agendas = useAgendaStore()
    const tasks = useTaskStore()

    expect(await agendas.addAgenda({ title: '새 안건', ownerId: 'u5' })).toBeNull()
    expect(codeOfLastToast()).toMatchObject({ code: 'AGENDA_OWNER_NOT_FOUND', status: 400 })

    /* t9 — 박지훈(u2) 담당이라 고칠 수 있다. u0 은 p1 에 부여되지 않았다 */
    expect(agendas.updateAgenda('t9', { ownerId: 'u0' })).toBe(false)
    expect(codeOfLastToast()).toMatchObject({ code: 'AGENDA_OWNER_NOT_FOUND' })

    /* k3 — 박지훈(u2) 담당인 공통 작업이라 고칠 수 있다 */
    tasks.setOwner('k3', 'u0')
    expect(codeOfLastToast()).toMatchObject({ code: 'TASK_OWNER_NOT_FOUND' })
    expect(useDataStore().allTasks.find((t) => t.id === 'k3')!.ownerId).not.toBe('u0')

    expect(await agendas.addAgenda({ title: '새 안건', ownerId: 'u3' })).not.toBeNull()
  })

  it('참조도 프로젝트의 활성 멤버만 — AGENDA_CC_NOT_FOUND, 겹친 id 는 앞의 하나만', async () => {
    await signedIn('u2@inno-ax.com')
    const agendas = useAgendaStore()
    expect(await agendas.addAgenda({ title: '새 안건', ccIds: ['u1', 'u5'] })).toBeNull()
    expect(codeOfLastToast()).toMatchObject({
      code: 'AGENDA_CC_NOT_FOUND',
      status: 400,
      detail: { ccIds: 'u5' },
    })
    expect(agendas.updateAgenda('t9', { ccIds: ['u0'] })).toBe(false)
    expect(codeOfLastToast()).toMatchObject({ code: 'AGENDA_CC_NOT_FOUND' })

    const id = await agendas.addAgenda({ title: '새 안건', ccIds: ['u3', 'u1', 'u3'] })
    expect(agendas.agendas.find((t) => t.id === id)!.ccIds).toEqual(['u3', 'u1'])
    expect(agendas.updateAgenda('t9', { ccIds: ['u4', 'u4'] })).toBe(true)
    expect(agendas.agendas.find((t) => t.id === 't9')!.ccIds).toEqual(['u4'])
  })

  it('이미 걸려 있던 참조는 빠진 사람이어도 그대로 둘 수 있다 (Q68)', async () => {
    const data = await signedIn('u2@inno-ax.com')
    const agendas = useAgendaStore()
    data.allAgendas.find((t) => t.id === 't9')!.ccIds = ['u5']
    vi.mocked(toastError).mockClear()
    expect(agendas.updateAgenda('t9', { ccIds: ['u5', 'u4'] })).toBe(true)
    expect(toastError).not.toHaveBeenCalled()
    expect(agendas.agendas.find((t) => t.id === 't9')!.ccIds).toEqual(['u5', 'u4'])
    /* 다른 안건에 새로 더하면 거절 */
    expect(agendas.updateAgenda('t9', { ccIds: ['u4'] })).toBe(true)
    expect(agendas.updateAgenda('t9', { ccIds: ['u4', 'u5'] })).toBe(false)
  })

  it('이미 걸려 있던 담당자를 그대로 두는 것은 막지 않는다', async () => {
    const data = await signedIn('u1@inno-ax.com')
    const agenda = data.allAgendas.find((t) => t.projectId === 'p1' && t.ownerId === 'u3')!
    await data.revokeMember('p1', 'u3')
    vi.mocked(toastError).mockClear()
    expect(useAgendaStore().updateAgenda(agenda.id, { ownerId: 'u3', title: '제목만 고침' })).toBe(
      true,
    )
    expect(toastError).not.toHaveBeenCalled()
  })
})
