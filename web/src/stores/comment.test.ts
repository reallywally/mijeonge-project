import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteTaskComment, resetMockComments } from '@/api/comments'
import { toastError } from '@/lib/notify'
import { useCommentStore } from '@/stores/comment'
import { useDataStore } from '@/stores/data'

vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

/** 이 브라우저의 기억 — node 에는 localStorage 가 없다 */
function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

beforeEach(() => {
  resetMockComments()
  vi.mocked(toastError).mockClear()
  vi.stubGlobal('localStorage', fakeStorage())
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const countOf = (taskId: string) =>
  useDataStore().allTasks.find((t) => t.id === taskId)!.commentCount

describe("'나'", () => {
  it('처음에는 고르지 않았고, 고르면 기억해 다음에 열어도 그대로다', () => {
    const data = useDataStore()
    expect(data.currentMemberId).toBeNull()
    data.setCurrentMember('u2')
    expect(data.currentMemberId).toBe('u2')

    setActivePinia(createPinia())
    expect(useDataStore().currentMemberId).toBe('u2')
  })

  it('멤버가 아닌 id 는 받지 않고, 기억한 id 가 멤버에서 빠졌으면 고르지 않은 것이다', () => {
    const data = useDataStore()
    data.setCurrentMember('nobody')
    expect(data.currentMemberId).toBeNull()

    data.setCurrentMember('u4')
    data.allMembers = data.allMembers.filter((m) => m.id !== 'u4')
    expect(data.currentMemberId).toBeNull()
  })

  it('localStorage 가 막혀 있어도 돈다', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    setActivePinia(createPinia())
    const data = useDataStore()
    expect(data.currentMemberId).toBeNull()
    data.setCurrentMember('u1')
    expect(data.currentMemberId).toBe('u1')
  })
})

describe('작업 댓글', () => {
  it('불러오면 오래된 것부터 서고, 받은 수로 commentCount 를 맞춘다', async () => {
    const comments = useCommentStore()
    useDataStore().allTasks.find((t) => t.id === 'k4')!.commentCount = 9
    expect(comments.statusOf('k4')).toBe('idle')

    const loading = comments.load('k4')
    expect(comments.statusOf('k4')).toBe('loading')
    await loading

    expect(comments.statusOf('k4')).toBe('ready')
    expect(comments.commentsOf('k4').map((c) => c.id)).toEqual(['cm1', 'cm2'])
    expect(countOf('k4')).toBe(2)
  })

  it("'나'를 안 골랐거나 빈 글이면 남기지 않는다", async () => {
    const comments = useCommentStore()
    await comments.load('k1')
    expect(await comments.add('k1', '글')).toBe(false)

    useDataStore().setCurrentMember('u1')
    expect(await comments.add('k1', '   ')).toBe(false)
    expect(comments.commentsOf('k1')).toEqual([])
    expect(countOf('k1')).toBe(0)
  })

  it("남기면 '나'가 작성자로 맨 뒤에 붙고 commentCount 가 하나 는다", async () => {
    const comments = useCommentStore()
    useDataStore().setCurrentMember('u3')
    await comments.load('k4')

    expect(await comments.add('k4', '  계정 다 만들었습니다\n확인 부탁드립니다 ')).toBe(true)
    const last = comments.commentsOf('k4').at(-1)!
    expect(last).toMatchObject({ authorId: 'u3', body: '계정 다 만들었습니다\n확인 부탁드립니다' })
    expect(countOf('k4')).toBe(3)
  })

  it('자기 댓글만 고치고 지운다. 지우면 commentCount 가 하나 준다', async () => {
    const comments = useCommentStore()
    useDataStore().setCurrentMember('u3')
    await comments.load('k4')
    const [theirs, mine] = comments.commentsOf('k4')

    expect(comments.isMine(theirs)).toBe(false)
    expect(comments.isMine(mine)).toBe(true)
    expect(await comments.edit(theirs.id, '남의 글')).toBe(false)
    expect(await comments.remove(theirs.id)).toBe(false)

    expect(await comments.edit(mine.id, '고쳤습니다')).toBe(true)
    expect(comments.commentsOf('k4')[1]).toMatchObject({ body: '고쳤습니다' })
    expect(comments.commentsOf('k4')[1].editedAt).not.toBeNull()

    expect(await comments.remove(mine.id)).toBe(true)
    expect(comments.commentsOf('k4').map((c) => c.id)).toEqual(['cm1'])
    expect(countOf('k4')).toBe(1)
  })

  it('쓰기가 실패하면 알리고 목록을 다시 받는다', async () => {
    const comments = useCommentStore()
    useDataStore().setCurrentMember('u3')
    await comments.load('k4')
    /* 그사이 다른 곳에서 지워진 것처럼 — 목업 저장소에서만 지운다 */
    await deleteTaskComment('cm2')

    expect(await comments.remove('cm2')).toBe(false)
    expect(toastError).toHaveBeenCalled()
    await vi.waitFor(() => expect(comments.commentsOf('k4').map((c) => c.id)).toEqual(['cm1']))
    expect(countOf('k4')).toBe(1)
  })

  it('프로젝트를 바꾸면 들고 있던 댓글을 비운다', async () => {
    const comments = useCommentStore()
    await comments.load('k4')
    useDataStore().setProject('p2')
    await Promise.resolve()
    expect(comments.commentsOf('k4')).toEqual([])
    expect(comments.statusOf('k4')).toBe('idle')
  })
})
