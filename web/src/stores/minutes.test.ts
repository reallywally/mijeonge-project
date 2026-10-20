// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMockAuth, writeMockSession } from '@/api/mockAuth'
import { resetMockMinutes } from '@/api/minutes'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useMinutesStore } from '@/stores/minutes'

/* 회의록 게시판 스토어 — 목록 · 쓰기 · 고치기 · 지우기 권한 · 지우면 출처가 빈다 · 나온 것 세기 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

async function signIn(memberId = 'u1') {
  const auth = useAuthStore()
  if (memberId === 'u1') await auth.login('u1@innoflow.local', MOCK_PASSWORD)
  else {
    /* 목업 저장소를 비우지 않고 사람만 바꾼다 */
    writeMockSession(memberId)
    await auth.loadMe()
  }
}

beforeEach(async () => {
  resetMockAuth()
  resetMockMinutes()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  await signIn()
  await useDataStore().retry()
})

describe('목록', () => {
  it('고른 프로젝트의 것만, 프로젝트를 바꾸면 옛 목록을 그리지 않는다', async () => {
    const minutes = useMinutesStore()
    await minutes.load()
    expect(minutes.list.map((m) => m.id)).toEqual(['m1'])
    expect(minutes.titleOf('m1')).toBe('10월 셋째 주 주간 회의')

    useDataStore().setProject('p2')
    expect(minutes.list).toEqual([])
    await minutes.load()
    expect(minutes.list).toEqual([])
  })
})

describe('쓰기 · 고치기', () => {
  it('쓰면 목록에 회의 날짜 순으로 들어간다', async () => {
    const minutes = useMinutesStore()
    await minutes.load()
    const id = await minutes.create({
      title: '10월 넷째 주',
      meetingDate: '2026-10-23',
      body: '글',
    })
    expect(id).not.toBeNull()
    expect(minutes.list.map((m) => m.title)).toEqual(['10월 넷째 주', '10월 셋째 주 주간 회의'])
    expect(minutes.byId[id!]).toMatchObject({ body: '글', authorId: 'u1' })
  })

  it('틀린 글은 알리고 null', async () => {
    const minutes = useMinutesStore()
    expect(await minutes.create({ title: '', meetingDate: null, body: '' })).toBeNull()
    expect(toastError).toHaveBeenCalledOnce()
  })

  it('고치면 목록 줄도 바뀐다', async () => {
    const minutes = useMinutesStore()
    await minutes.load()
    expect(await minutes.update('m1', { title: '주간 회의' })).toBe(true)
    expect(minutes.titleOf('m1')).toBe('주간 회의')
  })
})

describe('권한 — 댓글과 같은 경계', () => {
  it('작성자는 고치고 지운다. 같은 프로젝트의 일반 멤버는 둘 다 못 한다', async () => {
    const minutes = useMinutesStore()
    const m1 = await minutes.fetchOne('m1')
    expect([minutes.canEdit(m1), minutes.canRemove(m1)]).toEqual([true, true])

    await signIn('u2')
    expect([minutes.canEdit(m1), minutes.canRemove(m1)]).toEqual([false, false])
    expect(await minutes.update('m1', { title: '남이 고침' })).toBe(false)
    expect(await minutes.remove('m1')).toBe(false)
    expect(toastError).toHaveBeenCalledTimes(2)
  })

  it('시스템 관리자 · 프로젝트 관리자는 남의 것을 지울 수만 있다', async () => {
    const minutes = useMinutesStore()
    const others = { ...(await minutes.fetchOne('m1')), authorId: 'u3' }
    /* u1 은 p1 관리자 */
    expect([minutes.canEdit(others), minutes.canRemove(others)]).toEqual([false, true])
    await signIn('u0')
    expect([minutes.canEdit(others), minutes.canRemove(others)]).toEqual([false, true])
  })
})

describe('지우기', () => {
  it('회의록만 지운다 — 나온 안건 · 이력 · 작업은 남고 출처만 null', async () => {
    const data = useDataStore()
    const minutes = useMinutesStore()
    await minutes.load()
    /* m1 에서 나온 것처럼 출처를 단다 */
    data.allThreads.find((t) => t.id === 't3')!.minutesId = 'm1'
    data.allEntries.find((e) => e.id === 'e2')!.minutesId = 'm1'
    data.allTasks.find((t) => t.id === 'k4')!.minutesId = 'm1'
    expect(minutes.outcomeOf('m1')).toMatchObject({
      threads: [{ id: 't3' }],
      entries: [{ id: 'e2' }],
      tasks: [{ id: 'k4' }],
    })

    const counts = [data.allThreads.length, data.allEntries.length, data.allTasks.length]
    expect(await minutes.remove('m1')).toBe(true)
    expect(minutes.list).toEqual([])
    expect([data.allThreads.length, data.allEntries.length, data.allTasks.length]).toEqual(counts)
    expect(
      [
        data.allThreads.find((t) => t.id === 't3'),
        data.allEntries.find((e) => e.id === 'e2'),
        data.allTasks.find((t) => t.id === 'k4'),
      ].map((r) => r!.minutesId),
    ).toEqual([null, null, null])
    expect(minutes.outcomeOf('m1').threads).toEqual([])
  })
})
