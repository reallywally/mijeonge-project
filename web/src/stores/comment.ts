import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import * as api from '@/api'
import { messageOf } from '@/api'
import { canDeleteComment, canEditComment } from '@/lib/access'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useTestStore } from '@/stores/test'
import type { TaskComment, TestComment } from '@/types/domain'

export type CommentLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** 댓글 타래 하나의 글 — 작업 댓글 · 테스트 조치 내역이 같은 모양이다(가리키는 칸 이름만 다르다) */
export type ThreadComment = Pick<TaskComment, 'id' | 'authorId' | 'body' | 'createdAt' | 'editedAt'>

/** 타래가 붙는 대상마다 다른 것 — 부를 api · 지우기 경계의 프로젝트 · 대상 줄의 commentCount */
interface CommentTarget<C extends ThreadComment> {
  fetch: (targetId: string) => Promise<C[]>
  create: (targetId: string, body: string) => Promise<C>
  patch: (commentId: string, body: string) => Promise<C>
  remove: (commentId: string) => Promise<void>
  projectIdOf: (targetId: string) => string
  countOf: (targetId: string) => number | null
  setCount: (targetId: string, count: number) => void
}

/**
 * 댓글 타래 스토어를 만든다. 본문은 스냅샷에 없어 상세를 열 때 받는다 — 스냅샷 · 목록에는 수(commentCount)만 있다.
 * 쓰기는 서버가 id · 시각을 정하므로 응답을 기다렸다가 넣고, 그때 그 대상의 commentCount 도 맞춘다.
 */
function commentStoreOf<C extends ThreadComment>(target: () => CommentTarget<C>) {
  return () => {
    const auth = useAuthStore()
    const data = useDataStore()
    const t = target()

    const byTarget = ref<Record<string, C[]>>({})
    const status = ref<Record<string, CommentLoadStatus>>({})
    const loadError = ref<Record<string, string>>({})

    const commentsOf = (targetId: string): C[] => (byTarget.value[targetId] as C[]) ?? []
    const statusOf = (targetId: string): CommentLoadStatus => status.value[targetId] ?? 'idle'
    const errorOf = (targetId: string) => loadError.value[targetId] ?? ''

    /** 고치기는 작성자만 */
    const canEdit = (comment: ThreadComment) => canEditComment(auth.me, comment)

    /** 지우기는 작성자 · 그 대상이 든 프로젝트의 관리자 · 시스템 관리자 */
    const canRemove = (comment: ThreadComment) => {
      const found = locate(comment.id)
      const projectId = found ? t.projectIdOf(found.targetId) : data.currentProjectId
      return canDeleteComment(auth.me, comment, projectId)
    }

    const setCount = (targetId: string, count: number) => t.setCount(targetId, Math.max(0, count))

    /* 같은 대상을 빨리 다시 열면 늦게 온 옛 목록이 새 목록을 덮지 않게 마지막 요청만 받는다 */
    const latestLoad = new Map<string, number>()
    let ticket = 0

    async function load(targetId: string) {
      ticket += 1
      const mine = ticket
      latestLoad.set(targetId, mine)
      status.value[targetId] = 'loading'
      try {
        const rows = await t.fetch(targetId)
        if (latestLoad.get(targetId) !== mine) return
        byTarget.value[targetId] = rows
        status.value[targetId] = 'ready'
        delete loadError.value[targetId]
        /* 다른 사람이 그사이 남긴 것까지 받은 수가 진짜다 */
        setCount(targetId, rows.length)
      } catch (e) {
        if (latestLoad.get(targetId) !== mine) return
        status.value[targetId] = 'error'
        loadError.value[targetId] = messageOf(e)
      }
    }

    /** 남긴다 — 작성자는 로그인한 사람이다. 빈 글이면 안 보낸다. 실패하면 알리고 false — 적던 글은 화면이 지킨다 */
    async function add(targetId: string, body: string): Promise<boolean> {
      const text = body.trim()
      if (!auth.me || !text) return false
      try {
        const comment = await t.create(targetId, text)
        ;((byTarget.value[targetId] ??= []) as C[]).push(comment)
        setCount(targetId, (t.countOf(targetId) ?? 0) + 1)
        return true
      } catch (e) {
        toastError(e)
        return false
      }
    }

    function locate(commentId: string) {
      for (const [targetId, rows] of Object.entries(byTarget.value) as [string, C[]][]) {
        const at = rows.findIndex((c) => c.id === commentId)
        if (at >= 0) return { targetId, rows, at }
      }
      return null
    }

    async function edit(commentId: string, body: string): Promise<boolean> {
      const found = locate(commentId)
      const text = body.trim()
      if (!found || !text || !canEdit(found.rows[found.at])) return false
      try {
        const next = await t.patch(commentId, text)
        const now = locate(commentId)
        if (now) now.rows[now.at] = next
        return true
      } catch (e) {
        toastError(e)
        /* 이미 지워졌을 수도 있다 — 서버 목록으로 다시 선다 */
        void load(found.targetId)
        return false
      }
    }

    async function remove(commentId: string): Promise<boolean> {
      const found = locate(commentId)
      if (!found || !canRemove(found.rows[found.at])) return false
      try {
        await t.remove(commentId)
        const now = locate(commentId)
        if (now) {
          now.rows.splice(now.at, 1)
          setCount(now.targetId, (t.countOf(now.targetId) ?? 1) - 1)
        }
        return true
      } catch (e) {
        toastError(e)
        void load(found.targetId)
        return false
      }
    }

    function clear() {
      byTarget.value = {}
      status.value = {}
      loadError.value = {}
      latestLoad.clear()
    }

    /* 다른 프로젝트의 글을 들고 있을 까닭이 없다 */
    watch(() => data.currentProjectId, clear)

    return { commentsOf, statusOf, errorOf, canEdit, canRemove, load, add, edit, remove, clear }
  }
}

/** 작업 댓글 — 작업 상세의 맨 아래 */
export const useCommentStore = defineStore(
  'comment',
  commentStoreOf<TaskComment>(() => {
    const data = useDataStore()
    const taskOf = (taskId: string) => data.allTasks.find((t) => t.id === taskId)
    return {
      fetch: (taskId) => api.fetchTaskComments(taskId),
      create: (taskId, body) => api.createTaskComment(taskId, { body }),
      patch: (commentId, body) => api.patchTaskComment(commentId, { body }),
      remove: (commentId) => api.deleteTaskComment(commentId),
      projectIdOf: (taskId) => taskOf(taskId)?.projectId ?? data.currentProjectId,
      countOf: (taskId) => taskOf(taskId)?.commentCount ?? null,
      setCount: (taskId, count) => {
        const task = taskOf(taskId)
        if (task) task.commentCount = count
      },
    }
  }),
)

/** 테스트 조치 내역 (docs/api/test-comment.md) — 테스트 상세의 테스트 데이터 아래. 규칙은 작업 댓글과 같다 */
export const useTestCommentStore = defineStore(
  'testComment',
  commentStoreOf<TestComment>(() => {
    const data = useDataStore()
    const tests = useTestStore()
    return {
      fetch: (testId) => api.fetchTestComments(testId),
      create: (testId, body) => api.createTestComment(testId, { body }),
      patch: (commentId, body) => api.patchTestComment(commentId, { body }),
      remove: (commentId) => api.deleteTestComment(commentId),
      projectIdOf: (testId) => tests.byId[testId]?.projectId ?? data.currentProjectId,
      countOf: (testId) => tests.byId[testId]?.commentCount ?? null,
      setCount: (testId, count) => {
        const test = tests.byId[testId]
        if (test) test.commentCount = count
      },
    }
  }),
)
