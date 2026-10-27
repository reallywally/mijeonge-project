import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import * as api from '@/api'
import { ApiError, messageOf } from '@/api'
import { minutesErrorsByTempId, minutesErrorText, toMinutesApplyInput } from '@/lib/minutes'
import { toastError } from '@/lib/notify'
import { useDataStore } from '@/stores/data'
import { useMinutesStore } from '@/stores/minutes'
import type { MinutesApplyResult, MinutesDraft } from '@/types/domain'

/** 쉼 → 정리 중 → 검토. 등록하면 검토를 닫고 쉼으로 돌아간다. 등록 중은 검토 위의 applying 으로 본다 */
export type MinutesDraftPhase = 'idle' | 'drafting' | 'review'

/**
 * 저장된 회의록 하나의 [AI 정리] — 초안 받기 · 고르기 · 고치기 · [등록].
 * 서버가 초안을 들고 있지 않아 여기 메모리에만 둔다 — 다시 정리하면 앞 초안을 버리고,
 * 상세를 떠나거나 프로젝트를 바꾸면 받는 중인 요청을 끊고 비운다 (docs/api/minutes.md '흐름')
 */
export const useMinutesDraftStore = defineStore('minutesDraft', () => {
  const data = useDataStore()
  const board = useMinutesStore()

  /** 지금 정리하는 회의록 */
  const minutesId = ref<string | null>(null)
  const phase = ref<MinutesDraftPhase>('idle')
  /** 정리 중에 띄울 진행 한 줄 — tool.label */
  const tool = ref('')
  /** 정리가 실패한 까닭 한 줄 */
  const error = ref('')
  /** 받은 초안 그대로 — 고친 값은 form 에 */
  const draft = ref<MinutesDraft | null>(null)
  /** 화면에서 고치는 사본 */
  const form = ref<MinutesDraft | null>(null)
  /** tempId → 고름. 기본은 다 켬 */
  const picked = ref<Record<string, boolean>>({})
  const applying = ref(false)
  /** apply 가 짚은 자리 — tempId → 한 줄 */
  const rowErrors = ref<Record<string, string>>({})
  /** 마지막 [등록] 의 결과 — 상세가 '등록했습니다' 한 줄을 띄운다. 다시 정리하면 지운다 */
  const lastResult = ref<MinutesApplyResult | null>(null)

  let controller: AbortController | null = null

  /** 지금 떠나면 잃는 것이 있나 — 받는 중 · 등록 전 초안 */
  const dirty = computed(() => phase.value !== 'idle')

  const pickedCount = computed(() =>
    form.value
      ? [...form.value.threads, ...form.value.entries, ...form.value.tasks].filter(
          (r) => picked.value[r.tempId],
        ).length
      : 0,
  )

  /** 보낼 모양 — 고른 줄만, 빠진 새 안건 연결은 지운다. 요약은 고친 그대로 회의록에 저장된다 */
  const applyInput = computed(() =>
    form.value ? toMinutesApplyInput(form.value, picked.value) : null,
  )

  /** 이 작업에서 빠질 새 안건의 제목들 — 끈 새 안건에 걸려 있던 것 */
  function droppedThreads(taskTempId: string): string[] {
    const task = form.value?.tasks.find((t) => t.tempId === taskTempId)
    if (!task || !form.value) return []
    return task.threadTempIds
      .filter((tempId) => !picked.value[tempId])
      .map((tempId) => form.value!.threads.find((t) => t.tempId === tempId)?.title ?? tempId)
  }

  /** 켠 줄 중 고쳐야 보낼 수 있는 것 — tempId → 한 줄. 서버도 같은 것을 422 로 거절한다 */
  const problems = computed<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    if (!form.value) return out
    for (const t of form.value.threads) {
      if (!picked.value[t.tempId]) continue
      if (!t.title.trim()) out[t.tempId] = '제목을 적어 주세요.'
      else if (t.entry && !t.entry.text.trim()) out[t.tempId] = '이력 내용을 적어 주세요.'
    }
    for (const e of form.value.entries)
      if (picked.value[e.tempId] && !e.text.trim()) out[e.tempId] = '내용을 적어 주세요.'
    for (const t of form.value.tasks) {
      if (!picked.value[t.tempId]) continue
      if (!t.title.trim()) out[t.tempId] = '제목을 적어 주세요.'
      else if (t.start && t.due && t.start > t.due) out[t.tempId] = '기한이 시작 날짜보다 앞섭니다.'
    }
    return out
  })

  const canApply = computed(
    () =>
      phase.value === 'review' &&
      !applying.value &&
      pickedCount.value > 0 &&
      Object.keys(problems.value).length === 0,
  )

  function dropDraft() {
    draft.value = null
    form.value = null
    picked.value = {}
    rowErrors.value = {}
  }

  /** 그 회의록의 저장된 본문으로 초안을 받는다. 앞 초안은 버린다. 받았으면 true */
  async function run(id: string): Promise<boolean> {
    if (phase.value === 'drafting' && minutesId.value === id) return false
    controller?.abort()
    const mine = new AbortController()
    controller = mine
    minutesId.value = id
    dropDraft()
    lastResult.value = null
    error.value = ''
    tool.value = ''
    phase.value = 'drafting'

    let received: MinutesDraft | null = null
    try {
      for await (const event of api.streamMinutesDraft(id, mine.signal)) {
        if (controller !== mine) return false
        if (event.type === 'tool') tool.value = event.label
        else if (event.type === 'draft') received = event.draft
        else if (event.type === 'done' && received) {
          draft.value = received
          form.value = structuredClone(received)
          picked.value = Object.fromEntries(
            [...received.threads, ...received.entries, ...received.tasks].map((r) => [
              r.tempId,
              true,
            ]),
          )
          phase.value = 'review'
        }
      }
      return phase.value === 'review'
    } catch (e) {
      /* 멈춤 · 비움은 stop · reset 이 이미 정리했다 */
      if (controller !== mine || api.isAbort(e)) return false
      const failure =
        e instanceof ApiError ? e : new ApiError(0, { code: 'UNKNOWN', message: messageOf(e) })
      error.value = minutesErrorText(failure)
      phase.value = 'idle'
      return false
    } finally {
      if (controller === mine) {
        controller = null
        tool.value = ''
      }
    }
  }

  /** 정리를 멈춘다 — 스트림을 끊고 아무것도 남기지 않는다 */
  function stop() {
    if (!controller) return
    controller.abort()
    controller = null
    tool.value = ''
    if (phase.value === 'drafting') phase.value = 'idle'
  }

  function setPicked(tempId: string, on: boolean) {
    picked.value[tempId] = on
  }

  /**
   * 고른 줄을 등록하고 데이터 스토어에 넣는다 — 만든 것에는 서버가 출처(minutesId)를 달아 돌려준다.
   * 되면 검토를 닫는다('이 회의록에서 나온 것' 이 는다). 실패하면 알리고, 짚은 자리가 있으면 그 줄에 붙인다
   */
  async function apply(): Promise<boolean> {
    const input = applyInput.value
    const id = minutesId.value
    if (!canApply.value || !input || !id) return false
    const projectId = data.currentProjectId
    applying.value = true
    rowErrors.value = {}
    try {
      const res = await api.applyMinutes(id, input)
      /* 목업에서는 작업 키를 데이터 스토어 한 곳에서 센다 — 작업 추가와 번호가 겹치지 않게 */
      const tasks = data.mock
        ? res.tasks.map((t) => ({ ...t, key: data.takeTaskKey(projectId) }))
        : res.tasks
      const made = { ...res, tasks }
      /* 그사이 프로젝트를 바꿨으면 지금 레코드에 섞지 않는다 — 돌아가면 스냅샷에 있다 */
      if (data.holdsRecordsOf(projectId)) {
        data.allThreads.unshift(...made.threads)
        data.allEntries.push(...made.entries)
        for (const next of made.updatedThreads) {
          const at = data.allThreads.findIndex((t) => t.id === next.id)
          if (at >= 0) data.allThreads[at] = next
        }
        data.allTasks.push(...made.tasks)
        for (const link of made.links)
          if (
            !data.taskThreads.some((l) => l.taskId === link.taskId && l.threadId === link.threadId)
          )
            data.taskThreads.push(link)
      }
      board.afterApply(id, input.summary)
      if (minutesId.value !== id) return true
      lastResult.value = made
      dropDraft()
      phase.value = 'idle'
      return true
    } catch (e) {
      toastError(e)
      if (e instanceof ApiError) rowErrors.value = minutesErrorsByTempId(e.detail, input)
      return false
    } finally {
      applying.value = false
    }
  }

  /** 초안만 버린다 — [그만두기]. 등록 결과 한 줄은 둔다 */
  function discard() {
    controller?.abort()
    controller = null
    tool.value = ''
    error.value = ''
    applying.value = false
    dropDraft()
    phase.value = 'idle'
  }

  /** 처음으로 — 상세를 떠날 때 · 다른 회의록으로 옮길 때 · 로그아웃 */
  function reset() {
    discard()
    minutesId.value = null
    lastResult.value = null
  }

  /* 초안의 안건 · 담당자는 그 프로젝트의 것이다 — 바꾸면 받는 중이면 끊고 초안을 버린다 */
  watch(() => data.currentProjectId, reset)

  return {
    minutesId,
    phase,
    tool,
    error,
    draft,
    form,
    picked,
    applying,
    rowErrors,
    lastResult,
    dirty,
    pickedCount,
    applyInput,
    problems,
    canApply,
    droppedThreads,
    run,
    stop,
    setPicked,
    apply,
    discard,
    reset,
  }
})
