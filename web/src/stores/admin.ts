import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as api from '@/api'
import { messageOf } from '@/api'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import type { MemberAccount, MemberAccountInput, MemberAccountPatch } from '@/types/domain'

/**
 * 사용자 관리 — 시스템 관리자의 화면만 쓴다. 들어올 때 받고, 쓰기는 응답을 기다렸다가 넣는다.
 * 이름 · 활성이 바뀌면 data 스토어의 멤버 목록도 맞춘다 — 담당자 이름 · 고르는 자리가 그것을 본다.
 */
export const useAdminStore = defineStore('admin', () => {
  const data = useDataStore()
  const auth = useAuthStore()

  const accounts = ref<MemberAccount[]>([])
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const loadError = ref('')

  async function load() {
    status.value = 'loading'
    try {
      accounts.value = await api.fetchMemberAccounts()
      status.value = 'ready'
      loadError.value = ''
    } catch (e) {
      status.value = 'error'
      loadError.value = messageOf(e)
    }
  }

  function sync(account: MemberAccount) {
    const at = accounts.value.findIndex((a) => a.id === account.id)
    if (at >= 0) accounts.value[at] = account
    else accounts.value.push(account)
    accounts.value.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    data.upsertMember({ id: account.id, name: account.name, active: account.active })
    if (account.id === auth.me?.id) auth.rename(account.name)
  }

  /** 실패하면 서버의 message 를 알리고 null — 적던 칸은 다이얼로그가 지킨다 */
  async function create(input: MemberAccountInput): Promise<MemberAccount | null> {
    try {
      const account = await api.createMemberAccount(input)
      sync(account)
      return account
    } catch (e) {
      toastError(e)
      return null
    }
  }

  async function update(memberId: string, patch: MemberAccountPatch): Promise<boolean> {
    try {
      sync(await api.patchMemberAccount(memberId, patch))
      return true
    } catch (e) {
      toastError(e)
      return false
    }
  }

  async function setPassword(memberId: string, password: string): Promise<boolean> {
    try {
      await api.setMemberPassword(memberId, password)
      const account = accounts.value.find((a) => a.id === memberId)
      if (account) account.hasPassword = true
      return true
    } catch (e) {
      toastError(e)
      return false
    }
  }

  function clear() {
    accounts.value = []
    status.value = 'idle'
    loadError.value = ''
  }

  return { accounts, status, loadError, load, create, update, setPassword, clear }
})
