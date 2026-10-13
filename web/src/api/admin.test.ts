import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemberAccount,
  fetchMemberAccounts,
  patchMemberAccount,
  setMemberPassword,
} from '@/api/admin'
import { changePassword, fetchMe, login, logout } from '@/api/auth'
import { setUnauthenticatedHandler } from '@/api/client'
import { resetMockAuth } from '@/api/mockAuth'
import { deleteProjectMember, fetchProjectMembers, putProjectMember } from '@/api/projects'
import { MOCK_ADMIN_PASSWORD, MOCK_PASSWORD } from '@/fixtures'

/* 목업 갈래가 서버처럼 권한과 오류 코드를 보는지 — 화면은 서버 없이 이 갈래로 만든다 (docs/api/auth.md) */
const fail = (p: Promise<unknown>) => p.then(() => null).catch((e: unknown) => e)

const asAdmin = () => login({ email: 'admin@innoflow.local', password: MOCK_ADMIN_PASSWORD })
const asUser = (email: string) => login({ email, password: MOCK_PASSWORD })

beforeEach(() => {
  resetMockAuth()
})

afterEach(() => {
  setUnauthenticatedHandler(null)
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('로그인', () => {
  it('맞으면 나를 돌려주고 세션이 선다. 이메일은 대소문자를 가리지 않는다', async () => {
    const me = await login({ email: ' U1@innoflow.local ', password: MOCK_PASSWORD })
    expect(me).toMatchObject({ id: 'u1', systemRole: 'user', projectRoles: { p1: 'admin' } })
    expect(await fetchMe()).toEqual(me)
  })

  it('틀린 비밀번호 · 없는 이메일 · 비활성은 모두 같은 401 이다', async () => {
    const tries = [
      { email: 'u1@innoflow.local', password: 'wrong-password' },
      { email: 'nobody@innoflow.local', password: MOCK_PASSWORD },
      { email: 'u5@innoflow.local', password: MOCK_PASSWORD },
    ]
    for (const t of tries)
      expect(await fail(login(t))).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' })
  })

  it('로그아웃하면 /auth/me 가 401 UNAUTHENTICATED 이고, 세션 끝남을 한 자리로 알린다', async () => {
    const handler = vi.fn()
    setUnauthenticatedHandler(handler)
    await asUser('u2@innoflow.local')
    await logout()
    expect(await fail(fetchMe())).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('로그인 실패는 세션 끝남으로 알리지 않는다', async () => {
    const handler = vi.fn()
    setUnauthenticatedHandler(handler)
    await fail(login({ email: 'x@y.z', password: 'nope-nope-nope' }))
    expect(handler).not.toHaveBeenCalled()
  })

  it('내 비밀번호 바꾸기 — 현재 비밀번호가 틀리면 400, 짧으면 422', async () => {
    await asUser('u2@innoflow.local')
    expect(
      await fail(changePassword({ currentPassword: 'wrong', newPassword: 'new-password-1' })),
    ).toMatchObject({ status: 400, code: 'INVALID_CREDENTIALS' })
    expect(
      await fail(changePassword({ currentPassword: MOCK_PASSWORD, newPassword: 'short' })),
    ).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' })
    await changePassword({ currentPassword: MOCK_PASSWORD, newPassword: 'new-password-1' })
    await logout()
    expect(
      await login({ email: 'u2@innoflow.local', password: 'new-password-1' }),
    ).toMatchObject({ id: 'u2' })
  })
})

describe('사용자 관리', () => {
  it('시스템 관리자가 아니면 403 FORBIDDEN', async () => {
    await asUser('u1@innoflow.local')
    expect(await fail(fetchMemberAccounts())).toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })

  it('비활성 포함 이름 순으로 낸다', async () => {
    await asAdmin()
    const list = await fetchMemberAccounts()
    expect(list.map((a) => a.name)).toEqual(
      [...list.map((a) => a.name)].sort((a, b) => a.localeCompare(b, 'ko')),
    )
    expect(list.find((a) => a.id === 'u5')).toMatchObject({ active: false })
    expect(list.find((a) => a.id === 'u4')).toMatchObject({ hasPassword: false })
  })

  it('등록 — 이메일이 겹치면 409 EMAIL_TAKEN, 등록한 사람은 바로 로그인할 수 있다', async () => {
    await asAdmin()
    expect(
      await fail(
        createMemberAccount({
          name: '새사람',
          email: 'U2@innoflow.local',
          password: 'first-password',
          systemRole: 'user',
        }),
      ),
    ).toMatchObject({ status: 409, code: 'EMAIL_TAKEN' })

    const made = await createMemberAccount({
      name: '최유진',
      email: 'yujin@innoflow.local',
      password: 'first-password',
      systemRole: 'user',
    })
    expect(made).toMatchObject({ active: true, hasPassword: true, lastLoginAt: null })
    await logout()
    expect(
      await login({ email: 'yujin@innoflow.local', password: 'first-password' }),
    ).toMatchObject({
      id: made.id,
      projectRoles: {},
    })
  })

  it('마지막 시스템 관리자는 내리거나 끌 수 없다 — 409 LAST_SYSTEM_ADMIN', async () => {
    await asAdmin()
    expect(await fail(patchMemberAccount('u0', { systemRole: 'user' }))).toMatchObject({
      status: 409,
      code: 'LAST_SYSTEM_ADMIN',
    })
    expect(await fail(patchMemberAccount('u0', { active: false }))).toMatchObject({
      code: 'LAST_SYSTEM_ADMIN',
    })
    /* 관리자가 하나 더 있으면 된다 */
    await patchMemberAccount('u1', { systemRole: 'admin' })
    expect(await patchMemberAccount('u0', { systemRole: 'user' })).toMatchObject({
      systemRole: 'user',
    })
  })

  it('없는 멤버는 404, 이메일 없는 사람에 비밀번호를 걸면 400', async () => {
    await asAdmin()
    expect(await fail(patchMemberAccount('zz', { name: '누구' }))).toMatchObject({
      status: 404,
      code: 'MEMBER_NOT_FOUND',
    })
    expect(await fail(setMemberPassword('u4', 'haneul-password'))).toMatchObject({
      status: 400,
      code: 'MEMBER_EMAIL_REQUIRED',
    })
    await patchMemberAccount('u4', { email: 'haneul@innoflow.local' })
    await setMemberPassword('u4', 'haneul-password')
    expect((await fetchMemberAccounts()).find((a) => a.id === 'u4')!.hasPassword).toBe(true)
    await logout()
    expect(
      await login({ email: 'haneul@innoflow.local', password: 'haneul-password' }),
    ).toMatchObject({ id: 'u4' })
  })

  it('비활성으로 바꾸면 그 사람의 세션이 끊긴다', async () => {
    await asAdmin()
    await patchMemberAccount('u1', { systemRole: 'admin' })
    await logout()
    await asUser('u1@innoflow.local')
    await patchMemberAccount('u1', { active: false })
    expect(await fail(fetchMe())).toMatchObject({ status: 401 })
  })
})

describe('프로젝트 멤버', () => {
  it('그 프로젝트의 일반 사용자도 읽는다. 부여받지 않은 프로젝트는 404', async () => {
    await asUser('u2@innoflow.local')
    expect((await fetchProjectMembers('p1')).length).toBeGreaterThan(0)
    expect(await fail(fetchProjectMembers('p3'))).toMatchObject({
      status: 404,
      code: 'PROJECT_NOT_FOUND',
    })
  })

  it('쓰기는 그 프로젝트 관리자 · 시스템 관리자만 — 일반 사용자는 403', async () => {
    await asUser('u2@innoflow.local')
    expect(await fail(putProjectMember('p1', 'u3', 'admin'))).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    })
  })

  it('프로젝트 관리자가 부여 · 역할 변경 · 빼기를 한다. 비활성 멤버는 400', async () => {
    await asUser('u1@innoflow.local')
    expect(await putProjectMember('p1', 'u0', 'user')).toEqual({ memberId: 'u0', role: 'user' })
    expect(await putProjectMember('p1', 'u2', 'admin')).toEqual({ memberId: 'u2', role: 'admin' })
    expect(await fail(putProjectMember('p1', 'u5', 'user'))).toMatchObject({
      status: 400,
      code: 'MEMBER_INACTIVE',
    })
    expect(await fail(putProjectMember('p1', 'zz', 'user'))).toMatchObject({
      status: 404,
      code: 'MEMBER_NOT_FOUND',
    })
    await deleteProjectMember('p1', 'u3')
    await deleteProjectMember('p1', 'u3')
    expect((await fetchProjectMembers('p1')).some((p) => p.memberId === 'u3')).toBe(false)
    /* 다른 프로젝트에서는 일반 사용자다 */
    expect(await fail(putProjectMember('p2', 'u3', 'admin'))).toMatchObject({ status: 403 })
  })
})
