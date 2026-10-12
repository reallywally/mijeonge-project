import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import * as api from '@/api'
import { ApiError, messageOf } from '@/api'
import { chatErrorText, toChatMessages } from '@/lib/chat'
import { useDataStore } from '@/stores/data'
import { useTaskStore } from '@/stores/task'
import type { ChatLine, TaskProposal } from '@/types/domain'

/**
 * 챗봇 대화. 메모리에만 둔다 — 창을 닫거나 프로젝트를 바꾸면 받는 중인 요청을 끊고 비운다 (API.md Q26).
 * 다른 프로젝트의 근거가 섞이지 않게 하려는 것이다.
 */
export const useChatStore = defineStore('chat', () => {
  const data = useDataStore()
  const taskStore = useTaskStore()

  const lines = ref<ChatLine[]>([])
  const receiving = ref(false)
  const lastError = ref<ApiError | null>(null)
  const empty = computed(() => lines.value.length === 0)
  /** 등록 중인 초안이 달린 답 줄. 그동안은 새 질문을 막는다 — 대기 중으로 실어 보낸 초안이 등록되는 일이 없게 */
  const registering = ref<string | null>(null)

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
    if (!question || receiving.value || registering.value) return false

    const messages = toChatMessages(lines.value, question)
    lines.value.push(line('user', question, 'done'), line('assistant', '', 'streaming'))
    const answer = lines.value[lines.value.length - 1]

    const mine = new AbortController()
    controller = mine
    receiving.value = true
    lastError.value = null

    /* 초안은 done 에서 붙인다 — 실패 · 멈춘 답은 다음 질문에 안 실려 서버가 그 초안의 결과를 모르게 된다 */
    let proposal: TaskProposal | null = null

    try {
      for await (const event of api.streamChat(data.currentProjectId, messages, mine.signal)) {
        if (controller !== mine) return false
        if (event.type === 'delta') {
          answer.text += event.text
          answer.tool = ''
        } else if (event.type === 'tool') {
          answer.tool = event.label
        } else if (event.type === 'proposal') {
          proposal = event.proposal
        } else if (event.type === 'done') {
          if (proposal) {
            /* 대기 중인 카드는 늘 하나다 — 고쳐 달라고 해서 새 초안이 왔으면 앞의 것은 접는다 */
            for (const l of lines.value)
              if (l.proposal?.status === 'pending') l.proposal.status = 'cancelled'
            answer.proposal = { ...proposal, status: 'pending' }
          }
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
      answer.error = chatErrorText(error)
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

  const pendingOf = (lineId: string) => {
    const p = lines.value.find((l) => l.id === lineId)?.proposal
    return p?.status === 'pending' ? p : null
  }

  /**
   * 초안을 등록한다. 같은 카드가 두 번 등록되지 않게 누르는 동안 막는다.
   * 실패하면 알림이 뜨고 카드는 대기 중으로 남아 다시 누를 수 있다.
   */
  async function register(lineId: string): Promise<boolean> {
    const proposal = pendingOf(lineId)
    if (!proposal || registering.value) return false
    registering.value = lineId
    try {
      const result = await taskStore.addTaskBatch(proposal.tasks)
      if (!result) return false
      const keyById = Object.fromEntries(result.tasks.map((t) => [t.id, t.key]))
      proposal.keyByTempId = Object.fromEntries(
        Object.entries(result.taskIdByTempId).map(([tempId, taskId]) => [tempId, keyById[taskId]]),
      )
      proposal.status = 'registered'
      return true
    } finally {
      if (registering.value === lineId) registering.value = null
    }
  }

  /** 초안을 접는다. 다음 질문에 cancelled 로 실려 챗봇도 안다 */
  function cancelProposal(lineId: string) {
    const proposal = pendingOf(lineId)
    if (proposal && registering.value !== lineId) proposal.status = 'cancelled'
  }

  /** 대화를 끝낸다 — 받는 중이면 끊는다. 등록 중인 요청은 서버에서 끝까지 가므로 끊지 않는다 */
  function reset() {
    controller?.abort()
    controller = null
    receiving.value = false
    registering.value = null
    lines.value = []
    lastError.value = null
  }

  watch(() => data.currentProjectId, reset)

  return {
    lines,
    receiving,
    registering,
    lastError,
    empty,
    ask,
    stop,
    retry,
    reset,
    register,
    cancelProposal,
  }
})
