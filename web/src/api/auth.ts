import { mockError, request } from '@/api/client'
import {
  accountOf,
  later,
  memberOf,
  meOf,
  mockDb,
  requireMe,
  writeMockSession,
} from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { avatarProblem } from '@/lib/avatar'
import { nowIso } from '@/lib/date'
import { normalizeEmail, passwordProblem } from '@/lib/member'
import type { AvatarInput, LoginInput, Me, PasswordChangeInput } from '@/types/domain'

/* 목업 갈래 — 로그인 실패는 이유를 가르지 않는다(없는 이메일 · 틀린 비밀번호 · 비활성 · 비밀번호 없음) */
const invalid = () => mockError(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 맞지 않습니다.')

const mock = {
  login(input: LoginInput): Me {
    const email = normalizeEmail(input.email)
    const account = mockDb().accounts.find((a) => a.email === email)
    if (!account || account.password === null || account.password !== input.password)
      throw invalid()
    const me = meOf(account.memberId)
    if (!me) throw invalid()
    account.lastLoginAt = nowIso()
    writeMockSession(me.id)
    return me
  },
  logout() {
    writeMockSession(null)
  },
  changePassword(input: PasswordChangeInput) {
    const me = requireMe()
    const account = accountOf(me.id)!
    if (account.password !== input.currentPassword)
      throw mockError(400, 'INVALID_CREDENTIALS', '현재 비밀번호가 맞지 않습니다.')
    const problem = passwordProblem(input.newPassword)
    if (problem)
      throw mockError(422, 'VALIDATION_ERROR', '입력값이 올바르지 않습니다.', {
        newPassword: problem,
      })
    /* 서버는 이 세션 말고 내 다른 세션을 끊는다 — 목업에는 이 세션뿐이라 끊을 것이 없다 */
    account.password = input.newPassword
  },
  /* 목업은 올린 data URL 을 그대로 주소로 쓴다 (docs/api/me.md '시드 · 목업') */
  putAvatar(input: AvatarInput): Me {
    const me = requireMe()
    const problem = avatarProblem(input.dataUrl)
    if (problem === 'AVATAR_INVALID')
      throw mockError(400, problem, '사진을 읽을 수 없습니다.', {
        dataUrl: 'png · jpeg · webp 이미지의 data URL 이 아닙니다.',
      })
    if (problem === 'AVATAR_TOO_LARGE')
      throw mockError(400, problem, '사진이 너무 큽니다. 512KB 까지 올릴 수 있습니다.')
    memberOf(me.id)!.avatarUrl = input.dataUrl
    return requireMe()
  },
  deleteAvatar(): Me {
    const me = requireMe()
    memberOf(me.id)!.avatarUrl = null
    return requireMe()
  },
}

/** 맞으면 세션 쿠키가 구워지고 나를 돌려받는다 */
export const login = (input: LoginInput) =>
  isMockMode() ? later(() => mock.login(input)) : request<Me>('POST', '/auth/login', input)

/** 멱등 — 세션이 없어도 204 */
export const logout = () =>
  isMockMode() ? later(() => mock.logout()) : request<void>('POST', '/auth/logout')

/** 부팅 때 맨 먼저 부른다. 로그인 전이면 401 UNAUTHENTICATED */
export const fetchMe = () =>
  isMockMode() ? later(() => requireMe()) : request<Me>('GET', '/auth/me')

export const changePassword = (input: PasswordChangeInput) =>
  isMockMode()
    ? later(() => mock.changePassword(input))
    : request<void>('POST', '/auth/password', input)

/** 내 사진 걸기 · 바꾸기 — 화면이 256×256 으로 줄인 data URL. 돌려받은 나의 avatarUrl 이 새 주소다 */
export const uploadMyAvatar = (dataUrl: string) =>
  isMockMode()
    ? later(() => mock.putAvatar({ dataUrl }))
    : request<Me>('PUT', '/auth/me/avatar', { dataUrl } satisfies AvatarInput)

/** 내 사진 지우기 — 없어도 성공 */
export const removeMyAvatar = () =>
  isMockMode() ? later(() => mock.deleteAvatar()) : request<Me>('DELETE', '/auth/me/avatar')
