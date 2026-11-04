import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAgendaHistory } from '@/api/history'
import { resetMockAuth } from '@/api/mockAuth'
import { ApiError } from '@/api'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from './auth'
import { useDataStore } from './data'
import { isOverdue, useAgendaStore } from './agenda'

vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

/* 고치기는 작성자 · 담당자 · 관리자만이다 — 계산을 보는 검사들이라 프로젝트 관리자(u1)로 들어온다 */
beforeEach(async () => {
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  resetMockAuth()
  await useAuthStore().login('u1@inno-ax.com', MOCK_PASSWORD)
})

afterEach(() => {
  vi.useRealTimers()
})

const agendaOf = (id: string) => useDataStore().allAgendas.find((t) => t.id === id)!

describe('안건 목록', () => {
  it('고른 프로젝트의 안건만 서고, 대기와 논의중을 센다', () => {
    const agenda = useAgendaStore()
    expect(agenda.rows).toHaveLength(9)
    expect(agenda.queuedCount).toBe(4)
    expect(agenda.openCount).toBe(2)
  })

  it('행은 결정내용의 첫 줄을 미리 보인다 — 비었으면 빈 글', () => {
    const agenda = useAgendaStore()
    const line = (id: string) => agenda.rows.find((r) => r.agenda.id === id)!.decisionLine
    expect(line('t2')).toBe('mysql 을 쓴다')
    expect(line('t6')).toBe('테스트 기간: 전체 일정은 그대로 두고 테스트 기간만 2주 줄인다')
    expect(line('t3')).toBe('')
  })

  it('새 안건은 고르지 않으면 대기로 들어간다', async () => {
    const agenda = useAgendaStore()
    const id = await agenda.addAgenda({ title: '배포 창구 정하기', ownerId: 'u2' })
    const row = agenda.rows.find((r) => r.agenda.id === id)!

    expect(row.agenda.state).toBe('queued')
    expect(row.ownerName).toBe('박지훈')
    expect(agenda.queuedCount).toBe(5)
  })
})

describe('안건 등록', () => {
  it("제목만 있어도 들어간다 — 나머지는 '' · null, 판은 0", async () => {
    const agenda = useAgendaStore()
    const id = (await agenda.addAgenda({ title: '  로그 보관 기간  ' }))!
    expect(agendaOf(id)).toMatchObject({
      title: '로그 보관 기간',
      description: '',
      decision: '',
      state: 'queued',
      ownerId: null,
      dueDate: null,
      partId: null,
      decidedAt: null,
      decisionRev: 0,
      minutesId: null,
      creatorId: 'u1',
    })
  })

  it('결정내용 · 상태를 같이 받는다 — decided 로 등록하면 등록 시각이 정한 때, 판은 1', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-10T00:00:00Z'))
    const agenda = useAgendaStore()
    const id = (await agenda.addAgenda({
      title: '배포 요일',
      description: ' 배포가 몰린다 ',
      decision: ' 화 · 목에만 배포한다\n- 금요일은 막는다 ',
      state: 'decided',
    }))!
    expect(agendaOf(id)).toMatchObject({
      description: '배포가 몰린다',
      decision: '화 · 목에만 배포한다\n- 금요일은 막는다',
      state: 'decided',
      createdAt: '2026-10-10T00:00:00Z',
      decidedAt: '2026-10-10T00:00:00Z',
      decisionRev: 1,
    })
  })

  it('결정내용만 적고 논의중으로 두면 판은 1, 정한 때는 없다', async () => {
    const agenda = useAgendaStore()
    const id = (await agenda.addAgenda({ title: '초안', decision: '아마도 A', state: 'open' }))!
    expect(agendaOf(id)).toMatchObject({ state: 'open', decidedAt: null, decisionRev: 1 })
  })
})

describe('안건 고치기', () => {
  it('보낸 필드만 바뀌고 앞뒤 공백을 뗀다', () => {
    const agenda = useAgendaStore()
    const before = { ...agendaOf('t3') }
    expect(agenda.updateAgenda('t3', { title: '  외부 모델 호출 범위  ' })).toBe(true)
    expect(agendaOf('t3')).toEqual({ ...before, title: '외부 모델 호출 범위' })
  })

  it('담당자 · 기한 · 파트는 null 로 비운다', () => {
    const agenda = useAgendaStore()
    agenda.updateAgenda('t3', { ownerId: null, dueDate: null, partId: null })
    expect(agendaOf('t3')).toMatchObject({ ownerId: null, dueDate: null, partId: null })
  })

  it('제목을 비우려 하면 아무것도 바꾸지 않는다', () => {
    const agenda = useAgendaStore()
    expect(agenda.updateAgenda('t3', { title: '   ', description: '바뀌면 안 됨' })).toBe(false)
    expect(agendaOf('t3').description).not.toBe('바뀌면 안 됨')
  })

  it('상태는 사람이 고른다 — decided 가 되면 정한 때를 찍고 판이 오르고, 벗어나면 정한 때가 빈다', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-10T00:00:00Z'))
    const agenda = useAgendaStore()
    expect(agenda.updateAgenda('t3', { state: 'decided' })).toBe(true)
    expect(agendaOf('t3')).toMatchObject({
      state: 'decided',
      decidedAt: '2026-10-10T00:00:00Z',
      decisionRev: 1,
    })
    agenda.updateAgenda('t3', { state: 'open' })
    expect(agendaOf('t3')).toMatchObject({ state: 'open', decidedAt: null, decisionRev: 1 })
  })

  it('결정내용이 바뀌면 판이 오른다 — 앞뒤 공백만 다르면 그대로, 정한 때도 그대로', () => {
    const agenda = useAgendaStore()
    const decidedAt = agendaOf('t1').decidedAt
    agenda.updateAgenda('t1', { decision: '  우분투 최신 버전으로 한다\n' })
    expect(agendaOf('t1').decisionRev).toBe(1)
    agenda.updateAgenda('t1', { decision: '우분투 24.04 LTS 로 한다' })
    expect(agendaOf('t1')).toMatchObject({
      decision: '우분투 24.04 LTS 로 한다',
      decisionRev: 2,
      decidedAt,
    })
  })

  it('결정내용 · 상태를 한 번에 바꿔도 판은 1 만 오른다 — 결정내용 없이도 결정이 된다', () => {
    const agenda = useAgendaStore()
    agenda.updateAgenda('t5', { decision: '둘 다 정함', state: 'decided' })
    expect(agendaOf('t5').decisionRev).toBe(2)
    agenda.updateAgenda('t4', { state: 'decided' })
    expect(agendaOf('t4')).toMatchObject({ decision: '', state: 'decided', decisionRev: 1 })
  })
})

describe('기한 지남', () => {
  /* 2026-10-10 09:00 KST */
  const fixToday = () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-10T00:00:00Z'))
  }

  it('기한이 지났는데 못 정했으면 기한 지남, 결정됐으면 아니다', () => {
    const base = useAgendaStore().agendas[0]
    const t = { ...base, dueDate: '2026-10-09' }

    expect(isOverdue({ ...t, state: 'open' }, '2026-10-10')).toBe(true)
    expect(isOverdue({ ...t, state: 'queued' }, '2026-10-10')).toBe(true)
    expect(isOverdue({ ...t, state: 'decided' }, '2026-10-10')).toBe(false)
  })

  it('기한 당일은 아직 지난 게 아니고, 기한이 없으면 지날 일도 없다', () => {
    const base = { ...useAgendaStore().agendas[0], state: 'open' as const }

    expect(isOverdue({ ...base, dueDate: '2026-10-10' }, '2026-10-10')).toBe(false)
    expect(isOverdue({ ...base, dueDate: null }, '2026-10-10')).toBe(false)
  })

  it('오늘은 한국 시간으로 센다 — UTC 로는 전날 밤이어도 한국은 이미 다음 날이다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    /* UTC 10월 9일 16시 = KST 10월 10일 01시 */
    vi.setSystemTime(new Date('2026-10-09T16:00:00Z'))
    const agenda = useAgendaStore()
    const id = await agenda.addAgenda({ title: '하루 지난 안건', dueDate: '2026-10-09' })

    expect(agenda.rows.find((r) => r.agenda.id === id)!.overdue).toBe(true)
  })

  it('결정된 안건은 기한이 지나도 세지 않는다', () => {
    fixToday()
    const agenda = useAgendaStore()
    const row = (id: string) => agenda.rows.find((r) => r.agenda.id === id)!

    /* t3 — 9월 30일 기한 · 미결정 */
    expect(row('t3').overdue).toBe(true)
    expect(row('t3').dueLabel).toBe('9월 30일')
    /* t1 — 9월 12일 기한이지만 결정됨 */
    expect(row('t1').overdue).toBe(false)
    /* t5 — 10월 19일 기한 · 아직 남음 */
    expect(row('t5').overdue).toBe(false)
    /* t4 — 기한 없음 */
    expect(row('t4').dueLabel).toBe('—')
    expect(agenda.overdueCount).toBe(1)
  })
})

async function signInAs(email: string) {
  setActivePinia(createPinia())
  await useAuthStore().login(email, MOCK_PASSWORD)
}

const forbiddenToast = () =>
  expect(vi.mocked(toastError).mock.calls.at(-1)?.[0]).toMatchObject({ code: 'FORBIDDEN' })

describe('작성자 · 권한 (목업)', () => {
  it('등록한 안건에 로그인한 사람이 작성자로 찍히고, 안건 이력에 등록 한 줄이 남는다', async () => {
    const agenda = useAgendaStore()
    const id = (await agenda.addAgenda({ title: '새 안건' }))!
    expect(agendaOf(id).creatorId).toBe('u1')

    const rows = await fetchAgendaHistory(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ changedBy: 'u1', changes: [{ field: 'created' }] })
  })

  it('작성자 · 담당자 · 관리자가 아니면 결정내용 · 상태도 못 바꾼다 — 403, 값은 그대로', async () => {
    /* t1 — 작성자 · 담당자 모두 이도현(u3). 박지훈(u2)은 p1 일반 사용자 */
    await signInAs('u2@inno-ax.com')
    const agenda = useAgendaStore()
    const t1 = agendaOf('t1')
    expect(agenda.canEdit(t1)).toBe(false)
    expect(agenda.canDelete(t1)).toBe(false)
    expect(agenda.updateAgenda('t1', { title: '바꿔 봄' })).toBe(false)
    expect(agenda.updateAgenda('t1', { decision: '록키', state: 'open' })).toBe(false)
    expect(t1).toMatchObject({
      title: '서버 OS 결정',
      decision: '우분투 최신 버전으로 한다',
      state: 'decided',
    })
    forbiddenToast()
  })

  it('안건 담당자는 지울 수도 있다 — 작업과 다르다', async () => {
    /* t9 — 담당 · 작성 박지훈(u2) */
    await signInAs('u2@inno-ax.com')
    const agenda = useAgendaStore()
    const t9 = agendaOf('t9')
    t9.creatorId = 'u3'
    expect(agenda.canDelete(t9)).toBe(true)
  })
})

describe('안건 지우기', () => {
  it('안건 · 작업 연결이 스토어에서 빠진다', async () => {
    const agenda = useAgendaStore()
    const data = useDataStore()
    expect(data.taskAgendas.some((l) => l.agendaId === 't1')).toBe(true)
    await agenda.deleteAgenda('t1')
    expect(data.allAgendas.some((t) => t.id === 't1')).toBe(false)
    expect(data.taskAgendas.some((l) => l.agendaId === 't1')).toBe(false)
  })

  it('권한이 없으면 403 — 스토어도 그대로다', async () => {
    await signInAs('u2@inno-ax.com')
    const agenda = useAgendaStore()
    const err = await agenda.deleteAgenda('t1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe('FORBIDDEN')
    expect(useDataStore().allAgendas.some((t) => t.id === 't1')).toBe(true)
  })
})

describe('안건 변경 이력 (목업)', () => {
  it('시드는 안건마다 등록 한 줄 — 결정이 있던 안건은 이행 때 채운 결정내용 한 줄이 더 있다', async () => {
    const rows = await fetchAgendaHistory('t1')
    expect(rows).toEqual([
      {
        id: 'hh-t1-1',
        changedAt: '2026-09-08T00:30:00Z',
        changedBy: 'u3',
        backfilled: false,
        changes: [{ field: 'created', from: null, to: null, subject: '' }],
      },
      {
        id: 'hh-t1-2',
        changedAt: '2026-09-09T02:00:00Z',
        changedBy: 'u3',
        backfilled: true,
        changes: [{ field: 'decision', from: '', to: '우분투 최신 버전으로 한다', subject: '' }],
      },
    ])
    /* 담당자가 없던 안건은 작성자도 없고, 결정이 없던 안건은 등록 한 줄뿐 */
    const t4 = await fetchAgendaHistory('t4')
    expect(t4).toHaveLength(1)
    expect(t4[0].changedBy).toBeNull()
  })

  it('고친 칸만 칸 표 순서로 — 같은 값은 안 남긴다', async () => {
    const agenda = useAgendaStore()
    agenda.updateAgenda('t3', {
      state: 'decided',
      decision: '사내 모델만 쓴다',
      title: '외부 모델 허용 범위',
      dueDate: '2026-09-30',
    })
    const last = (await fetchAgendaHistory('t3')).at(-1)!
    expect(last.changedBy).toBe('u1')
    expect(last.changes).toEqual([
      {
        field: 'title',
        from: '사내망에서 외부 모델 호출 허용 범위',
        to: '외부 모델 허용 범위',
        subject: '',
      },
      { field: 'decision', from: '', to: '사내 모델만 쓴다', subject: '' },
      { field: 'state', from: 'open', to: 'decided', subject: '' },
    ])
  })
})
