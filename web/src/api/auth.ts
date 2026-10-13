import { mockError, request } from '@/api/client'
import { accountOf, later, meOf, mockDb, requireMe, writeMockSession } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { nowIso } from '@/lib/date'
import { normalizeEmail, passwordProblem } from '@/lib/member'
import type { LoginInput, Me, PasswordChangeInput } from '@/types/domain'

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
