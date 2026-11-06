import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminRemoveAvatar } from '@/api/admin'
import { login, removeMyAvatar, uploadMyAvatar } from '@/api/auth'
import { resetMockAuth } from '@/api/mockAuth'
import { fetchMembers } from '@/api/projects'
import { MOCK_ADMIN_PASSWORD, MOCK_PASSWORD } from '@/fixtures'

/* 프로필 사진 (docs/api/me.md) — 목업 갈래가 서버처럼 검사하고, 서버 갈래는 계약의 경로 · 본문 그대로 보낸다 */
const fail = (p: Promise<unknown>) => p.then(() => null).catch((e: unknown) => e)
const PHOTO = 'data:image/png;base64,iVBORw0KGgo='

beforeEach(() => {
  resetMockAuth()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('목업 — 내 사진', () => {
  it('올린 data URL 이 나와 멤버 목록의 avatarUrl 이 되고, 지우면 null (없어도 성공)', async () => {
    await login({ email: 'u1@inno-ax.com', password: MOCK_PASSWORD })
    expect((await uploadMyAvatar(PHOTO)).avatarUrl).toBe(PHOTO)
    expect((await fetchMembers()).find((m) => m.id === 'u1')!.avatarUrl).toBe(PHOTO)

    expect((await removeMyAvatar()).avatarUrl).toBeNull()
    expect((await removeMyAvatar()).avatarUrl).toBeNull()
    expect((await fetchMembers()).find((m) => m.id === 'u1')!.avatarUrl).toBeNull()
  })

  it('꼴 · 첫머리가 틀리면 400 AVATAR_INVALID, 로그인 전이면 401', async () => {
    expect(await fail(uploadMyAvatar(PHOTO))).toMatchObject({ status: 401 })
    await login({ email: 'u1@inno-ax.com', password: MOCK_PASSWORD })
    expect(await fail(uploadMyAvatar('data:image/png;base64,/9j/4A=='))).toMatchObject({
      status: 400,
      code: 'AVATAR_INVALID',
      detail: { dataUrl: expect.any(String) },
    })
    expect(await fail(uploadMyAvatar('data:image/gif;base64,R0lGODlh'))).toMatchObject({
      code: 'AVATAR_INVALID',
    })
  })
})

describe('목업 — 관리자가 남의 사진 지우기', () => {
  it('시스템 관리자만, 멱등', async () => {
    await login({ email: 'u1@inno-ax.com', password: MOCK_PASSWORD })
    await uploadMyAvatar(PHOTO)
    expect(await fail(adminRemoveAvatar('u1'))).toMatchObject({ status: 403 })

    await login({ email: 'admin@inno-ax.com', password: MOCK_ADMIN_PASSWORD })
    await adminRemoveAvatar('u1')
    await adminRemoveAvatar('u1')
    expect((await fetchMembers()).find((m) => m.id === 'u1')!.avatarUrl).toBeNull()
    expect(await fail(adminRemoveAvatar('nobody'))).toMatchObject({ status: 404 })
  })
})

describe('서버 갈래', () => {
  const me = {
    id: 'u1',
    name: '김서연',
    email: 'u1@inno-ax.com',
    systemRole: 'user',
    projectRoles: {},
    avatarUrl: '/api/members/u1/avatar?v=1',
  }

  function serve(res: () => Response) {
    const fake = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => res())
    vi.stubGlobal('fetch', fake)
    return fake
  }

  beforeEach(() => {
    vi.stubEnv('VITE_USE_MOCK', 'false')
  })

  it('계약의 경로 · 메서드 · 본문 그대로 보낸다', async () => {
    const json = () =>
      new Response(JSON.stringify(me), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    let fake = serve(json)
    expect(await uploadMyAvatar(PHOTO)).toEqual(me)
    expect(fake.mock.calls[0][0]).toBe('/api/auth/me/avatar')
    expect(fake.mock.calls[0][1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ dataUrl: PHOTO }),
    })

    fake = serve(json)
    await removeMyAvatar()
    expect(fake.mock.calls[0]).toEqual([
      '/api/auth/me/avatar',
      { method: 'DELETE', headers: undefined, body: undefined },
    ])

    fake = serve(() => new Response(null, { status: 204 }))
    await adminRemoveAvatar('u 1')
    expect(fake.mock.calls[0][0]).toBe('/api/admin/members/u%201/avatar')
    expect(fake.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
  })
})
