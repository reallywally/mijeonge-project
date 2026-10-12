// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetMockComments } from '@/api/comments'
import { useCommentStore } from '@/stores/comment'
import { useDataStore } from '@/stores/data'
import TaskComments from './TaskComments.vue'

/* 작업 상세의 댓글 칸 — 목록 · 남기기 키 · 자기 댓글만 고치기가 화면에서 스토어까지 닿는지 본다 */
enableAutoUnmount(afterEach)

beforeEach(() => {
  resetMockComments()
  localStorage.clear()
  setActivePinia(createPinia())
})

async function mounted(taskId = 'k4') {
  const w = mount(TaskComments, { props: { taskId }, attachTo: document.body })
  await flushPromises()
  return w
}

const draftOf = (w: Awaited<ReturnType<typeof mounted>>) => w.get('textarea[aria-label="댓글"]')

describe('작업 댓글 칸', () => {
  it('열면 댓글을 받아 작성자 · 수정됨 · 줄바꿈 그대로 보인다', async () => {
    const w = await mounted()
    const items = w.findAll('li[data-comment-id]')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('김서연')
    expect(items[0].get('p').text()).toContain('올려 두었습니다.\n승인까지')
    expect(items[0].get('p').classes()).toContain('whitespace-pre-wrap')
    expect(items[1].text()).toContain('(수정됨)')
    expect(items[0].text()).not.toContain('(수정됨)')
  })

  it("'나'를 안 골랐으면 입력칸이 잠기고 먼저 고르라고 알린다", async () => {
    const w = await mounted()
    expect(draftOf(w).attributes('disabled')).toBeDefined()
    expect(draftOf(w).attributes('placeholder')).toContain('나를 먼저 고르세요')
    expect(w.find('button[aria-label="댓글 고치기"]').exists()).toBe(false)
  })

  it('⌘/Ctrl+Enter 로 남기고, 그냥 Enter 와 한글 조합 중에는 남기지 않는다', async () => {
    useDataStore().setCurrentMember('u2')
    const w = await mounted('k1')
    await draftOf(w).setValue('첫 댓글')

    await draftOf(w).trigger('keydown', { key: 'Enter' })
    await draftOf(w).trigger('keydown', { key: 'Enter', ctrlKey: true, isComposing: true })
    await flushPromises()
    expect(useCommentStore().commentsOf('k1')).toHaveLength(0)

    await draftOf(w).trigger('keydown', { key: 'Enter', metaKey: true })
    await flushPromises()
    expect(
      useCommentStore()
        .commentsOf('k1')
        .map((c) => c.body),
    ).toEqual(['첫 댓글'])
    expect((draftOf(w).element as HTMLTextAreaElement).value).toBe('')
    expect(w.text()).toContain('박지훈')
    expect(useDataStore().allTasks.find((t) => t.id === 'k1')!.commentCount).toBe(1)
  })

  it('자기 댓글에만 고치기 · 지우기가 서고, 고치면 수정됨이 붙는다', async () => {
    useDataStore().setCurrentMember('u1')
    const w = await mounted()
    const [mine, theirs] = w.findAll('li[data-comment-id]')
    expect(theirs.find('button[aria-label="댓글 고치기"]').exists()).toBe(false)

    await mine.get('button[aria-label="댓글 고치기"]').trigger('click')
    const field = w.get('textarea[aria-label="댓글 고치기"]')
    await field.setValue('고친 글')
    await field.trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()

    const first = w.findAll('li[data-comment-id]')[0]
    expect(first.get('p').text()).toBe('고친 글')
    expect(first.text()).toContain('(수정됨)')
  })

  it('지우기는 한 번 더 묻고 지운다', async () => {
    useDataStore().setCurrentMember('u1')
    const w = await mounted()
    await w.get('button[aria-label="댓글 지우기"]').trigger('click')
    expect(w.text()).toContain('지울까요?')

    const confirm = w.findAll('button').find((b) => b.text() === '삭제')!
    await confirm.trigger('click')
    await flushPromises()
    expect(w.findAll('li[data-comment-id]').map((li) => li.attributes('data-comment-id'))).toEqual([
      'cm2',
    ])
    expect(useDataStore().allTasks.find((t) => t.id === 'k4')!.commentCount).toBe(1)
  })
})
