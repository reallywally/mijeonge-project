import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import * as api from '@/api'
import { messageOf } from '@/api'
import { toastError } from '@/lib/notify'
import { useDataStore } from '@/stores/data'
import type { TaskComment } from '@/types/domain'

export type CommentLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * 작업 댓글. 본문은 스냅샷에 없어 작업 상세를 열 때 받는다 — 스냅샷에는 수(Task.commentCount)만 있다.
 * 쓰기는 서버가 id · 시각을 정하므로 응답을 기다렸다가 넣고, 그때 그 작업의 commentCount 도 맞춘다.
 */
export const useCommentStore = defineStore('comment', () => {
  const data = useDataStore()

  const byTask = ref<Record<string, TaskComment[]>>({})
  const status = ref<Record<string, CommentLoadStatus>>({})
  const loadError = ref<Record<string, string>>({})

  const commentsOf = (taskId: string) => byTask.value[taskId] ?? []
  const statusOf = (taskId: string): CommentLoadStatus => status.value[taskId] ?? 'idle'
  const errorOf = (taskId: string) => loadError.value[taskId] ?? ''

  /** 자기 댓글만 고치고 지운다. '나'를 안 골랐으면 아무것도 못 고친다 */
  const isMine = (comment: TaskComment) =>
    data.currentMemberId !== null && comment.authorId === data.currentMemberId

  function setCount(taskId: string, count: number) {
    const task = data.allTasks.find((t) => t.id === taskId)
    if (task) task.commentCount = Math.max(0, count)
  }

  /* 같은 작업을 빨리 다시 열면 늦게 온 옛 목록이 새 목록을 덮지 않게 마지막 요청만 받는다 */
  const latestLoad = new Map<string, number>()
  let ticket = 0

  async function load(taskId: string) {
    ticket += 1
    const mine = ticket
    latestLoad.set(taskId, mine)
    status.value[taskId] = 'loading'
    try {
      const rows = await api.fetchTaskComments(taskId)
      if (latestLoad.get(taskId) !== mine) return
      byTask.value[taskId] = rows
      status.value[taskId] = 'ready'
      delete loadError.value[taskId]
      /* 다른 사람이 그사이 남긴 것까지 받은 수가 진짜다 */
      setCount(taskId, rows.length)
    } catch (e) {
      if (latestLoad.get(taskId) !== mine) return
      status.value[taskId] = 'error'
      loadError.value[taskId] = messageOf(e)
    }
  }

  /** 댓글을 남긴다. '나'를 안 골랐거나 빈 글이면 안 보낸다. 실패하면 알리고 false — 적던 글은 화면이 지킨다 */
  async function add(taskId: string, body: string): Promise<boolean> {
    const authorId = data.currentMemberId
    const text = body.trim()
    if (!authorId || !text) return false
    try {
      const comment = await api.createTaskComment(taskId, { authorId, body: text })
      ;(byTask.value[taskId] ??= []).push(comment)
      const task = data.allTasks.find((t) => t.id === taskId)
      setCount(taskId, (task?.commentCount ?? 0) + 1)
      return true
    } catch (e) {
      toastError(e)
      return false
    }
  }

  function locate(commentId: string) {
    for (const [taskId, rows] of Object.entries(byTask.value)) {
      const at = rows.findIndex((c) => c.id === commentId)
      if (at >= 0) return { taskId, rows, at }
    }
    return null
  }

  async function edit(commentId: string, body: string): Promise<boolean> {
    const found = locate(commentId)
    const text = body.trim()
    if (!found || !text || !isMine(found.rows[found.at])) return false
    try {
      const next = await api.patchTaskComment(commentId, { body: text })
      const now = locate(commentId)
      if (now) now.rows[now.at] = next
      return true
    } catch (e) {
      toastError(e)
      /* 이미 지워졌을 수도 있다 — 서버 목록으로 다시 선다 */
      void load(found.taskId)
      return false
    }
  }

  async function remove(commentId: string): Promise<boolean> {
    const found = locate(commentId)
    if (!found || !isMine(found.rows[found.at])) return false
    try {
      await api.deleteTaskComment(commentId)
      const now = locate(commentId)
      if (now) {
        now.rows.splice(now.at, 1)
        const task = data.allTasks.find((t) => t.id === now.taskId)
        setCount(now.taskId, (task?.commentCount ?? 1) - 1)
      }
      return true
    } catch (e) {
      toastError(e)
      void load(found.taskId)
      return false
    }
  }

  /* 다른 프로젝트의 댓글을 들고 있을 까닭이 없다 */
  watch(
    () => data.currentProjectId,
    () => {
      byTask.value = {}
      status.value = {}
      loadError.value = {}
      latestLoad.clear()
    },
  )

  return { commentsOf, statusOf, errorOf, isMine, load, add, edit, remove }
})
