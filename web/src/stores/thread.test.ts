import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchThreadHistory } from '@/api/history'
import { resetMockAuth } from '@/api/mockAuth'
import { ApiError } from '@/api'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from './auth'
import { useDataStore } from './data'
import { isOverdue, useThreadStore } from './thread'

vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

/* 고치기는 작성자 · 담당자 · 관리자만이다 — 계산을 보는 검사들이라 프로젝트 관리자(u1)로 들어온다 */
beforeEach(async () => {
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  resetMockAuth()
  await useAuthStore().login('u1@inno-ax.com', MOCK_PASSWORD)
})

describe('안건 이력', () => {
  it('줄은 적은 날(KST)에 놓이고, 새 줄이 위로 온다', () => {
    const thread = useThreadStore()
    const detail = thread.threadDetail('t5')!

    expect(detail.events.map((e) => e.at)).toEqual(['2026-09-14', '2026-09-10', '2026-09-07'])
    expect(detail.events[0].entry.text).toBe('여전히 업무 정의가 없어 또 미룬다')
  })

  it('UTC 로는 전날이어도 한국 날짜에 놓인다', () => {
    const thread = useThreadStore()
    const data = useDataStore()
    /* UTC 9월 20일 16시 = KST 9월 21일 01시 */
    data.allEntries.push({
      id: 'x1',
      threadId: 't4',
      itemId: null,
      kind: 'refine',
      text: '야간 배치와 겹치지 않게',
      detail: [],
      note: '',
      ownerId: null,
      createdAt: '2026-09-20T16:00:00Z',
      minutesId: null,
      creatorId: null,
    })
    expect(thread.threadDetail('t4')!.events[0].at).toBe('2026-09-21')
  })

  it('두 번 미뤄진 안건은 미룸 수가 둘이고, 항목 둘 중 하나만 정해 아직 못 정한 상태다', () => {
    const thread = useThreadStore()
    const detail = thread.threadDetail('t5')!

    expect(detail.deferCount).toBe(2)
    /* 두 번 다 안건 전체를 미뤘다 */
    expect(detail.threadDeferCount).toBe(2)
    expect(detail.settled).toBe(false)
    expect(detail.settledCount).toBe(1)
    expect(detail.items.map((v) => [v.item.title, v.settled, v.current])).toEqual([
      ['요청(in) 항목', true, '계약번호 · 상품코드 · 가입일 셋을 넘긴다'],
      ['응답(out) 항목', false, ''],
    ])
  })

  it('담당자 확인만으로 정한 줄도 결정으로 서고, 근거와 날짜가 따라온다', () => {
    const thread = useThreadStore()
    const detail = thread.threadDetail('t1')!

    expect(detail.settled).toBe(true)
    const [item] = detail.items
    expect(item.item.title).toBe('서버 OS 결정')
    expect(item.current).toBe('우분투 최신 버전으로 한다')
    expect(item.settledNote).toBe('PM 에게 전달받아 이도현이 정리했다. 회의로 다루지 않았다.')
    expect(item.settledLabel).toBe('9월 9일에 정해짐')
    expect(item.settledOwnerName).toBe('이도현')
  })

  it('결정에 함께 적은 조건별 상세가 따라온다', () => {
    const thread = useThreadStore()
    const detail = thread.threadDetail('t2')!

    expect(detail.items[0].detail).toEqual([
      'postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺀다',
      'supabase 는 비용 때문에 뺀다',
    ])
  })

  it('같은 날 한 안건에 남긴 줄은 배열 순서로 갈린다', async () => {
    const thread = useThreadStore()
    const item = (await thread.addItem('t3', '호출 범위'))!
    await thread.addEntry('t3', 'decide', '사내망에서만 부른다', '', 'u1', item)
    await thread.addEntry('t3', 'refine', '예외는 보안팀 승인 건만', '', 'u1', item)

    const detail = thread.threadDetail('t3')!
    /* 나중에 적은 줄이 위로 온다 — 배열 순서가 계약이다 (API.md Q4) */
    expect(detail.events.slice(0, 2).map((e) => e.entry.text)).toEqual([
      '예외는 보안팀 승인 건만',
      '사내망에서만 부른다',
    ])
    expect(detail.items[0].current).toBe('사내망에서만 부른다')
    expect(detail.items[0].detail).toEqual(['예외는 보안팀 승인 건만'])
  })

  it('이력의 날짜는 시각을 달지 않는다', () => {
    const thread = useThreadStore()
    thread.addEntry('t4', 'defer', '보안팀 답을 기다린다', '', 'u1')

    const event = thread.threadDetail('t4')!.events[0]
    expect(event.at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    /* 레코드에 남는 값은 계약대로 UTC 타임스탬프다 */
    expect(event.entry.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })

  it('나중 결정이 앞의 결정을 대체하고, 앞의 결정은 이력에 남는다', async () => {
    const thread = useThreadStore()
    await thread.addEntry('t2', 'decide', 'mariadb 로 바꾼다', '라이선스 때문에', 'u3', 'di2')

    const detail = thread.threadDetail('t2')!
    expect(detail.items[0].current).toBe('mariadb 로 바꾼다')
    expect(detail.items[0].settledNote).toBe('라이선스 때문에')
    expect(detail.events.filter((e) => e.superseded).map((e) => e.entry.text)).toEqual([
      'mysql 을 쓴다',
    ])
  })

  it('Entry 에는 회의가 붙지 않는다', () => {
    const thread = useThreadStore()
    const detail = thread.threadDetail('t2')!
    expect(Object.keys(detail.events[0].entry)).not.toContain('meetingId')
    expect(Object.keys(detail.events[0])).not.toContain('meeting')
  })
})

describe('이력 남기기', () => {
  it('항목을 정하면 결정됨이 되고, 처리한 사람이 담당자가 된다', async () => {
    const thread = useThreadStore()
    const item = (await thread.addItem('t3', '호출 범위'))!
    await thread.addEntry('t3', 'decide', '비식별 데이터만 허용', '보안팀 확인', 'u2', item)

    const t = thread.threads.find((x) => x.id === 't3')!
    expect(t.state).toBe('decided')
    expect(t.ownerId).toBe('u2')
  })

  it('처리한 사람 없이 결정하면 담당자는 그대로다', async () => {
    const thread = useThreadStore()
    const item = (await thread.addItem('t3', '호출 범위'))!
    await thread.addEntry('t3', 'decide', '비식별 데이터만 허용', '', null, item)
    expect(thread.threads.find((x) => x.id === 't3')!.ownerId).toBe('u1')
  })

  it('결정 · 세부 추가는 항목 없이 남기지 않는다 — 422 ENTRY_ITEM_REQUIRED · 다른 안건 항목은 404', async () => {
    const thread = useThreadStore()
    expect(await thread.addEntry('t3', 'decide', '정했다', '', null)).toBe(false)
    expect(vi.mocked(toastError).mock.calls.at(-1)?.[0]).toMatchObject({
      code: 'ENTRY_ITEM_REQUIRED',
    })
    expect(await thread.addEntry('t3', 'refine', '세부', '', null, 'di1')).toBe(false)
    expect(vi.mocked(toastError).mock.calls.at(-1)?.[0]).toMatchObject({ code: 'ITEM_NOT_FOUND' })
    expect(thread.entriesOfThread('t3')).toHaveLength(1)
  })

  it('대기 중인 안건에 미룸 · 세부 추가를 남기면 논의중이 된다', async () => {
    const thread = useThreadStore()
    await thread.addEntry('t4', 'defer', '기간계 백업 주기를 먼저 알아본다', '', null)
    const item = (await thread.addItem('t7', '첫 tool'))!
    await thread.addEntry('t7', 'refine', 'tool02 를 먼저', '', null, item)

    expect(thread.threads.find((x) => x.id === 't4')!.state).toBe('open')
    expect(thread.threads.find((x) => x.id === 't7')!.state).toBe('open')
    expect(thread.rows.find((r) => r.thread.id === 't4')!.deferCount).toBe(1)
  })

  it('결정된 안건에 세부 추가를 남겨도 결정됨 그대로다', async () => {
    const thread = useThreadStore()
    await thread.addEntry('t2', 'refine', '버전은 8.4', '', null, 'di2')
    expect(thread.threads.find((x) => x.id === 't2')!.state).toBe('decided')
  })
})

describe('결정 항목', () => {
  const state = (id: string) => useThreadStore().threads.find((t) => t.id === id)!.state

  it('대체는 항목 안에서만 — 한 항목을 바꿔도 다른 항목의 결정은 살아 있다', async () => {
    const thread = useThreadStore()
    await thread.addEntry('t6', 'decide', '테스트 기간은 1주만 줄인다', '', null, 'di4')

    const detail = thread.threadDetail('t6')!
    expect(detail.items.map((v) => [v.item.title, v.current])).toEqual([
      ['테스트 기간', '테스트 기간은 1주만 줄인다'],
      ['전체 일정', '전체 일정은 미루지 않는다'],
    ])
    expect(detail.events.filter((e) => e.superseded).map((e) => e.entry.id)).toEqual(['e6'])
    expect(detail.settled).toBe(true)
  })

  it('세부 추가는 그 항목의 지금 결정 뒤에 붙을 때만 상세로 올라간다', async () => {
    const thread = useThreadStore()
    await thread.addEntry('t6', 'refine', '오픈 일자는 그대로', '', null, 'di7')

    const [testPeriod, schedule] = thread.threadDetail('t6')!.items
    expect(schedule.detail).toEqual(['오픈 일자는 그대로'])
    expect(schedule.settledLabel).toMatch(/^9월 15일에 정해지고 .+에 세부가 붙음$/)
    expect(testPeriod.detail).toEqual([
      '늘어난 개발 기간은 그대로 둔다',
      '통합 테스트를 3주에서 1주로 줄인다',
    ])
  })

  it('항목 미룸은 그 항목만 세고, 안건 전체 미룸은 따로 센다', async () => {
    const thread = useThreadStore()
    await thread.addEntry('t5', 'defer', '응답 포맷은 기간계 회신 뒤에', '', null, 'di6')

    const detail = thread.threadDetail('t5')!
    expect(detail.items.map((v) => v.deferCount)).toEqual([0, 1])
    expect(detail.threadDeferCount).toBe(2)
    expect(detail.deferCount).toBe(3)
    expect(detail.events[0].itemTitle).toBe('응답(out) 항목')
    expect(detail.events.find((e) => e.entry.id === 'e5')!.itemTitle).toBeNull()
  })

  it('남은 항목을 정하면 결정됨, 정해진 안건에 항목을 더하면 논의중으로 돌아간다', async () => {
    const thread = useThreadStore()
    expect(state('t5')).toBe('open')
    await thread.addEntry('t5', 'decide', '처리 결과 코드 · 보험료 둘을 받는다', '', null, 'di6')
    expect(state('t5')).toBe('decided')

    const added = await thread.addItem('t5', '  오류 코드 체계 ')
    expect(thread.itemsOfThread('t5').at(-1)).toMatchObject({
      id: added,
      title: '오류 코드 체계',
      creatorId: 'u1',
    })
    expect(state('t5')).toBe('open')
    expect(thread.threadDetail('t5')!.settledCount).toBe(2)
  })

  it('빈 이름 · 200자 넘는 이름은 받지 않는다', async () => {
    const thread = useThreadStore()
    expect(await thread.addItem('t3', '   ')).toBeNull()
    expect(await thread.addItem('t3', '가'.repeat(201))).toBeNull()
    expect(thread.itemsOfThread('t3')).toEqual([])
  })

  it('이름 바꾸기 — 앞뒤 공백을 떼고, 상태는 그대로다', () => {
    const thread = useThreadStore()
    expect(thread.renameItem('di4', ' 통합 테스트 기간 ')).toBe(true)
    expect(thread.itemsOfThread('t6').map((i) => i.title)).toEqual([
      '통합 테스트 기간',
      '전체 일정',
    ])
    expect(thread.renameItem('di4', '  ')).toBe(false)
    expect(state('t6')).toBe('decided')
  })

  it('항목을 지우면 줄은 이력에 남고 상태를 다시 잰다 — 남은 항목이 다 정해졌으면 결정됨', async () => {
    const thread = useThreadStore()
    await thread.deleteItem('di6')
    expect(thread.itemsOfThread('t5').map((i) => i.id)).toEqual(['di5'])
    expect(state('t5')).toBe('decided')
    /* 정해 둔 항목을 지우면 남은 항목이 없어 논의중 — 줄은 그대로 남는다 */
    await thread.deleteItem('di5')
    expect(state('t5')).toBe('open')
    const e8 = thread.threadDetail('t5')!.events.find((e) => e.entry.id === 'e8')!
    expect(e8.itemTitle).toBe('지운 항목')
  })

  it('목록 행은 항목 수 · 정한 수를 센다', () => {
    const row = (id: string) => useThreadStore().rows.find((r) => r.thread.id === id)!
    expect([row('t5').itemCount, row('t5').settledItemCount]).toEqual([2, 1])
    expect([row('t6').itemCount, row('t6').settledItemCount]).toEqual([2, 2])
    expect([row('t3').itemCount, row('t3').settledItemCount]).toEqual([0, 0])
  })

  it('이름 바꾸기 · 지우기는 등록한 사람 · 안건을 고칠 수 있는 사람만 — 아니면 403', async () => {
    /* di5 — 등록 정하늘(u4) · t5 담당 · 작성 정하늘. 박지훈(u2)은 p1 일반 사용자 */
    await signInAs('u2@inno-ax.com')
    const thread = useThreadStore()
    const di5 = thread.itemsOfThread('t5')[0]
    expect(thread.canEditItem(di5)).toBe(false)
    expect(thread.renameItem('di5', '바꿔 봄')).toBe(false)
    forbiddenToast()
    const err = await thread.deleteItem('di5').catch((e: unknown) => e)
    expect((err as ApiError).code).toBe('FORBIDDEN')
    expect(thread.itemsOfThread('t5')).toHaveLength(2)

    /* 자기가 더한 항목은 고친다 */
    const mine = (await thread.addItem('t5', '내 항목'))!
    expect(thread.renameItem(mine, '내 항목 2')).toBe(true)
  })
})

describe('안건 목록', () => {
  it('고른 프로젝트의 안건만 서고, 대기와 논의중을 센다', () => {
    const thread = useThreadStore()
    expect(thread.rows).toHaveLength(9)
    expect(thread.queuedCount).toBe(4)
    expect(thread.openCount).toBe(2)
  })

  it("'마지막 기록' 은 마지막 Entry 를 남긴 한국 날짜다", () => {
    const thread = useThreadStore()
    const label = (id: string) => thread.rows.find((r) => r.thread.id === id)!.lastEntryLabel

    expect(label('t5')).toBe('9월 14일')
    expect(label('t1')).toBe('9월 9일')
    /* 기록이 없는 안건 */
    expect(label('t4')).toBe('—')
  })

  it('새 안건은 대기로 들어간다', async () => {
    const thread = useThreadStore()
    const id = await thread.addThread({ title: '배포 창구 정하기', ownerId: 'u2' })
    const row = thread.rows.find((r) => r.thread.id === id)!

    expect(row.thread.state).toBe('queued')
    expect(row.ownerName).toBe('박지훈')
    expect(thread.queuedCount).toBe(5)
  })
})

describe('안건 고치기', () => {
  const t3 = () => useThreadStore().threads.find((x) => x.id === 't3')!

  it('보낸 필드만 바뀐다', () => {
    const thread = useThreadStore()
    const before = { ...t3(), options: [...t3().options] }
    expect(thread.updateThread('t3', { title: '  외부 모델 호출 범위  ' })).toBe(true)

    expect(t3()).toEqual({ ...before, title: '외부 모델 호출 범위' })
  })

  it('담당자 · 기한은 null 로 비운다', () => {
    const thread = useThreadStore()
    thread.updateThread('t3', { ownerId: null, dueDate: null })
    expect(t3().ownerId).toBeNull()
    expect(t3().dueDate).toBeNull()
    expect(t3().description).not.toBe('')
  })

  it('후보는 통째로 바뀌고, 앞뒤 공백을 떼고 빈 줄은 버린다', () => {
    const thread = useThreadStore()
    thread.updateThread('t3', { options: [' 사내 모델만 ', '', '  '] })
    expect(t3().options).toEqual(['사내 모델만'])

    thread.updateThread('t3', { options: [] })
    expect(t3().options).toEqual([])
  })

  it('배경 · 기한 · 담당자를 같이 고친다', () => {
    const thread = useThreadStore()
    thread.updateThread('t4', {
      description: ' 기간계와 맞춘다 ',
      dueDate: '2026-10-30',
      ownerId: 'u3',
    })
    const t = thread.threads.find((x) => x.id === 't4')!
    expect(t.description).toBe('기간계와 맞춘다')
    expect(t.dueDate).toBe('2026-10-30')
    expect(t.ownerId).toBe('u3')
  })

  it('제목을 비우려 하면 아무것도 바꾸지 않는다', () => {
    const thread = useThreadStore()
    const before = { ...t3(), options: [...t3().options] }
    expect(thread.updateThread('t3', { title: '   ', ownerId: null })).toBe(false)
    expect(t3()).toEqual(before)
  })

  it('상태는 고치기로 바뀌지 않는다 — 이력으로만 바뀐다', () => {
    const thread = useThreadStore()
    thread.updateThread('t3', { ...({ state: 'decided' } as object) })
    expect(t3().state).toBe('open')
  })
})

describe('이력 글 고치기', () => {
  const e1 = () =>
    useThreadStore()
      .entriesOfThread('t1')
      .find((e) => e.id === 'e1')!

  it('요약 · 메모만 바뀌고 앞뒤 공백을 뗀다 — 안건 상태는 그대로다', () => {
    const thread = useThreadStore()
    expect(thread.updateEntry('e1', { text: ' 우분투 24.04 로 한다 ', note: '  ' })).toBe(true)
    expect(e1().text).toBe('우분투 24.04 로 한다')
    expect(e1().note).toBe('')
    expect(e1().kind).toBe('decide')
    expect(thread.threads.find((t) => t.id === 't1')!.state).toBe('decided')
  })

  it('빈 요약 · 없는 줄은 받지 않는다', () => {
    const thread = useThreadStore()
    const before = e1().text
    expect(thread.updateEntry('e1', { text: '   ' })).toBe(false)
    expect(e1().text).toBe(before)
    expect(thread.updateEntry('없는줄', { text: 'x' })).toBe(false)
  })
})

describe('안건 등록', () => {
  it('배경 · 후보 · 기한을 같이 받는다', async () => {
    const thread = useThreadStore()
    const id = await thread.addThread({
      title: '배포 창구 정하기',
      description: '배포 요청이 메신저로 흩어져 누가 받는지 모른다.',
      options: ['운영팀', '개발팀'],
      dueDate: '2026-10-20',
      ownerId: 'u2',
    })
    const t = thread.threads.find((x) => x.id === id)!

    expect(t.description).toBe('배포 요청이 메신저로 흩어져 누가 받는지 모른다.')
    expect(t.options).toEqual(['운영팀', '개발팀'])
    expect(t.dueDate).toBe('2026-10-20')
  })

  it("제목만 있어도 들어간다 — 나머지는 '' · [] · null", async () => {
    const thread = useThreadStore()
    const id = await thread.addThread({ title: '배포 창구 정하기' })
    const t = thread.threads.find((x) => x.id === id)!

    expect(t.description).toBe('')
    expect(t.options).toEqual([])
    expect(t.dueDate).toBeNull()
    expect(t.ownerId).toBeNull()
  })

  it('후보는 앞뒤 공백을 떼고 빈 줄은 버린다', async () => {
    const thread = useThreadStore()
    const id = await thread.addThread({
      title: '배포 창구 정하기',
      options: ['  운영팀 ', '', '   ', '개발팀'],
    })

    expect(thread.threads.find((x) => x.id === id)!.options).toEqual(['운영팀', '개발팀'])
  })
})

describe('기한 지남', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /* 2026-10-10 09:00 KST */
  const fixToday = () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-10T00:00:00Z'))
  }

  it('기한이 지났는데 못 정했으면 기한 지남, 결정됐으면 아니다', () => {
    const base = useThreadStore().threads[0]
    const t = { ...base, dueDate: '2026-10-09' }

    expect(isOverdue({ ...t, state: 'open' }, '2026-10-10')).toBe(true)
    expect(isOverdue({ ...t, state: 'queued' }, '2026-10-10')).toBe(true)
    expect(isOverdue({ ...t, state: 'decided' }, '2026-10-10')).toBe(false)
  })

  it('기한 당일은 아직 지난 게 아니고, 기한이 없으면 지날 일도 없다', () => {
    const base = { ...useThreadStore().threads[0], state: 'open' as const }

    expect(isOverdue({ ...base, dueDate: '2026-10-10' }, '2026-10-10')).toBe(false)
    expect(isOverdue({ ...base, dueDate: null }, '2026-10-10')).toBe(false)
  })

  it('오늘은 한국 시간으로 센다 — UTC 로는 전날 밤이어도 한국은 이미 다음 날이다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    /* UTC 10월 9일 16시 = KST 10월 10일 01시 */
    vi.setSystemTime(new Date('2026-10-09T16:00:00Z'))
    const thread = useThreadStore()
    const id = await thread.addThread({ title: '하루 지난 안건', dueDate: '2026-10-09' })

    expect(thread.rows.find((r) => r.thread.id === id)!.overdue).toBe(true)
  })

  it('목록과 상세가 같은 판정을 쓴다 — 결정된 안건은 기한이 지나도 세지 않는다', () => {
    fixToday()
    const thread = useThreadStore()
    const row = (id: string) => thread.rows.find((r) => r.thread.id === id)!

    /* t3 — 9월 30일 기한 · 미결정 */
    expect(row('t3').overdue).toBe(true)
    expect(row('t3').dueLabel).toBe('9월 30일')
    expect(thread.threadDetail('t3')!.overdue).toBe(true)
    /* t1 — 9월 12일 기한이지만 결정됨 */
    expect(row('t1').overdue).toBe(false)
    /* t5 — 10월 19일 기한 · 아직 남음 */
    expect(row('t5').overdue).toBe(false)
    /* t4 — 기한 없음 */
    expect(row('t4').dueLabel).toBe('—')
    expect(thread.overdueCount).toBe(1)
  })
})

async function signInAs(email: string) {
  setActivePinia(createPinia())
  await useAuthStore().login(email, MOCK_PASSWORD)
}

const forbiddenToast = () =>
  expect(vi.mocked(toastError).mock.calls.at(-1)?.[0]).toMatchObject({ code: 'FORBIDDEN' })

describe('작성자 · 권한 (목업)', () => {
  it('등록한 안건 · 남긴 줄에 로그인한 사람이 작성자로 찍히고, 안건 이력에 등록 한 줄이 남는다', async () => {
    const thread = useThreadStore()
    const data = useDataStore()
    const id = (await thread.addThread({ title: '새 안건' }))!
    expect(data.allThreads.find((t) => t.id === id)!.creatorId).toBe('u1')
    await thread.addEntry(id, 'defer', '다음에', '', null)
    expect(thread.entriesOfThread(id)[0].creatorId).toBe('u1')

    const rows = await fetchThreadHistory(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ changedBy: 'u1', changes: [{ field: 'created' }] })
  })

  it('작성자 · 담당자 · 관리자가 아니면 안건 고치기를 403 으로 막고 값은 그대로다', async () => {
    /* t1 — 작성자 · 담당자 모두 이도현(u3). 박지훈(u2)은 p1 일반 사용자 */
    await signInAs('u2@inno-ax.com')
    const thread = useThreadStore()
    const t1 = () => thread.threads.find((t) => t.id === 't1')!
    expect(thread.canEdit(t1())).toBe(false)
    expect(thread.canDelete(t1())).toBe(false)
    expect(thread.updateThread('t1', { title: '바꿔 봄' })).toBe(false)
    expect(t1().title).toBe('서버 OS 결정')
    forbiddenToast()

    /* 이력 줄 고치기도 같다 */
    const e1 = thread.entriesOfThread('t1')[0]
    expect(thread.canEditEntry(e1)).toBe(false)
    expect(thread.updateEntry(e1.id, { text: '바꿔 봄' })).toBe(false)
    expect(e1.text).toBe('우분투 최신 버전으로 한다')
  })

  it('결정 · 미루기는 누구나 남기고, 자기가 남긴 줄은 고칠 수 있다', async () => {
    await signInAs('u2@inno-ax.com')
    const thread = useThreadStore()
    expect(await thread.addEntry('t1', 'refine', '24.04 LTS', '', null, 'di1')).toBe(true)
    const mine = thread.entriesOfThread('t1').find((e) => e.text === '24.04 LTS')!
    expect(thread.canEditEntry(mine)).toBe(true)
    expect(thread.updateEntry(mine.id, { text: '24.04.1 LTS' })).toBe(true)
    expect(mine.text).toBe('24.04.1 LTS')
  })

  it('안건 담당자는 지울 수도 있다 — 작업과 다르다', async () => {
    /* t9 — 담당 · 작성 박지훈(u2) */
    await signInAs('u2@inno-ax.com')
    const thread = useThreadStore()
    const t9 = useDataStore().allThreads.find((t) => t.id === 't9')!
    t9.creatorId = 'u3'
    expect(thread.canDelete(t9)).toBe(true)
  })
})

describe('안건 지우기', () => {
  it('안건 · 그 이력 줄 · 작업 연결이 스토어에서 빠진다', async () => {
    const thread = useThreadStore()
    const data = useDataStore()
    expect(data.taskThreads.some((l) => l.threadId === 't1')).toBe(true)
    await thread.deleteThread('t1')
    expect(data.allThreads.some((t) => t.id === 't1')).toBe(false)
    expect(data.allEntries.some((e) => e.threadId === 't1')).toBe(false)
    expect(data.taskThreads.some((l) => l.threadId === 't1')).toBe(false)
    expect(thread.threadDetail('t1')).toBeNull()
  })

  it('떼어낸 하위 안건이 있으면 409 THREAD_HAS_CHILDREN — 아무것도 안 빠진다', async () => {
    const thread = useThreadStore()
    const data = useDataStore()
    data.allThreads.push({
      ...data.allThreads.find((t) => t.id === 't5')!,
      id: 'sub',
      parentThreadId: 't4',
    })
    const err = await thread.deleteThread('t4').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).code).toBe('THREAD_HAS_CHILDREN')
    expect(data.allThreads.some((t) => t.id === 't4')).toBe(true)
  })

  it('권한이 없으면 403 — 스토어도 그대로다', async () => {
    await signInAs('u2@inno-ax.com')
    const thread = useThreadStore()
    const err = await thread.deleteThread('t1').catch((e: unknown) => e)
    expect((err as ApiError).code).toBe('FORBIDDEN')
    expect(useDataStore().allThreads.some((t) => t.id === 't1')).toBe(true)
  })
})

describe('이력 줄 지우기', () => {
  const state = (id: string) => useThreadStore().threads.find((t) => t.id === id)!.state

  it('하나뿐인 결정을 지우면 줄이 없어 대기로 돌아간다 — 담당자는 그대로', async () => {
    const thread = useThreadStore()
    expect(state('t1')).toBe('decided')
    await thread.deleteEntry('e1')
    expect(thread.entriesOfThread('t1')).toEqual([])
    expect(state('t1')).toBe('queued')
    expect(thread.threads.find((t) => t.id === 't1')!.ownerId).toBe('u3')
  })

  it('미룸만 남으면 논의중, 항목이 다 정해진 채면 결정됨', async () => {
    const thread = useThreadStore()
    await thread.deleteEntry('e2')
    expect(state('t5')).toBe('open')
    const item = (await thread.addItem('t3', '호출 범위'))!
    await thread.addEntry('t3', 'decide', '사내 모델만', '', null, item)
    await thread.deleteEntry('e4')
    expect(state('t3')).toBe('decided')
  })

  it('한 항목의 결정을 지우면 그 항목이 아직이 되어 논의중', async () => {
    const thread = useThreadStore()
    await thread.deleteEntry('e7')
    expect(state('t6')).toBe('open')
    expect(thread.threadDetail('t6')!.items.map((v) => v.settled)).toEqual([true, false])
  })

  it('남긴 사람이 아니고 안건도 못 고치면 403', async () => {
    await signInAs('u2@inno-ax.com')
    const err = await useThreadStore()
      .deleteEntry('e1')
      .catch((e: unknown) => e)
    expect((err as ApiError).code).toBe('FORBIDDEN')
    expect(useThreadStore().entriesOfThread('t1')).toHaveLength(1)
  })
})

describe('안건 변경 이력 (목업)', () => {
  it('시드는 안건마다 등록 한 줄 — 바꾼 사람은 작성자', async () => {
    const rows = await fetchThreadHistory('t1')
    expect(rows).toEqual([
      {
        id: 'hh-t1-1',
        changedAt: '2026-09-08T00:30:00Z',
        changedBy: 'u3',
        backfilled: false,
        changes: [{ field: 'created', from: null, to: null, subject: '' }],
      },
    ])
    /* 담당자가 없던 안건은 작성자도 없다 */
    expect((await fetchThreadHistory('t4'))[0].changedBy).toBeNull()
  })

  it('고친 칸만 칸 표 순서로 — 후보는 줄바꿈으로 이은 글, 참조는 id 배열, 같은 값은 안 남긴다', async () => {
    const thread = useThreadStore()
    thread.updateThread('t3', {
      ccIds: ['u2'],
      options: ['사내 모델만', ' '],
      title: '외부 모델 허용 범위',
      dueDate: '2026-09-30',
    })
    const last = (await fetchThreadHistory('t3')).at(-1)!
    expect(last.changedBy).toBe('u1')
    expect(last.changes).toEqual([
      {
        field: 'title',
        from: '사내망에서 외부 모델 호출 허용 범위',
        to: '외부 모델 허용 범위',
        subject: '',
      },
      {
        field: 'options',
        from: '전면 허용\n비식별 데이터만 허용\n사내 모델만 사용',
        to: '사내 모델만',
        subject: '',
      },
      { field: 'ccIds', from: [], to: ['u2'], subject: '' },
    ])
  })

  it('이력 줄 고치기 · 지우기는 그 줄의 종류를 subject 로 남긴다', async () => {
    const thread = useThreadStore()
    thread.updateEntry('e1', { text: '우분투 24.04', note: '' })
    await thread.deleteEntry('e1')
    const rows = await fetchThreadHistory('t1')
    expect(rows.slice(1).map((r) => r.changes)).toEqual([
      [
        {
          field: 'entryText',
          from: '우분투 최신 버전으로 한다',
          to: '우분투 24.04',
          subject: 'decide',
        },
        {
          field: 'entryNote',
          from: 'PM 에게 전달받아 이도현이 정리했다. 회의로 다루지 않았다.',
          to: null,
          subject: 'decide',
        },
      ],
      [{ field: 'entryDeleted', from: '우분투 24.04', to: null, subject: 'decide' }],
    ])
  })
})
