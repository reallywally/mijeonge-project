import { describe, expect, it } from 'vitest'
import {
  bodyChanged,
  change,
  changeView,
  clipText,
  diffChanges,
  historyView,
  MISSING,
  orderChanges,
  type HistoryNames,
} from '@/lib/history'
import type { HistoryEntry, TaskLine } from '@/types/domain'

/* 변경 이력의 칸 비교 · 화면 말 (docs/api/history.md '모양' · '화면') */

const names: HistoryNames = {
  member: (id) => ({ u1: '김철수', u3: '박지민' })[id] ?? null,
  part: (id) => ({ pt1: '인프라' })[id] ?? null,
  task: (id) => ({ k4: 'HW-4', k19: 'HW-19' })[id] ?? null,
  thread: (id) => ({ t1: '서버 OS 결정' })[id] ?? null,
  test: (id) => ({ tc1: 'HW-T1' })[id] ?? null,
}

const line = (text: string, rest: Partial<TaskLine> = {}): TaskLine => ({
  id: text,
  kind: 'check',
  text,
  done: false,
  level: 0,
  ...rest,
})

describe('칸 비교', () => {
  it('보낸 칸 가운데 값이 바뀐 것만, 칸 표 순서로', () => {
    const before = { title: '설계', status: 'todo', ownerId: null, due: '2026-09-22' }
    expect(
      diffChanges(
        before,
        { due: '2026-09-30', ownerId: 'u1', title: '설계', status: 'doing' },
        'task',
      ),
    ).toEqual([
      change('status', 'todo', 'doing'),
      change('ownerId', null, 'u1'),
      change('due', '2026-09-22', '2026-09-30'),
    ])
  })

  it('하나도 안 바뀌면 빈 배열, 보내지 않은 칸(undefined)은 안 본다', () => {
    expect(diffChanges({ title: '설계' }, { title: '설계', due: undefined }, 'task')).toEqual([])
  })

  it('테스트는 테스트 칸 표 순서 — 상태 다음에 결과 메모, 지난 줄의 실패 단계는 그 사이', () => {
    expect(
      orderChanges(
        [
          change('resultNote', null, '열린다'),
          change('failedStep', null, 2),
          change('status', 'testing', 'fail'),
        ],
        'test',
      ).map((c) => c.field),
    ).toEqual(['status', 'failedStep', 'resultNote'])
  })

  it('본문은 줄 글 · 종류 · 체크 · 들여쓰기 · 순서 중 하나라도 바뀌면 바뀐 것. 줄 id 는 안 본다', () => {
    const a = [line('하나'), line('둘')]
    expect(
      bodyChanged(
        a,
        a.map((l) => ({ ...l, id: `x${l.id}` })),
      ),
    ).toBe(false)
    expect(bodyChanged(a, [line('둘'), line('하나')])).toBe(true)
    expect(bodyChanged(a, [line('하나', { done: true }), line('둘')])).toBe(true)
    expect(bodyChanged(a, [line('하나', { level: 1 }), line('둘')])).toBe(true)
    expect(bodyChanged(a, [line('하나', { kind: 'bullet' }), line('둘')])).toBe(true)
    expect(bodyChanged(a, [line('하나')])).toBe(true)
  })
})

describe('화면 말', () => {
  const task = (c: ReturnType<typeof change>) => changeView('task', c, names)
  const test = (c: ReturnType<typeof change>) => changeView('test', c, names)

  it('상태 · 우선순위는 라벨, 사람 · 파트는 이름, 작업은 키, 날짜는 M/D', () => {
    expect(task(change('status', 'todo', 'doing'))).toMatchObject({
      label: '상태',
      from: '해야 할 일',
      to: '진행 중',
    })
    expect(test(change('status', 'testing', 'fail'))).toMatchObject({
      from: '테스트 중',
      to: '실패',
    })
    expect(task(change('priority', 'normal', 'high'))).toMatchObject({
      label: '우선순위',
      from: '보통',
      to: '높음',
    })
    expect(task(change('ownerId', null, 'u1'))).toMatchObject({
      label: '담당자',
      from: '없음',
      to: '김철수',
    })
    expect(task(change('partId', 'pt1', null))).toMatchObject({ from: '인프라', to: '공통' })
    expect(task(change('parentId', null, 'k4'))).toMatchObject({
      label: '상위 작업',
      from: '최상위 작업',
      to: 'HW-4',
    })
    // 연관 작업은 걷었지만(Q62) 지난 줄은 읽는다
    expect(task(change('relatedIds', [], ['k4']))).toMatchObject({
      label: '연관 작업',
      from: '없음',
      to: 'HW-4',
    })
    expect(test(change('parentId', 'tc1', null))).toMatchObject({
      label: '상위 테스트',
      from: 'HW-T1',
      to: '최상위 테스트',
    })
    expect(task(change('start', null, '2026-09-08'))).toMatchObject({
      label: '시작 날짜',
      from: '미정',
      to: '9/8',
    })
    expect(test(change('failedStep', null, 2))).toMatchObject({ from: '없음', to: '2단계' })
  })

  it("지금 없는(지운) 사람 · 작업 · 안건은 '(삭제됨)'", () => {
    expect(task(change('ownerId', 'u9', 'u1')).from).toBe(MISSING)
    expect(task(change('parentId', 'k99', null)).from).toBe(MISSING)
    expect(task(change('thread', null, 't99')).value).toBe(MISSING)
  })

  it('걸기 · 떼기는 무엇을 걸고 뗐는지 한 값으로', () => {
    expect(task(change('thread', null, 't1'))).toMatchObject({
      label: '안건 걸기',
      value: '서버 OS 결정',
    })
    // 선행 작업은 걷었지만(Q63) 지난 줄은 읽는다
    expect(task(change('dependsOn', 'k19', null))).toMatchObject({
      label: '선행 작업 떼기',
      value: 'HW-19',
    })
    expect(test(change('taskRef', null, 'k4'))).toMatchObject({
      label: '작업 태그 걸기',
      value: 'HW-4',
    })
    expect(test(change('threadRef', 't1', null))).toMatchObject({
      label: '안건 태그 떼기',
      value: '서버 OS 결정',
    })
  })

  it('등록 · 본문 · 단계(지난 줄) · 체크 · 기준은 문구 하나', () => {
    expect(task(change('created', null, null)).label).toBe('등록')
    expect(changeView('task', change('created', null, null), names, true).label).toBe(
      '등록(이전 기록 없음)',
    )
    expect(task(change('body', null, null)).label).toBe('본문 고침')
    expect(test(change('steps', 3, 4)).label).toBe('단계 고침 (3 → 4개)')
    expect(test(change('steps', 2, 2)).label).toBe('단계 고침 (2개)')
    expect(task(change('lineDone', false, true, 'CI 러너 붙이기')).label).toBe('☑ CI 러너 붙이기')
    expect(task(change('lineDone', true, false, 'CI 러너 붙이기')).label).toBe('☐ CI 러너 붙이기')
    expect(test(change('basis', null, null)).label).toBe('기준 그대로 맞다 확인')
  })

  it('같은 상태를 다시 고른 것은 다시 고름으로', () => {
    expect(test(change('status', 'testing', 'testing'))).toMatchObject({
      label: '상태',
      value: '테스트 중 (다시 고름)',
    })
  })

  it('긴 글 칸은 long, 비운 글은 (비움) · 결과 메모 null 은 없음', () => {
    expect(test(change('content', '목적\n로그인', ''))).toMatchObject({
      label: '테스트 내용',
      from: '목적\n로그인',
      to: '(비움)',
      long: true,
    })
    /* 걷은 칸(Q60)도 지난 줄에 있으니 읽는다 */
    expect(test(change('purpose', '', '로그인을 본다'))).toMatchObject({
      label: '목적',
      from: '(비움)',
      long: true,
    })
    expect(test(change('resultNote', '열린다', null))).toMatchObject({
      label: '결과 메모',
      to: '없음',
      long: true,
    })
    expect(task(change('title', '설계', '설계 1차')).long).toBe(false)
  })

  it('최근 것부터, 등록(이전 기록 없음) 줄은 사람 없이, 모르는 사람은 이름 대신 표시', () => {
    const entries: HistoryEntry[] = [
      {
        id: 'h1',
        changedAt: '2026-09-04T00:20:00Z',
        changedBy: null,
        backfilled: true,
        changes: [change('created', null, null)],
      },
      {
        id: 'h2',
        changedAt: '2026-10-08T00:00:00Z',
        changedBy: 'u3',
        backfilled: false,
        changes: [change('status', 'todo', 'doing')],
      },
      {
        id: 'h3',
        changedAt: '2026-10-09T00:00:00Z',
        changedBy: 'u9',
        backfilled: false,
        changes: [change('body', null, null)],
      },
      {
        id: 'h4',
        changedAt: '2026-10-10T00:00:00Z',
        changedBy: null,
        backfilled: false,
        changes: [change('body', null, null)],
      },
    ]
    const view = historyView('task', entries, names)
    expect(view.map((v) => [v.id, v.who])).toEqual([
      ['h4', '알 수 없음'],
      ['h3', MISSING],
      ['h2', '박지민'],
      ['h1', null],
    ])
    expect(view[3].changes[0].label).toBe('등록(이전 기록 없음)')
  })

  it('긴 글은 줄이고, 줄바꿈은 한 칸으로 편다', () => {
    expect(clipText('짧다')).toEqual({ text: '짧다', clipped: false })
    expect(clipText('한 줄\n두 줄')).toEqual({ text: '한 줄 두 줄', clipped: true })
    const long = '가'.repeat(80)
    expect(clipText(long)).toEqual({ text: `${'가'.repeat(60)}…`, clipped: true })
  })
})
