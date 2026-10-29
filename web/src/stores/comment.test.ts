import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteTaskComment, resetMockComments } from '@/api/comments'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_ADMIN_PASSWORD, MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useCommentStore } from '@/stores/comment'
import { useDataStore } from '@/stores/data'

vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

beforeEach(() => {
  resetMockComments()
  resetMockAuth()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 목업 계정으로 로그인한다 — 작성자 · 권한은 로그인한 사람으로 정해진다 */
const signIn = (email: string) =>
  useAuthStore().login(email, email.startsWith('admin@') ? MOCK_ADMIN_PASSWORD : MOCK_PASSWORD)

const countOf = (taskId: string) =>
  useDataStore().allTasks.find((t) => t.id === taskId)!.commentCount

describe("'나'", () => {
  it('로그인한 사람이 나다 — 머리글에서 고르지 않는다', async () => {
    const data = useDataStore()
    expect(data.currentMemberId).toBeNull()
    await signIn('u2@inno-ax.com')
    expect(data.currentMemberId).toBe('u2')
  })

  it('로그아웃하면 나도 댓글도 비운다', async () => {
    await signIn('u3@inno-ax.com')
    const comments = useCommentStore()
    await comments.load('k4')
    await useAuthStore().logout()
    expect(useDataStore().currentMemberId).toBeNull()
    expect(comments.commentsOf('k4')).toEqual([])
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

  it('로그인 전이거나 빈 글이면 남기지 않는다', async () => {
    const comments = useCommentStore()
    await comments.load('k1')
    expect(await comments.add('k1', '글')).toBe(false)

    await signIn('u1@inno-ax.com')
    expect(await comments.add('k1', '   ')).toBe(false)
    expect(comments.commentsOf('k1')).toEqual([])
    expect(countOf('k1')).toBe(0)
  })

  it("남기면 '나'가 작성자로 맨 뒤에 붙고 commentCount 가 하나 는다", async () => {
    const comments = useCommentStore()
    await signIn('u3@inno-ax.com')
    await comments.load('k4')

    expect(await comments.add('k4', '  계정 다 만들었습니다\n확인 부탁드립니다 ')).toBe(true)
    const last = comments.commentsOf('k4').at(-1)!
    expect(last).toMatchObject({ authorId: 'u3', body: '계정 다 만들었습니다\n확인 부탁드립니다' })
    expect(countOf('k4')).toBe(3)
  })

  it('일반 사용자는 자기 댓글만 고치고 지운다. 지우면 commentCount 가 하나 준다', async () => {
    const comments = useCommentStore()
    await signIn('u3@inno-ax.com')
    await comments.load('k4')
    const [theirs, mine] = comments.commentsOf('k4')

    expect(comments.canEdit(theirs)).toBe(false)
    expect(comments.canRemove(theirs)).toBe(false)
    expect(comments.canEdit(mine)).toBe(true)
    expect(await comments.edit(theirs.id, '남의 글')).toBe(false)
    expect(await comments.remove(theirs.id)).toBe(false)

    expect(await comments.edit(mine.id, '고쳤습니다')).toBe(true)
    expect(comments.commentsOf('k4')[1]).toMatchObject({ body: '고쳤습니다' })
    expect(comments.commentsOf('k4')[1].editedAt).not.toBeNull()

    expect(await comments.remove(mine.id)).toBe(true)
    expect(comments.commentsOf('k4').map((c) => c.id)).toEqual(['cm1'])
    expect(countOf('k4')).toBe(1)
  })

  it('프로젝트 관리자 · 시스템 관리자는 남의 댓글을 지울 수 있지만 고칠 수는 없다', async () => {
    const comments = useCommentStore()
    /* 김서연은 한화손보 차세대(p1)의 프로젝트 관리자다. cm2 는 이도현의 글 */
    await signIn('u1@inno-ax.com')
    await comments.load('k4')
    const theirs = comments.commentsOf('k4')[1]
    expect(comments.canEdit(theirs)).toBe(false)
    expect(comments.canRemove(theirs)).toBe(true)
    expect(await comments.edit(theirs.id, '남의 글')).toBe(false)
    expect(await comments.remove(theirs.id)).toBe(true)

    await useAuthStore().logout()
    await signIn('admin@inno-ax.com')
    await comments.load('k4')
    const first = comments.commentsOf('k4')[0]
    expect(comments.canEdit(first)).toBe(false)
    expect(comments.canRemove(first)).toBe(true)
  })

  it('쓰기가 실패하면 알리고 목록을 다시 받는다', async () => {
    const comments = useCommentStore()
    await signIn('u3@inno-ax.com')
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
