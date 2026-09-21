import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useThreadStore } from './thread'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('안건 이력', () => {
  it('회의에 붙은 줄은 그 회의의 날짜에 놓이고, 새 줄이 위로 온다', () => {
    const thread = useThreadStore()
    const detail = thread.threadDetail('t5')!

    expect(detail.events.map((e) => e.at)).toEqual(['2026-09-14', '2026-09-07'])
    expect(detail.events[0].meeting?.title).toBe('기간계 API in · out 재회의')
  })

  it('두 번 미뤄진 안건은 미룸 수가 둘이고 아직 못 정한 상태다', () => {
    const thread = useThreadStore()
    const detail = thread.threadDetail('t5')!

    expect(detail.deferCount).toBe(2)
    expect(detail.settled).toBe(false)
    expect(detail.current).toBe('')
  })

  it('회의 밖에서 정한 줄도 결정으로 선다', () => {
    const thread = useThreadStore()
    const detail = thread.threadDetail('t1')!

    expect(detail.settled).toBe(true)
    expect(detail.current).toBe('우분투 최신 버전으로 한다')
    expect(detail.events[0].meeting).toBeNull()
    expect(detail.settledLabel).toContain('담당자 확인')
  })

  it('결정에 함께 적은 조건별 상세가 따라온다', () => {
    const thread = useThreadStore()
    const detail = thread.threadDetail('t2')!

    expect(detail.detail).toEqual([
      'postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺀다',
      'supabase 는 비용 때문에 뺀다',
    ])
  })

  it('나중 결정이 앞의 결정을 대체한다', () => {
    const thread = useThreadStore()
    thread.addOutsideEntry('t2', 'decide', 'mariadb 로 바꾼다', '라이선스 때문에', 'u3')

    const detail = thread.threadDetail('t2')!
    expect(detail.current).toBe('mariadb 로 바꾼다')
    expect(detail.events.filter((e) => e.superseded).map((e) => e.entry.text)).toEqual([
      'mysql 을 쓴다',
    ])
  })
})

describe('안건 목록', () => {
  it('고른 프로젝트의 안건만 서고, 대기와 미결정을 센다', () => {
    const thread = useThreadStore()
    expect(thread.rows).toHaveLength(9)
    expect(thread.queuedCount).toBe(4)
    expect(thread.openCount).toBe(2)
  })

  it('새 안건은 대기로 들어가 다음 회의 후보가 된다', () => {
    const thread = useThreadStore()
    const id = thread.addThread('배포 창구 정하기', 'u2')
    const row = thread.rows.find((r) => r.thread.id === id)!

    expect(row.thread.state).toBe('queued')
    expect(row.ownerName).toBe('박지훈')
    expect(thread.queuedCount).toBe(5)
  })
})
