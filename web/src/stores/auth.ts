import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as api from '@/api'
import { ApiError } from '@/api'
import { isSystemAdmin } from '@/lib/access'
import { clearSession } from '@/stores/session'
import type { Me, ProjectRole } from '@/types/domain'

/**
 * 로그인한 사람. '나' 는 서버가 세션으로 정한다 — 화면이 고르지 않는다 (docs/api/auth.md).
 * 권한 판단은 lib/access 의 순수 함수에 me 를 넘겨서 한다.
 */
export const useAuthStore = defineStore('auth', () => {
  const me = ref<Me | null>(null)
  const systemAdmin = computed(() => isSystemAdmin(me.value))

  /** 세션이 살아 있으면 나, 아니면 null. 401 말고의 실패(서버에 못 붙음 등)는 던진다 */
  async function loadMe(): Promise<Me | null> {
    try {
      me.value = await api.fetchMe()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        me.value = null
        return null
      }
      throw e
    }
    return me.value
  }

  /** 틀리면 ApiError 를 던진다 — 로그인 화면이 그 message 를 그대로 띄운다 */
  async function login(email: string, password: string): Promise<Me> {
    me.value = await api.login({ email, password })
    return me.value
  }

  /** 다른 사람이 같은 브라우저로 들어올 수 있다 — 서버 응답과 상관없이 들고 있던 것을 다 비운다 */
  async function logout() {
    try {
      await api.logout()
    } catch {
      /* 세션이 이미 끝났거나 서버가 없어도 화면은 비운다 */
    }
    clearSession()
  }

  /** 틀리면 ApiError 를 던진다 */
  async function changePassword(currentPassword: string, newPassword: string) {
    await api.changePassword({ currentPassword, newPassword })
  }

  /** 프로젝트 멤버 화면에서 나의 역할을 바꾸거나 나를 뺐을 때 — 메뉴가 그 자리에서 맞춰진다 */
  function setProjectRole(projectId: string, role: ProjectRole | null) {
    if (!me.value) return
    const next = { ...me.value.projectRoles }
    if (role === null) delete next[projectId]
    else next[projectId] = role
    me.value = { ...me.value, projectRoles: next }
  }

  /** 사용자 관리에서 내 이름을 고쳤을 때 */
  function rename(name: string) {
    if (me.value) me.value = { ...me.value, name }
  }

  function clear() {
    me.value = null
  }

  return { me, systemAdmin, loadMe, login, logout, changePassword, setProjectRole, rename, clear }
})
