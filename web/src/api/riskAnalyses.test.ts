import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { login } from '@/api/auth'
import { ApiError } from '@/api/client'
import { mockDb, resetMockAuth, writeMockSession } from '@/api/mockAuth'
import { streamRiskSummary } from '@/api/risk'
import {
  deleteRiskAnalysis,
  fetchRiskAnalyses,
  fetchRiskAnalysis,
  renameRiskAnalysis,
  saveRiskAnalysis,
} from '@/api/riskAnalyses'
import { MOCK_PASSWORD } from '@/fixtures'

/* 저장한 AI 리스크 분석 — 목업 갈래가 서버와 같은 규칙 · 오류 코드로 도는지, 서버 갈래의 경로 (docs/api/risk-analysis.md) */
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const signIn = async (who: string) => {
  resetMockAuth()
  await login({ email: `${who}@inno-ax.com`, password: MOCK_PASSWORD })
}
const switchTo = (memberId: string) => writeMockSession(memberId)

async function failure(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  )
  expect(e).toBeInstanceOf(ApiError)
  return e as ApiError
}

/** 보이는 줄로 분석을 끝까지 받고 done 의 analysisId 를 낸다 */
async function analyzed(
  agendaIds = ['t5', 't3', 't8'],
  taskIds: string[] = [],
  testIds: string[] = [],
) {
  vi.useFakeTimers()
  let analysisId: string | undefined
  const run = (async () => {
    for await (const e of streamRiskSummary(
      'p1',
      { agendaIds, taskIds, testIds },
      new AbortController().signal,
    ))
      if (e.type === 'done') analysisId = e.analysisId
  })()
  await vi.runAllTimersAsync()
  await run
  vi.useRealTimers()
  return analysisId
}

describe('게시판 · 상세', () => {
  beforeEach(() => signIn('u2'))

  it('저장한 것만 번호 내림차순, 높음(세 종류 합) · 종류별 수를 센다 — 옛 모양은 작업 · 테스트 0', async () => {
    const page = await fetchRiskAnalyses('p1')
    expect(page.total).toBe(2)
    expect(
      page.items.map((r) => [r.seq, r.title, r.highCount, r.agendaCount, r.taskCount, r.testCount]),
    ).toEqual([
      [2, '10월 셋째 주 리스크', 3, 4, 4, 3],
      [1, '리스크 분석 2026-10-08', 1, 3, 0, 0],
    ])
    expect(await fetchRiskAnalyses('p2')).toEqual({ items: [], total: 0 })
  })

  it('limit · offset 으로 잇는다', async () => {
    const page = await fetchRiskAnalyses('p1', 1, 1)
    expect(page).toMatchObject({ total: 2, items: [{ seq: 1 }] })
  })

  it('임시 분석은 게시판 · 상세에 안 보인다', async () => {
    const id = await analyzed()
    expect(id).toBeTruthy()
    expect((await fetchRiskAnalyses('p1')).total).toBe(2)
    expect(await failure(fetchRiskAnalysis(id!))).toMatchObject({
      status: 404,
      code: 'RISK_ANALYSIS_NOT_FOUND',
    })
  })

  it('못 보는 프로젝트 것은 404', async () => {
    mockDb().grants = mockDb().grants.filter((g) => !(g.memberId === 'u2' && g.projectId === 'p1'))
    expect(await failure(fetchRiskAnalysis('ra1'))).toMatchObject({ status: 404 })
    expect(await failure(fetchRiskAnalyses('p1'))).toMatchObject({
      status: 404,
      code: 'PROJECT_NOT_FOUND',
    })
  })
})

describe('저장', () => {
  beforeEach(() => signIn('u2'))

  it('제목을 다듬어 저장하면 다음 번호로 게시판 맨 위 — 앞 분석 대비가 세 종류로 들어 있다', async () => {
    const id = (await analyzed(['t5', 't3', 't8'], ['k20', 'k21'], ['tc2']))!
    const saved = await saveRiskAnalysis('p1', { analysisId: id, title: '  이번 주  ' })
    expect(saved).toMatchObject({
      id,
      seq: 3,
      title: '이번 주',
      createdBy: 'u2',
      agendaCount: 3,
      taskCount: 2,
      testCount: 1,
      highCount: 2,
    })
    expect(saved.facts.tasks.map((t) => [t.taskId, t.key, t.level, t.ownerName])).toEqual([
      ['k20', 'HW-20', 'high', '이도현'],
      ['k21', 'HW-21', 'high', '김서연'],
    ])
    expect(saved.facts.tests).toEqual([
      {
        testId: 'tc2',
        key: 'HW-T2',
        title: '올바른 계정으로 로그인',
        level: 'low',
        score: 2,
        signals: ['flaky'],
        ownerName: '박지훈',
      },
    ])
    expect(saved.facts.compare).toMatchObject({
      previousId: 'ra2',
      added: [{ kind: 'task', id: 'k21' }],
      removed: [
        { kind: 'agenda', id: 't9' },
        { kind: 'task', id: 'k4' },
        { kind: 'task', id: 'k18' },
        { kind: 'task', id: 'k22' },
        { kind: 'test', id: 'tc3' },
        { kind: 'test', id: 'tc4' },
      ],
    })
    expect(saved.facts.compare!.kept).toContainEqual({
      kind: 'agenda',
      id: 't8',
      levelFrom: 'medium',
      levelTo: 'medium',
    })
    expect(saved.facts.compare!.kept).toContainEqual({
      kind: 'test',
      id: 'tc2',
      levelFrom: 'low',
      levelTo: 'low',
    })
    expect((await fetchRiskAnalyses('p1')).items[0]).toMatchObject({ id, seq: 3 })
  })

  it('같은 것을 두 번 저장하면 409', async () => {
    const id = (await analyzed())!
    await saveRiskAnalysis('p1', { analysisId: id, title: '한 번' })
    expect(await failure(saveRiskAnalysis('p1', { analysisId: id, title: '두 번' }))).toMatchObject(
      { status: 409, code: 'RISK_ANALYSIS_ALREADY_SAVED' },
    )
  })

  it('없는 · 남이 돌린 · 다른 프로젝트 · 24시간 지난 임시 분석은 404', async () => {
    const id = (await analyzed())!
    const notFound = { status: 404, code: 'RISK_ANALYSIS_NOT_FOUND' }
    expect(await failure(saveRiskAnalysis('p1', { analysisId: 'zz', title: 't' }))).toMatchObject(
      notFound,
    )
    expect(await failure(saveRiskAnalysis('p2', { analysisId: id, title: 't' }))).toMatchObject(
      notFound,
    )
    switchTo('u3')
    expect(await failure(saveRiskAnalysis('p1', { analysisId: id, title: 't' }))).toMatchObject(
      notFound,
    )
    switchTo('u2')
    const row = mockDb().riskAnalyses.find((r) => r.id === id)!
    row.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    expect(await failure(saveRiskAnalysis('p1', { analysisId: id, title: 't' }))).toMatchObject(
      notFound,
    )
  })

  it('제목이 비었거나 100자를 넘으면 422 detail.title', async () => {
    const id = (await analyzed())!
    for (const title of ['   ', 'x'.repeat(101)])
      expect(await failure(saveRiskAnalysis('p1', { analysisId: id, title }))).toMatchObject({
        status: 422,
        code: 'VALIDATION_ERROR',
        detail: { title: expect.any(String) },
      })
  })
})

describe('제목 고치기 · 지우기', () => {
  it('고치기는 작성자만 — 관리자도 403', async () => {
    await signIn('u3')
    const renamed = await renameRiskAnalysis('ra2', '고친 제목')
    expect(renamed).toMatchObject({ title: '고친 제목', titleEditedAt: expect.any(String) })
    /* 같은 제목이면 고친 시각을 다시 찍지 않는다 */
    expect((await renameRiskAnalysis('ra1', '리스크 분석 2026-10-08').catch((e) => e)).status).toBe(
      403,
    )
    switchTo('u1')
    expect((await renameRiskAnalysis('ra1', ' 리스크 분석 2026-10-08 ')).titleEditedAt).toBeNull()
    switchTo('u3')
    switchTo('u1')
    expect(await failure(renameRiskAnalysis('ra2', '관리자'))).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    })
  })

  it('지우기는 작성자 · 프로젝트 관리자 · 시스템 관리자, 그 밖 403', async () => {
    await signIn('u2')
    expect(await failure(deleteRiskAnalysis('ra2'))).toMatchObject({ status: 403 })
    switchTo('u1')
    await deleteRiskAnalysis('ra2')
    expect(await failure(fetchRiskAnalysis('ra2'))).toMatchObject({ status: 404 })
    switchTo('u0')
    await deleteRiskAnalysis('ra1')
    expect((await fetchRiskAnalyses('p1')).total).toBe(0)
  })

  it('지운 번호는 다시 쓰지 않는다', async () => {
    await signIn('u3')
    await deleteRiskAnalysis('ra2')
    const id = (await analyzed())!
    expect((await saveRiskAnalysis('p1', { analysisId: id, title: '다음' })).seq).toBe(3)
  })
})

describe('옛 모양 읽기', () => {
  it('2026-11-06 전 분석 — compare 의 문자열 · agendaId 를 { kind, id } 로, 없는 tasks · tests 는 []', async () => {
    await signIn('u2')
    const old = mockDb().riskAnalyses.find((r) => r.id === 'ra1')!
    old.facts.compare = {
      previousId: 'ra0',
      previousTitle: '더 옛 분석',
      previousSavedAt: '2026-10-01T00:00:00Z',
      added: ['t3'],
      removed: ['t6'],
      kept: [{ agendaId: 't5', levelFrom: 'high', levelTo: 'medium' }],
    }
    const got = await fetchRiskAnalysis('ra1')
    expect(got.facts.tasks).toEqual([])
    expect(got.facts.tests).toEqual([])
    expect(got.facts.compare).toEqual({
      previousId: 'ra0',
      previousTitle: '더 옛 분석',
      previousSavedAt: '2026-10-01T00:00:00Z',
      added: [{ kind: 'agenda', id: 't3' }],
      removed: [{ kind: 'agenda', id: 't6' }],
      kept: [{ kind: 'agenda', id: 't5', levelFrom: 'high', levelTo: 'medium' }],
    })
  })
})

describe('서버 갈래', () => {
  beforeEach(() => vi.stubEnv('VITE_USE_MOCK', 'false'))

  it('게시판은 프로젝트 아래, 상세 · 고치기 · 지우기는 /risk-analyses/{id}', async () => {
    const fake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    )
    vi.stubGlobal('fetch', fake)
    await fetchRiskAnalyses('p 1', 50)
    await saveRiskAnalysis('p1', { analysisId: 'ra9', title: '제목' })
    await fetchRiskAnalysis('ra9')
    await renameRiskAnalysis('ra9', '고침')
    await deleteRiskAnalysis('ra9').catch(() => {})
    expect(fake.mock.calls.map(([url, init]) => [init.method, url])).toEqual([
      ['GET', '/api/projects/p%201/risk-analyses?limit=50&offset=50'],
      ['POST', '/api/projects/p1/risk-analyses'],
      ['GET', '/api/risk-analyses/ra9'],
      ['PATCH', '/api/risk-analyses/ra9'],
      ['DELETE', '/api/risk-analyses/ra9'],
    ])
    expect(JSON.parse(fake.mock.calls[1][1].body as string)).toEqual({
      analysisId: 'ra9',
      title: '제목',
    })
    expect(JSON.parse(fake.mock.calls[3][1].body as string)).toEqual({ title: '고침' })
  })

  it('옛 서버 응답(작업 · 테스트 전)도 읽는다 — 수는 0, compare 는 { kind, id }', async () => {
    const legacy = {
      id: 'ra1',
      projectId: 'p1',
      seq: 1,
      title: '옛 분석',
      createdBy: 'u1',
      createdAt: '2026-10-08T01:10:00Z',
      savedAt: '2026-10-08T01:12:00Z',
      agendaCount: 1,
      highCount: 0,
      body: '',
      refs: [],
      titleEditedAt: null,
      facts: {
        asOf: '2026-10-08',
        settings: { dueSoonDays: 3, staleDays: 7, highScore: 6, mediumScore: 3 },
        agendas: [],
        compare: {
          previousId: 'ra0',
          previousTitle: '',
          previousSavedAt: '',
          added: ['t1'],
          removed: [],
          kept: [],
        },
      },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(legacy), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    )
    const got = await fetchRiskAnalysis('ra1')
    expect(got).toMatchObject({ taskCount: 0, testCount: 0 })
    expect(got.facts.tasks).toEqual([])
    expect(got.facts.compare!.added).toEqual([{ kind: 'agenda', id: 't1' }])
  })
})
