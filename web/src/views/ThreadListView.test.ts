// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'
import { useThreadStore } from '@/stores/thread'
import ThreadListView from './ThreadListView.vue'

/* 안건 상세 · 추가가 화면에서 실제로 저장까지 닿는지 본다. 팝업은 teleport 로 body 에 나간다. */
async function mountView(path = '/threads') {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/threads', name: 'threads', component: ThreadListView },
      { path: '/threads/new', name: 'thread-new', component: ThreadListView },
      { path: '/threads/:id', name: 'thread', component: ThreadListView },
      { path: '/:rest(.*)', component: ThreadListView },
    ],
  })
  router.push(path)
  await router.isReady()
  const w = mount(ThreadListView, { global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}

const popupText = () => document.body.textContent ?? ''
const popupButton = (text: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

const choice = (label: string) =>
  [...document.body.querySelectorAll('[role="radio"]')].find((b) =>
    b.textContent?.trim().startsWith(label),
  )

async function click(el: Element | undefined) {
  expect(el, '누를 것을 못 찾았다').toBeTruthy()
  ;(el as HTMLElement).click()
  await flushPromises()
}

async function type(selector: string, value: string) {
  const el = document.body.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  expect(el, `${selector} 를 못 찾았다`).toBeTruthy()
  el!.value = value
  el!.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function blur(selector: string) {
  document.body.querySelector<HTMLElement>(selector)!.dispatchEvent(new FocusEvent('blur'))
  await flushPromises()
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})

describe('안건 목록 화면', () => {
  it("'마지막 기록' 열에 마지막 Entry 의 날짜가 선다", async () => {
    const { w } = await mountView()
    expect(w.text()).toContain('마지막 기록')
    expect(w.text()).not.toContain('마지막 회의')
  })
})

describe('안건 상세', () => {
  it('결정 전 안건은 결정 · 미루기를 먼저 고르고, 고른 쪽 칸만 보인다', async () => {
    await mountView('/threads/t3')

    expect(document.body.querySelector('#decision-text')).toBeNull()

    await click(choice('결정'))
    expect(document.body.querySelector('#decision-note')).toBeTruthy()
    expect(document.body.querySelector('#decision-next-due')).toBeNull()
    expect(popupButton('비식별 데이터만 허용')).toBeTruthy()

    await click(choice('미루기'))
    expect(document.body.querySelector('#decision-note')).toBeNull()
    expect(document.body.querySelector('#decision-next-due')).toBeTruthy()
    expect(popupButton('비식별 데이터만 허용')).toBeFalsy()

    await click(popupButton('취소'))
    expect(document.body.querySelector('#decision-text')).toBeNull()
  })

  it('결정 전 안건에서 후보를 눌러 결정으로 남기면 결정됨이 되고 맨 위에 선다', async () => {
    await mountView('/threads/t3')
    const store = useThreadStore()

    await click(choice('결정'))
    await click(popupButton('비식별 데이터만 허용'))
    expect(document.body.querySelector<HTMLInputElement>('#decision-text')!.value).toBe(
      '비식별 데이터만 허용',
    )
    await type('#decision-note', '정보보안팀 회신')
    await click(popupButton('결정으로 남기기'))

    const detail = store.threadDetail('t3')!
    expect(detail.thread.state).toBe('decided')
    expect(detail.current).toBe('비식별 데이터만 허용')
    expect(detail.settledNote).toBe('정보보안팀 회신')
    expect(popupText()).toContain('결정 바꾸기')
  })

  it('미루기는 사유를 받아 미룸 줄을 남긴다', async () => {
    await mountView('/threads/t3')
    const store = useThreadStore()

    await click(choice('미루기'))
    await type('#decision-text', '보안팀 회신을 기다린다')
    await click(popupButton('미루기로 남기기'))

    expect(store.threadDetail('t3')!.deferCount).toBe(2)
    expect(store.threadDetail('t3')!.thread.state).toBe('open')
    // 다시 볼 날을 안 고르면 결정 기한은 그대로다
    expect(store.threadDetail('t3')!.thread.dueDate).toBe('2026-09-30')
  })

  it('미룰 때 다시 볼 날을 고르면 결정 기한도 그날로 옮긴다', async () => {
    await mountView('/threads/t3')
    const store = useThreadStore()

    await click(choice('미루기'))
    await type('#decision-text', '보안팀 회신을 기다린다')
    const due = document.body.querySelector<HTMLInputElement>('#decision-next-due')!
    due.value = '2026-10-20'
    due.dispatchEvent(new Event('change'))
    await flushPromises()
    await click(popupButton('미루기로 남기기'))

    expect(store.threadDetail('t3')!.thread.dueDate).toBe('2026-10-20')
  })

  it('결정 바꾸기는 새 결정 줄을 남기고 앞의 결정은 이력에 남는다', async () => {
    await mountView('/threads/t2')
    const store = useThreadStore()

    await click(popupButton('결정 바꾸기'))
    await type('#decision-text', 'PostgreSQL 로 바꾼다')
    await click(popupButton('결정으로 남기기'))

    const detail = store.threadDetail('t2')!
    expect(detail.current).toBe('PostgreSQL 로 바꾼다')
    expect(detail.events.find((e) => e.superseded)?.entry.text).toBe('mysql 을 쓴다')
    expect(popupText()).toContain('뒤의 결정으로 바뀜')
  })

  it('제목 · 후보를 고치고 벗어나면 바로 저장되고, 빈 제목은 되돌아간다', async () => {
    await mountView('/threads/t3')
    const store = useThreadStore()
    const t3 = () => store.threads.find((t) => t.id === 't3')!

    await type('textarea[aria-label="제목"]', '외부 모델 호출 범위')
    await blur('textarea[aria-label="제목"]')
    expect(t3().title).toBe('외부 모델 호출 범위')

    await type('textarea[aria-label="제목"]', '  ')
    await blur('textarea[aria-label="제목"]')
    expect(t3().title).toBe('외부 모델 호출 범위')
    expect(
      document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="제목"]')!.value,
    ).toBe('외부 모델 호출 범위')

    await type('textarea[aria-label="후보"]', ' 전면 허용 \n\n사내 모델만 사용\n')
    await blur('textarea[aria-label="후보"]')
    expect(t3().options).toEqual(['전면 허용', '사내 모델만 사용'])
  })
})

describe('안건 추가', () => {
  it('/threads/new 로 열리고, 만들면 그 안건의 상세로 간다', async () => {
    const { router } = await mountView('/threads/new')
    const store = useThreadStore()
    expect(popupText()).toContain('안건 추가')
    expect(popupButton('만들기')!.hasAttribute('disabled')).toBe(true)

    await type('textarea[aria-label="제목"]', '배포 창구 정하기')
    await type('textarea[aria-label="후보"]', '운영팀\n\n개발팀')
    await click(popupButton('만들기'))

    const made = store.threads.find((t) => t.title === '배포 창구 정하기')!
    expect(made.options).toEqual(['운영팀', '개발팀'])
    expect(made.state).toBe('queued')
    expect(router.currentRoute.value.path).toBe(`/threads/${made.id}`)
  })
})
