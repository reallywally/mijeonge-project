import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDataStore } from './data'
import { isOverdue, useThreadStore } from './thread'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('안건 이력', () => {
  it('줄은 적은 날(KST)에 놓이고, 새 줄이 위로 온다', () => {
    const thread = useThreadStore()
    const detail = thread.threadDetail('t5')!

    expect(detail.events.map((e) => e.at)).toEqual(['2026-09-14', '2026-09-07'])
    expect(detail.events[0].entry.text).toBe('여전히 업무 정의가 없어 또 미룬다')
  })

  it('UTC 로는 전날이어도 한국 날짜에 놓인다', () => {
    const thread = useThreadStore()
    const data = useDataStore()
    /* UTC 9월 20일 16시 = KST 9월 21일 01시 */
    data.allEntries.push({
      id: 'x1',
      threadId: 't4',
      kind: 'refine',
      text: '야간 배치와 겹치지 않게',
      detail: [],
      note: '',
      ownerId: null,
      createdAt: '2026-09-20T16:00:00Z',
    })
    expect(thread.threadDetail('t4')!.events[0].at).toBe('2026-09-21')
  })

  it('두 번 미뤄진 안건은 미룸 수가 둘이고 아직 못 정한 상태다', () => {
    const thread = useThreadStore()
    const detail = thread.threadDetail('t5')!

    expect(detail.deferCount).toBe(2)
    expect(detail.settled).toBe(false)
    expect(detail.current).toBe('')
  })

  it('담당자 확인만으로 정한 줄도 결정으로 서고, 근거와 날짜가 따라온다', () => {
    const thread = useThreadStore()
    const detail = thread.threadDetail('t1')!

    expect(detail.settled).toBe(true)
    expect(detail.current).toBe('우분투 최신 버전으로 한다')
    expect(detail.settledNote).toBe('PM 에게 전달받아 이도현이 정리했다. 회의로 다루지 않았다.')
    expect(detail.settledLabel).toBe('9월 9일에 정해짐')
    expect(detail.settledOwnerName).toBe('이도현')
  })

  it('결정에 함께 적은 조건별 상세가 따라온다', () => {
    const thread = useThreadStore()
    const detail = thread.threadDetail('t2')!

    expect(detail.detail).toEqual([
      'postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺀다',
      'supabase 는 비용 때문에 뺀다',
    ])
  })

  it('같은 날 한 안건에 남긴 줄은 배열 순서로 갈린다', () => {
    const thread = useThreadStore()
    thread.addEntry('t3', 'decide', '사내망에서만 부른다', '', 'u1')
    thread.addEntry('t3', 'refine', '예외는 보안팀 승인 건만', '', 'u1')

    const detail = thread.threadDetail('t3')!
    /* 나중에 적은 줄이 위로 온다 — 배열 순서가 계약이다 (API.md Q4) */
    expect(detail.events.slice(0, 2).map((e) => e.entry.text)).toEqual([
      '예외는 보안팀 승인 건만',
      '사내망에서만 부른다',
    ])
    expect(detail.current).toBe('사내망에서만 부른다')
    expect(detail.detail).toEqual(['예외는 보안팀 승인 건만'])
  })

  it('이력의 날짜는 시각을 달지 않는다', () => {
    const thread = useThreadStore()
    thread.addEntry('t4', 'defer', '보안팀 답을 기다린다', '', 'u1')

    const event = thread.threadDetail('t4')!.events[0]
    expect(event.at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    /* 레코드에 남는 값은 계약대로 UTC 타임스탬프다 */
    expect(event.entry.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })

  it('나중 결정이 앞의 결정을 대체하고, 앞의 결정은 이력에 남는다', () => {
    const thread = useThreadStore()
    thread.addEntry('t2', 'decide', 'mariadb 로 바꾼다', '라이선스 때문에', 'u3')

    const detail = thread.threadDetail('t2')!
    expect(detail.current).toBe('mariadb 로 바꾼다')
    expect(detail.settledNote).toBe('라이선스 때문에')
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
  it('결정으로 남기면 결정됨이 되고, 처리한 사람이 담당자가 된다', () => {
    const thread = useThreadStore()
    thread.addEntry('t3', 'decide', '비식별 데이터만 허용', '보안팀 확인', 'u2')

    const t = thread.threads.find((x) => x.id === 't3')!
    expect(t.state).toBe('decided')
    expect(t.ownerId).toBe('u2')
  })

  it('처리한 사람 없이 결정하면 담당자는 그대로다', () => {
    const thread = useThreadStore()
    thread.addEntry('t3', 'decide', '비식별 데이터만 허용', '', null)
    expect(thread.threads.find((x) => x.id === 't3')!.ownerId).toBe('u1')
  })

  it('대기 중인 안건에 미룸 · 세부 추가를 남기면 논의중이 된다', () => {
    const thread = useThreadStore()
    thread.addEntry('t4', 'defer', '기간계 백업 주기를 먼저 알아본다', '', null)
    thread.addEntry('t7', 'refine', 'tool02 를 먼저', '', null)

    expect(thread.threads.find((x) => x.id === 't4')!.state).toBe('open')
    expect(thread.threads.find((x) => x.id === 't7')!.state).toBe('open')
    expect(thread.rows.find((r) => r.thread.id === 't4')!.deferCount).toBe(1)
  })

  it('결정된 안건에 세부 추가를 남겨도 결정됨 그대로다', () => {
    const thread = useThreadStore()
    thread.addEntry('t2', 'refine', '버전은 8.4', '', null)
    expect(thread.threads.find((x) => x.id === 't2')!.state).toBe('decided')
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

  it('새 안건은 대기로 들어간다', () => {
    const thread = useThreadStore()
    const id = thread.addThread({ title: '배포 창구 정하기', ownerId: 'u2' })
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

describe('안건 등록', () => {
  it('배경 · 후보 · 기한을 같이 받는다', () => {
    const thread = useThreadStore()
    const id = thread.addThread({
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

  it("제목만 있어도 들어간다 — 나머지는 '' · [] · null", () => {
    const thread = useThreadStore()
    const id = thread.addThread({ title: '배포 창구 정하기' })
    const t = thread.threads.find((x) => x.id === id)!

    expect(t.description).toBe('')
    expect(t.options).toEqual([])
    expect(t.dueDate).toBeNull()
    expect(t.ownerId).toBeNull()
  })

  it('후보는 앞뒤 공백을 떼고 빈 줄은 버린다', () => {
    const thread = useThreadStore()
    const id = thread.addThread({
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

  it('오늘은 한국 시간으로 센다 — UTC 로는 전날 밤이어도 한국은 이미 다음 날이다', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    /* UTC 10월 9일 16시 = KST 10월 10일 01시 */
    vi.setSystemTime(new Date('2026-10-09T16:00:00Z'))
    const thread = useThreadStore()
    const id = thread.addThread({ title: '하루 지난 안건', dueDate: '2026-10-09' })

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
