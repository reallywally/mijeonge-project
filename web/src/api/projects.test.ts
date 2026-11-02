import { beforeEach, describe, expect, it } from 'vitest'
import { login } from '@/api/auth'
import { mockDb, resetMockAuth } from '@/api/mockAuth'
import {
  createProject,
  deleteProject,
  fetchProjectMembers,
  fetchProjects,
  patchProject,
} from '@/api/projects'
import { MOCK_ADMIN_PASSWORD, MOCK_PASSWORD } from '@/fixtures'

/* 프로젝트 등록 · 수정 · 삭제의 목업 갈래가 계약대로(권한 · 기간 · 소프트 삭제) 도는지 */
const fail = (p: Promise<unknown>) => p.then(() => null).catch((e: unknown) => e)

const asAdmin = () => login({ email: 'admin@inno-ax.com', password: MOCK_ADMIN_PASSWORD })
const asUser = (email: string) => login({ email, password: MOCK_PASSWORD })

beforeEach(() => {
  resetMockAuth()
})

describe('목록', () => {
  it('볼 수 있는 것만, 진행 → 준비 → 종료 순이다', async () => {
    await asUser('u2@inno-ax.com')
    expect((await fetchProjects()).map((p) => p.id)).toEqual(['p1', 'p2'])

    mockDb().projects.find((p) => p.id === 'p1')!.status = 'closed'
    expect((await fetchProjects()).map((p) => p.id)).toEqual(['p2', 'p1'])

    mockDb().projects.find((p) => p.id === 'p1')!.status = 'planned'
    mockDb().projects.find((p) => p.id === 'p2')!.status = 'active'
    expect((await fetchProjects()).map((p) => p.id)).toEqual(['p2', 'p1'])
  })
})

describe('등록', () => {
  it('설명 · 기간을 선택으로 받고, 비운 설명은 null 이다', async () => {
    await asAdmin()
    const made = await createProject({
      name: ' 새 사업 ',
      description: '  ',
      startDate: '2026-11-01',
      endDate: '2026-11-01',
    })
    expect(made).toMatchObject({
      name: '새 사업',
      description: null,
      startDate: '2026-11-01',
      endDate: '2026-11-01',
      status: 'active',
      closedAt: null,
    })
    expect((await fetchProjects()).map((p) => p.id)).toContain(made.id)
  })

  it('시스템 관리자만 — 프로젝트 관리자는 403', async () => {
    await asUser('u1@inno-ax.com')
    expect(await fail(createProject({ name: '새 사업' }))).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    })
  })

  it('종료일이 앞서면 400 PROJECT_DATE_RANGE, 설명이 길면 422', async () => {
    await asAdmin()
    expect(
      await fail(
        createProject({ name: '새 사업', startDate: '2026-11-02', endDate: '2026-11-01' }),
      ),
    ).toMatchObject({ status: 400, code: 'PROJECT_DATE_RANGE' })
    expect(
      await fail(createProject({ name: '새 사업', description: 'x'.repeat(2001) })),
    ).toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      detail: { description: expect.any(String) },
    })
  })
})

describe('수정', () => {
  it('보낸 것만 바뀌고 null 은 지운다', async () => {
    await asUser('u1@inno-ax.com')
    const next = await patchProject('p1', { description: null, endDate: '2027-01-31' })
    expect(next).toMatchObject({
      name: '한화손보 차세대',
      description: null,
      startDate: '2026-03-02',
      endDate: '2027-01-31',
    })
    const cleared = await patchProject('p1', { startDate: null })
    expect(cleared).toMatchObject({ startDate: null, endDate: '2027-01-31' })
  })

  it('기간은 남은 값과 합쳐 본다 — 시작일만 보내도 거꾸로면 400', async () => {
    await asUser('u1@inno-ax.com')
    expect(await fail(patchProject('p1', { startDate: '2027-02-01' }))).toMatchObject({
      status: 400,
      code: 'PROJECT_DATE_RANGE',
    })
    expect(mockDb().projects.find((p) => p.id === 'p1')!.startDate).toBe('2026-03-02')
  })

  it('종료하면 closedAt 이 서고, 다시 열면 지워진다', async () => {
    await asUser('u1@inno-ax.com')
    const closed = await patchProject('p1', { status: 'closed' })
    expect(closed.status).toBe('closed')
    expect(closed.closedAt).toMatch(/Z$/)
    const reopened = await patchProject('p1', { status: 'active' })
    expect(reopened).toMatchObject({ status: 'active', closedAt: null })
  })

  it('준비로 두면 closedAt 은 null — 종료에서 준비로 가도 지워진다. 같은 종료를 다시 보내면 시각은 그대로', async () => {
    await asUser('u1@inno-ax.com')
    expect(await patchProject('p1', { status: 'planned' })).toMatchObject({
      status: 'planned',
      closedAt: null,
    })
    const closed = await patchProject('p1', { status: 'closed' })
    const again = await patchProject('p1', { status: 'closed' })
    expect(again.closedAt).toBe(closed.closedAt)
    expect(await patchProject('p1', { status: 'planned' })).toMatchObject({ closedAt: null })
  })

  it('세 값 밖의 상태는 422 로 거절하고 아무것도 바꾸지 않는다', async () => {
    await asUser('u1@inno-ax.com')
    const bad = { name: '바뀌면 안 됨', status: 'archived' } as unknown as Parameters<
      typeof patchProject
    >[1]
    expect(await fail(patchProject('p1', bad))).toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
    })
    expect(mockDb().projects.find((p) => p.id === 'p1')).toMatchObject({
      name: '한화손보 차세대',
      status: 'active',
    })
  })

  it('일반 사용자는 403, 안 보이는 프로젝트는 404', async () => {
    await asUser('u2@inno-ax.com')
    expect(await fail(patchProject('p1', { name: '새 이름' }))).toMatchObject({ status: 403 })
    expect(await fail(patchProject('p3', { name: '새 이름' }))).toMatchObject({
      status: 404,
      code: 'PROJECT_NOT_FOUND',
    })
  })
})

describe('삭제', () => {
  it('시스템 관리자만 — 프로젝트 관리자는 403', async () => {
    await asUser('u1@inno-ax.com')
    expect(await fail(deleteProject('p1'))).toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })

  it('지우면 목록에서 빠지고 그 프로젝트 경로는 404 다. 다시 지워도 404', async () => {
    await asAdmin()
    expect(await deleteProject('p2')).toBeUndefined()
    expect((await fetchProjects()).map((p) => p.id)).toEqual(['p1', 'p3'])
    expect(await fail(fetchProjectMembers('p2'))).toMatchObject({
      status: 404,
      code: 'PROJECT_NOT_FOUND',
    })
    expect(await fail(patchProject('p2', { name: '되살리기' }))).toMatchObject({ status: 404 })
    expect(await fail(deleteProject('p2'))).toMatchObject({ status: 404 })
  })

  it('지운 프로젝트의 역할은 내 정보에서 빠지고, 접두사는 다시 쓰지 못한다', async () => {
    await asAdmin()
    await deleteProject('p1')
    expect((await asUser('u1@inno-ax.com')).projectRoles).toEqual({ p2: 'user', p3: 'user' })
    await asAdmin()
    expect(await fail(createProject({ name: '새 사업', taskKeyPrefix: 'HW' }))).toMatchObject({
      status: 409,
      code: 'PROJECT_PREFIX_TAKEN',
    })
  })
})
