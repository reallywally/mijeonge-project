// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
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

/* 고치기는 작성자 · 담당자 · 관리자만이다 — 칸이 저장까지 닿는지 보는 검사들이라 프로젝트 관리자(u1)로 들어온다 */
beforeEach(async () => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  resetMockAuth()
  await useAuthStore().login('u1@inno-ax.com', MOCK_PASSWORD)
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

  it('결정의 상세 설명은 여러 줄 칸 — Enter 는 줄바꿈이고 ⌘/Ctrl+Enter 로 남긴다', async () => {
    await mountView('/threads/t3')
    const store = useThreadStore()

    await click(choice('결정'))
    expect(popupText()).toContain('상세 설명')
    expect(popupText()).not.toContain('근거')
    await type('#decision-text', '비식별 데이터만 허용')
    await type('#decision-note', '정보보안팀 회신\n개인정보는 제외')
    const note = document.body.querySelector<HTMLTextAreaElement>('#decision-note')!
    expect(note.tagName).toBe('TEXTAREA')

    note.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    expect(store.threadDetail('t3')!.thread.state).not.toBe('decided')

    note.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))
    await flushPromises()
    expect(store.threadDetail('t3')!.thread.state).toBe('decided')
    expect(store.threadDetail('t3')!.settledNote).toBe('정보보안팀 회신\n개인정보는 제외')
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
  it('실수로 남긴 결정의 글을 [고치기] 로 바로잡는다 — 종류 · 상태는 그대로다', async () => {
    await mountView('/threads/t2')
    const store = useThreadStore()
    const decision = () => store.threadDetail('t2')!.events.find((e) => e.entry.kind === 'decide')!

    await click(document.body.querySelector('button[aria-label="이력 고치기"]')!)
    expect(document.body.querySelector('[data-entry-editor]')).toBeTruthy()

    /* 요약 칸의 Enter 는 저장이 아니다 */
    const text = document.body.querySelector<HTMLInputElement>('input[aria-label="이력 요약"]')!
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    expect(document.body.querySelector('[data-entry-editor]')).toBeTruthy()

    /* 빈 요약은 저장할 수 없다 */
    await type('input[aria-label="이력 요약"]', '  ')
    expect(popupButton('저장')!.hasAttribute('disabled')).toBe(true)

    await type('input[aria-label="이력 요약"]', ' mysql 8.4 를 쓴다 ')
    await type('textarea[aria-label="이력 메모"]', '운영팀 표준')
    await click(popupButton('저장'))

    expect(document.body.querySelector('[data-entry-editor]')).toBeNull()
    expect(decision().entry.text).toBe('mysql 8.4 를 쓴다')
    expect(decision().entry.note).toBe('운영팀 표준')
    expect(store.threadDetail('t2')!.thread.state).toBe('decided')
    expect(popupText()).toContain('mysql 8.4 를 쓴다')
  })

  it('고치다 [취소] 하면 아무것도 바뀌지 않는다', async () => {
    await mountView('/threads/t2')
    const store = useThreadStore()
    const before = store.threadDetail('t2')!.events.map((e) => e.entry.text)

    await click(document.body.querySelector('button[aria-label="이력 고치기"]')!)
    await type('input[aria-label="이력 요약"]', '바꿀 뻔한 글')
    await click(popupButton('취소'))

    expect(store.threadDetail('t2')!.events.map((e) => e.entry.text)).toEqual(before)
  })
})

describe('안건 권한 · 지우기', () => {
  const $ = (selector: string) => document.body.querySelector<HTMLElement>(selector)

  it('작성자 · 담당자 · 관리자가 아니면 읽기 전용 — 지우기 · 이력 줄 고치기 버튼이 없다', async () => {
    /* t1 — 작성자 · 담당자 이도현(u3). 박지훈(u2)은 p1 일반 사용자 */
    await useAuthStore().login('u2@inno-ax.com', MOCK_PASSWORD)
    await mountView('/threads/t1')

    expect($('[data-thread-readonly]')!.textContent).toContain('작성자 · 담당자 · 관리자만')
    expect($('[data-thread-creator]')!.textContent).toBe('이도현')
    expect($('textarea[aria-label="제목"]')!.hasAttribute('readonly')).toBe(true)
    expect($('textarea[aria-label="배경"]')!.hasAttribute('readonly')).toBe(true)
    expect($('textarea[aria-label="후보"]')!.hasAttribute('readonly')).toBe(true)
    expect($('input[aria-label="결정 기한"]')!.hasAttribute('disabled')).toBe(true)
    expect($('[data-cc-add]')).toBeNull()
    expect($('[data-cc-remove]')).toBeNull()
    expect($('[data-thread-delete]')).toBeNull()
    expect($('button[aria-label="이력 고치기"]')).toBeNull()
    expect($('button[aria-label="이력 지우기"]')).toBeNull()

    /* 칸을 지나가도 아무것도 안 바뀐다 */
    await type('textarea[aria-label="제목"]', '바꿔 봄')
    await blur('textarea[aria-label="제목"]')
    expect(useThreadStore().threads.find((t) => t.id === 't1')!.title).toBe('서버 OS 결정')
  })

  it('고칠 수 있으면 작성자 칸 · 지우기 버튼이 서고, 확인하면 지우고 팝업을 닫는다', async () => {
    const { router } = await mountView('/threads/t4')
    expect($('[data-thread-readonly]')).toBeNull()
    /* 담당자가 없던 옛 안건은 작성자도 모른다 */
    expect($('[data-thread-creator]')!.textContent).toBe('—')

    await click($('[data-thread-delete]')!)
    expect(popupText()).toContain("'개발 서버 백업 주기' 안건을 지울까요?")
    /* [취소] 하면 그대로다 */
    await click(popupButton('취소'))
    expect(useThreadStore().threads.some((t) => t.id === 't4')).toBe(true)

    await click($('[data-thread-delete]')!)
    await click($('[data-delete-confirm]')!)
    expect(useThreadStore().threads.some((t) => t.id === 't4')).toBe(false)
    expect(router.currentRoute.value.path).toBe('/threads')
  })

  it('하위 안건이 있으면 버튼이 꺼지고, 그사이 생겨 409 가 오면 확인 창에 이유를 띄운다', async () => {
    const data = useDataStore()
    const child = { ...data.allThreads.find((t) => t.id === 't5')!, parentThreadId: 't4' }
    data.allThreads.push({ ...child, id: 'sub1' })
    await mountView('/threads/t4')
    expect($('[data-thread-delete]')!.hasAttribute('disabled')).toBe(true)
    expect($('[data-delete-reason]')!.textContent).toContain('하위 안건이 있어')

    data.allThreads = data.allThreads.filter((t) => t.id !== 'sub1')
    await flushPromises()
    await click($('[data-thread-delete]')!)
    data.allThreads.push({ ...child, id: 'sub2' })
    await click($('[data-delete-confirm]')!)
    expect($('[data-delete-error]')!.textContent).toContain('하위 안건이 있어 지울 수 없습니다')
    expect(data.allThreads.some((t) => t.id === 't4')).toBe(true)
  })

  it('이력 줄 [지우기] — 확인하면 줄이 빠지고 남은 줄로 상태를 다시 잰다', async () => {
    await mountView('/threads/t1')
    const store = useThreadStore()
    await click($('button[aria-label="이력 지우기"]')!)
    expect(popupText()).toContain('이 결정 줄을 지울까요?')
    await click($('[data-delete-confirm]')!)

    expect(store.threadDetail('t1')!.events).toEqual([])
    expect(store.threadDetail('t1')!.thread.state).toBe('queued')
    expect(popupText()).toContain('아직 남긴 기록이 없습니다')
  })

  it('맨 아래 변경 이력 — 펼치면 등록 · 고친 칸 · 이력 줄 고침이 서고, 펼친 채 고치면 다시 부른다', async () => {
    await mountView('/threads/t2')
    await click($('[data-history-toggle]')!)
    expect($('[data-history-entry="hh-t2-1"]')!.textContent).toContain('등록')

    await type('textarea[aria-label="제목"]', 'DB 선택')
    await blur('textarea[aria-label="제목"]')
    await flushPromises()
    expect($('[data-history-field="title"]')!.textContent).toContain('제목: DB 결정 → DB 선택')

    await click($('button[aria-label="이력 고치기"]')!)
    await type('input[aria-label="이력 요약"]', 'mysql 8.4')
    await click(popupButton('저장'))
    await flushPromises()
    expect($('[data-history-field="entryText"]')!.textContent).toContain(
      '결정 줄 고침: mysql 을 쓴다 → mysql 8.4',
    )
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
