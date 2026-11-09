// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMockAuth } from '@/api/mockAuth'
import { resetMockMinutes } from '@/api/minutes'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useMinutesStore } from '@/stores/minutes'
import { useMinutesDraftStore } from '@/stores/minutesDraft'

/* 회의록 [AI 정리] 스토어 — 초안 받기 · 멈추기 · 고르기 · 보낼 모양 · 등록 결과(출처 포함)를 데이터 스토어에 넣기 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

async function signedIn() {
  await useAuthStore().login('u1@inno-ax.com', MOCK_PASSWORD)
  await useDataStore().retry()
}

/** 시드 회의록 m1 의 초안까지 받는다 */
async function drafted() {
  const minutes = useMinutesDraftStore()
  const run = minutes.run('m1')
  await vi.runAllTimersAsync()
  expect(await run).toBe(true)
  return minutes
}

beforeEach(async () => {
  resetMockAuth()
  resetMockMinutes()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  await signedIn()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('정리', () => {
  it('진행 줄을 띄우다가 초안을 받으면 검토로, 줄은 다 켠다', async () => {
    const minutes = useMinutesDraftStore()
    const run = minutes.run('m1')
    expect(minutes.phase).toBe('drafting')
    expect(minutes.dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(130)
    expect(minutes.tool).toBe('"대화 로그" 기존 안건 찾는 중')
    await vi.runAllTimersAsync()
    await run

    expect(minutes.phase).toBe('review')
    expect(minutes.tool).toBe('')
    expect(minutes.pickedCount).toBe(6)
    expect(Object.values(minutes.picked).every(Boolean)).toBe(true)
    expect(minutes.canApply).toBe(true)
  })

  it('없는 회의록이면 까닭 한 줄을 남기고 쉼으로', async () => {
    const minutes = useMinutesDraftStore()
    const run = minutes.run('zz')
    await vi.runAllTimersAsync()
    expect(await run).toBe(false)
    expect(minutes.phase).toBe('idle')
    expect(minutes.error).toBe('회의록을 찾을 수 없습니다.')
  })

  it('멈추면 쉼으로 돌아가고 아무것도 남지 않는다', async () => {
    const minutes = useMinutesDraftStore()
    const run = minutes.run('m1')
    await vi.advanceTimersByTimeAsync(130)
    minutes.stop()
    await vi.runAllTimersAsync()
    expect(await run).toBe(false)
    expect(minutes.phase).toBe('idle')
    expect(minutes.form).toBeNull()
    expect(minutes.error).toBe('')
    expect(minutes.dirty).toBe(false)
  })

  it('다시 정리하면 앞 초안 · 고친 값을 버린다', async () => {
    const minutes = await drafted()
    minutes.form!.agendas[0].title = '고친 제목'
    minutes.setPicked('t1', false)
    const run = minutes.run('m1')
    expect(minutes.form).toBeNull()
    await vi.runAllTimersAsync()
    await run
    expect(minutes.form!.agendas[0].title).toBe('가상비서 대화 로그 보관 기간')
    expect(minutes.picked.t1).toBe(true)
  })

  it('프로젝트를 바꾸면 초안을 버린다', async () => {
    const minutes = await drafted()
    useDataStore().setProject('p2')
    await vi.runAllTimersAsync()
    expect(minutes.form).toBeNull()
    expect(minutes.phase).toBe('idle')
    expect(minutes.minutesId).toBeNull()
  })
})

describe('보낼 모양', () => {
  it('줄을 지우면 끈 것과 같이 빠지고, 되돌리면 켠 채로 돌아온다', async () => {
    const minutes = await drafted()
    minutes.removeRow('n1')
    minutes.removeRow('t3')
    expect(minutes.removed).toEqual(['n1', 't3'])
    expect(minutes.isRemoved('n1')).toBe(true)
    expect(minutes.pickedCount).toBe(4)
    expect(minutes.droppedAgendas('t1')).toEqual(['가상비서 대화 로그 보관 기간'])
    const input = minutes.applyInput!
    expect(input.agendas.map((t) => t.tempId)).toEqual(['n2'])
    expect(input.tasks.map((t) => t.tempId)).toEqual(['t1', 't2'])
    expect(input.tasks[0]).toMatchObject({ agendaTempIds: [] })

    minutes.undoRemove()
    expect(minutes.removed).toEqual(['n1'])
    expect(minutes.picked.t3).toBe(true)
    minutes.undoRemove()
    expect(minutes.pickedCount).toBe(6)
    expect(minutes.applyInput!.tasks[0].agendaTempIds).toEqual(['n1'])
  })

  it('다시 정리하면 지운 줄도 비운다', async () => {
    const minutes = await drafted()
    minutes.removeRow('t1')
    const again = minutes.run('m1')
    await vi.runAllTimersAsync()
    await again
    expect(minutes.removed).toEqual([])
    expect(minutes.pickedCount).toBe(6)
  })

  it('새 안건을 끄면 걸린 작업에 빠질 안건이 잡히고, 보낼 때 agendaTempIds 에서 지운다', async () => {
    const minutes = await drafted()
    expect(minutes.droppedAgendas('t1')).toEqual([])
    minutes.setPicked('n1', false)
    expect(minutes.droppedAgendas('t1')).toEqual(['가상비서 대화 로그 보관 기간'])
    expect(minutes.pickedCount).toBe(5)
    const input = minutes.applyInput!
    expect(input.agendas.map((t) => t.tempId)).toEqual(['n2'])
    expect(input.tasks[0]).toMatchObject({ tempId: 't1', agendaTempIds: [] })
    /* 초안 사본은 그대로 — 다시 켜면 연결이 돌아온다 */
    minutes.setPicked('n1', true)
    expect(minutes.applyInput!.tasks[0].agendaTempIds).toEqual(['n1'])
  })

  it('요약은 고친 그대로 보낸다', async () => {
    const minutes = await drafted()
    expect(minutes.applyInput!.summary).toContain('외부 모델 호출 허용 범위')
    /* 기존 안건 갈아끼우기는 계약의 칸만 — quote 는 화면에서만 쓴다 */
    expect(minutes.applyInput!.updates).toEqual([
      { agendaId: 't2', decision: minutes.form!.updates[0].decision, state: 'decided' },
    ])
    minutes.form!.summary = '고친 요약'
    expect(minutes.applyInput!.summary).toBe('고친 요약')
  })

  it('ownerHint 만 있던 줄에 담당자를 고르면 hint 는 비워 보낸다', async () => {
    const minutes = await drafted()
    expect(minutes.applyInput!.tasks[2]).toMatchObject({ ownerId: null, ownerHint: '최 선임' })
    minutes.form!.tasks[2].ownerId = 'u2'
    expect(minutes.applyInput!.tasks[2]).toMatchObject({ ownerId: 'u2', ownerHint: '' })
  })

  it('켠 줄의 빈 제목 · 거꾸로 된 기간은 등록을 막는다. 끈 줄은 상관없다', async () => {
    const minutes = await drafted()
    minutes.form!.tasks[1].title = ' '
    expect(minutes.problems).toEqual({ t2: '제목을 적어 주세요.' })
    expect(minutes.canApply).toBe(false)
    minutes.setPicked('t2', false)
    expect(minutes.canApply).toBe(true)
    minutes.form!.tasks[0].start = '2026-10-30'
    expect(minutes.problems).toEqual({ t1: '기한이 시작 날짜보다 앞섭니다.' })
  })
})

describe('등록', () => {
  it('결과를 데이터 스토어에 넣고 검토를 닫는다 — 안건 · 갈아끼운 안건 · 작업 · 링크, 출처 m1', async () => {
    const data = useDataStore()
    const before = { tasks: data.allTasks.length }
    const minutes = await drafted()
    minutes.setPicked('n1', false)

    expect(await minutes.apply()).toBe(true)
    const r = minutes.lastResult!
    expect(minutes.phase).toBe('idle')
    expect(minutes.form).toBeNull()
    expect(minutes.dirty).toBe(false)
    /* 나온 것 — 새 안건 1 · 작업 3. 갈아끼운 기존 안건은 출처가 안 남는다 */
    const made = useMinutesStore().outcomeOf('m1')
    expect([made.agendas.length, made.tasks.length]).toEqual([1, 3])
    expect(data.allAgendas.find((t) => t.id === 't2')).toMatchObject({
      decision: expect.stringContaining('- 운영 DB 도 같은 버전으로 구성한다'),
      decisionRev: 2,
      minutesId: null,
    })

    expect(data.allAgendas[0]).toMatchObject({
      id: r.agendas[0].id,
      title: '기간계 테스트 데이터 마스킹 범위',
      state: 'open',
    })
    expect(data.allTasks.length).toBe(before.tasks + 3)
    /* 목업에서는 키를 데이터 스토어가 센다 */
    expect(r.tasks.map((t) => t.key)).toEqual(['HW-23', 'HW-24', 'HW-25'])
    expect(data.allTasks.at(-1)!.key).toBe('HW-25')
    /* n1 을 껐으니 t1 의 연결은 빠지고, t2 만 DB 결정에 걸린다 */
    expect(data.taskAgendas.filter((l) => r.tasks.some((t) => t.id === l.taskId))).toEqual([
      { taskId: r.taskIdByTempId.t2, agendaId: 't2' },
    ])
  })

  it('기존 안건의 상태 · 결정내용을 고쳐 등록하면 그대로 들어간다', async () => {
    const minutes = await drafted()
    minutes.form!.updates[0].state = 'open'
    minutes.form!.updates[0].decision = '다시 논의한다'
    expect(await minutes.apply()).toBe(true)
    expect(useDataStore().allAgendas.find((t) => t.id === 't2')).toMatchObject({
      state: 'open',
      decision: '다시 논의한다',
      decidedAt: null,
    })
  })

  it('기존 안건 줄을 끄면 보내지 않는다 — 열쇠는 update:안건 id', async () => {
    const minutes = await drafted()
    minutes.setPicked('update:t2', false)
    expect(minutes.pickedCount).toBe(5)
    expect(minutes.applyInput!.updates).toEqual([])
  })

  it('실패하면 알리고 검토에 남는다 — 짚은 자리는 보낸 순서가 아니라 그 줄(tempId)에 붙는다', async () => {
    const data = useDataStore()
    const agendas = data.allAgendas.length
    const minutes = await drafted()
    minutes.setPicked('n1', false)
    /* 목업 api 가 데이터 스토어의 안건을 본다 — 그사이 지워진 안건 */
    data.allAgendas = data.allAgendas.filter((t) => t.id !== 't2')

    expect(await minutes.apply()).toBe(false)
    expect(toastError).toHaveBeenCalledOnce()
    expect(minutes.phase).toBe('review')
    /* 갈아끼우기 줄 · 그 안건에 걸린 작업 줄(t2) 둘 다 */
    expect(minutes.rowErrors).toEqual({
      'update:t2': '안건을 찾을 수 없습니다.',
      t2: '안건을 찾을 수 없습니다.',
    })
    expect(useMinutesStore().outcomeOf('m1').tasks).toEqual([])
    expect(data.allAgendas.length).toBe(agendas - 1)
  })

  it('등록하면 회의록 요약이 초안의 요약으로 바뀐다', async () => {
    const board = useMinutesStore()
    await board.fetchOne('m1')
    expect(board.byId.m1.summary).toBe('')
    const minutes = await drafted()
    minutes.form!.summary = '  등록한 요약  '
    await minutes.apply()
    expect(board.byId.m1.summary).toBe('등록한 요약')
  })
})
