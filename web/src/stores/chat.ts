import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import * as api from '@/api'
import { ApiError, messageOf } from '@/api'
import { toChatMessages } from '@/lib/chat'
import { useDataStore } from '@/stores/data'
import type { ChatLine } from '@/types/domain'

/**
 * 챗봇 대화. 메모리에만 둔다 — 창을 닫거나 프로젝트를 바꾸면 받는 중인 요청을 끊고 비운다 (API.md Q26).
 * 다른 프로젝트의 근거가 섞이지 않게 하려는 것이다.
 */
export const useChatStore = defineStore('chat', () => {
  const data = useDataStore()

  const lines = ref<ChatLine[]>([])
  const receiving = ref(false)
  const lastError = ref<ApiError | null>(null)
  const empty = computed(() => lines.value.length === 0)

  /* 지금 받는 요청. 멈추거나 비운 뒤에 늦게 끝난 옛 요청이 새 대화를 건드리지 않게 이것과 견준다 */
  let controller: AbortController | null = null
  let seq = 0

  const line = (role: ChatLine['role'], text: string, status: ChatLine['status']): ChatLine => {
    seq += 1
    return { id: `c${seq}`, role, text, status, tool: '', error: '' }
  }

  /** 질문을 보내고 답을 받아 그 줄에 이어 붙인다. 받는 중이거나 빈 글이면 안 보낸다 */
  async function ask(text: string): Promise<boolean> {
    const question = text.trim()
    if (!question || receiving.value) return false

    const messages = toChatMessages(lines.value, question)
    lines.value.push(line('user', question, 'done'), line('assistant', '', 'streaming'))
    const answer = lines.value[lines.value.length - 1]

    const mine = new AbortController()
    controller = mine
    receiving.value = true
    lastError.value = null

    try {
      for await (const event of api.streamChat(data.currentProjectId, messages, mine.signal)) {
        if (controller !== mine) return false
        if (event.type === 'delta') {
          answer.text += event.text
          answer.tool = ''
        } else if (event.type === 'tool') {
          answer.tool = event.label
        } else if (event.type === 'done') {
          answer.status = 'done'
          answer.tool = ''
        }
      }
      return true
    } catch (e) {
      /* 멈춤 · 비움은 stop · reset 이 이미 정리했다 */
      if (controller !== mine) return false
      const error =
        e instanceof ApiError ? e : new ApiError(0, { code: 'UNKNOWN', message: messageOf(e) })
      answer.status = 'error'
      answer.tool = ''
      answer.error = error.message
      lastError.value = error
      return false
    } finally {
      if (controller === mine) {
        controller = null
        receiving.value = false
      }
    }
  }

  /** 받는 중인 답을 멈춘다. 받은 데까지는 남기고, 다음 질문에는 싣지 않는다 */
  function stop() {
    if (!controller) return
    controller.abort()
    controller = null
    receiving.value = false
    for (const l of lines.value) {
      if (l.status === 'streaming') {
        l.status = 'stopped'
        l.tool = ''
      }
    }
  }

  /** 실패한 답을 지우고 같은 질문을 다시 보낸다 */
  function retry(lineId: string) {
    const at = lines.value.findIndex((l) => l.id === lineId)
    const question = lines.value[at - 1]
    if (at < 1 || receiving.value || lines.value[at].status !== 'error' || question.role !== 'user')
      return Promise.resolve(false)
    lines.value.splice(at - 1, 2)
    return ask(question.text)
  }

  /** 대화를 끝낸다 — 받는 중이면 끊는다 */
  function reset() {
    controller?.abort()
    controller = null
    receiving.value = false
    lines.value = []
    lastError.value = null
  }

  watch(() => data.currentProjectId, reset)

  return { lines, receiving, lastError, empty, ask, stop, retry, reset }
})
