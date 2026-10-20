// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { resetMockAuth, writeMockSession } from '@/api/mockAuth'
import { resetMockMinutes } from '@/api/minutes'
import { MINUTES_EXAMPLE, MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useMinutesDraftStore } from '@/stores/minutesDraft'
import MinutesDetailView from './MinutesDetailView.vue'
import MinutesEditView from './MinutesEditView.vue'
import MinutesView from './MinutesView.vue'

/* 회의록 화면 — 게시판 목록 · 쓰기 · 고치기 · 지우기 권한 · 상세에서 AI 정리 → 등록 → 나온 것 칩 · '회의록에서' 칩 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

const Blank = defineComponent({ template: '<div />' })

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/minutes', component: MinutesView },
      { path: '/minutes/new', component: MinutesEditView },
      { path: '/minutes/:minutesId/edit', component: MinutesEditView },
      { path: '/minutes/:minutesId', component: MinutesDetailView },
      { path: '/:rest(.*)', component: Blank },
    ],
  })
}

async function mountAt(path: string) {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()
  const w = mount(
    { template: '<RouterView />' },
    { global: { plugins: [router] }, attachTo: document.body },
  )
  await flushPromises()
  return { w, router }
}

const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const $$ = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)]

async function click(el: Element | undefined | null) {
  expect(el, '누를 것을 못 찾았다').toBeTruthy()
  ;(el as HTMLElement).click()
  await flushPromises()
}

async function type(sel: string, value: string) {
  const el = $(sel) as HTMLInputElement | HTMLTextAreaElement
  expect(el, `${sel} 칸을 못 찾았다`).toBeTruthy()
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}

const checkbox = (tempId: string) => $(`[data-minutes-row="${tempId}"] [role="checkbox"]`)

/** m1 상세 → [AI 정리] → 초안까지 */
async function drafted() {
  const page = await mountAt('/minutes/m1')
  await click($('[data-minutes-run]'))
  await vi.runAllTimersAsync()
  await flushPromises()
  return page
}

/** 목업 저장소는 두고 사람만 바꾼다 */
async function switchTo(memberId: string) {
  writeMockSession(memberId)
  await useAuthStore().loadMe()
}

enableAutoUnmount(afterEach)

beforeEach(async () => {
  resetMockAuth()
  resetMockMinutes()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  await useAuthStore().login('u1@innoflow.local', MOCK_PASSWORD)
  await useDataStore().retry()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('목록', () => {
  it('회의 날짜 · 제목 · 작성자 · 나온 것 수 — 제목으로 거르고, 누르면 상세', async () => {
    const { router } = await mountAt('/minutes')
    const row = $('[data-minutes-item="m1"]')!
    expect(row.textContent).toContain('10월 16일')
    expect(row.textContent).toContain('10월 셋째 주 주간 회의')
    expect(row.textContent).toContain('김서연')
    expect($('[data-minutes-item="m1"] [data-minutes-made]')!.textContent?.trim()).toBe('0')

    await type('[data-minutes-search]', '없는 말')
    ;($('[data-minutes-search]') as HTMLInputElement).dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Enter' }),
    )
    await flushPromises()
    expect($$('[data-minutes-item]')).toEqual([])
    expect(document.body.textContent).toContain('조회 조건에 맞는 회의록이 없습니다.')

    await type('[data-minutes-search]', '셋째 주')
    ;($('[data-minutes-search]') as HTMLInputElement).dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Enter' }),
    )
    await flushPromises()
    await click($('[data-minutes-item="m1"]'))
    expect(router.currentRoute.value.path).toBe('/minutes/m1')
  })
})

describe('쓰기 · 고치기', () => {
  it('[새 회의록] → [예시 넣기] · 제목 · 날짜 → [저장] 하면 그 상세로', async () => {
    const { router } = await mountAt('/minutes')
    await click($('[data-minutes-new]'))
    expect(router.currentRoute.value.path).toBe('/minutes/new')
    expect($('[data-minutes-save]')!.hasAttribute('disabled')).toBe(true)
    expect($('[data-minutes-count]')!.textContent).toContain('0 / 60,000')

    await click($('[data-minutes-example]'))
    expect(($('[data-minutes-text]') as HTMLTextAreaElement).value).toBe(MINUTES_EXAMPLE)
    expect($('[data-minutes-count]')!.textContent).toContain(
      `${MINUTES_EXAMPLE.trim().length.toLocaleString('ko-KR')} / 60,000`,
    )
    /* 제목이 비면 저장 못 한다 */
    expect($('[data-minutes-save]')!.hasAttribute('disabled')).toBe(true)
    await type('[data-minutes-title]', '10월 넷째 주 주간 회의')
    await type('[data-minutes-date-input]', '2026-10-23')

    const ask = vi.spyOn(window, 'confirm')
    await click($('[data-minutes-save]'))
    await flushPromises()
    expect(ask).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toMatch(/^\/minutes\/mm\d+$/)
    expect($('[data-minutes-heading]')!.textContent).toContain('10월 넷째 주 주간 회의')
    expect($('[data-minutes-meta]')!.textContent).toContain('10월 23일 회의')
  })

  it('.txt · .md 가 아닌 파일은 열지 않는다', async () => {
    await mountAt('/minutes/new')
    const input = $('[data-minutes-file]') as HTMLInputElement
    Object.defineProperty(input, 'files', {
      value: [new File(['내용'], 'minutes.docx')],
      configurable: true,
    })
    input.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(document.body.textContent).toContain('.txt · .md 파일만 열 수 있습니다.')

    Object.defineProperty(input, 'files', {
      value: [new File(['# 회의\n- 정함'], '주간회의.md')],
      configurable: true,
    })
    input.dispatchEvent(new Event('change'))
    await vi.waitFor(() =>
      expect(($('[data-minutes-text]') as HTMLTextAreaElement).value).toBe('# 회의\n- 정함'),
    )
  })

  it('쓰다 나가면 묻는다 — 아니오면 머문다', async () => {
    const { router } = await mountAt('/minutes/new')
    await type('[data-minutes-title]', '쓰다 만 것')
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    await router.push('/minutes')
    expect(ask).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.path).toBe('/minutes/new')
    ask.mockReturnValueOnce(true)
    await router.push('/minutes')
    expect(router.currentRoute.value.path).toBe('/minutes')
  })

  it('작성자는 [고치기] 로 고쳐 저장한다', async () => {
    const { router } = await mountAt('/minutes/m1')
    await click($('[data-minutes-edit]'))
    expect(router.currentRoute.value.path).toBe('/minutes/m1/edit')
    expect(($('[data-minutes-title]') as HTMLInputElement).value).toBe('10월 셋째 주 주간 회의')
    await type('[data-minutes-title]', '10월 셋째 주 주간 회의(고침)')
    await click($('[data-minutes-save]'))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/minutes/m1')
    expect($('[data-minutes-heading]')!.textContent).toContain('(고침)')
  })

  it('작성자가 아니면 [고치기] 가 없고, 고치기 주소로 와도 막는다', async () => {
    await switchTo('u2')
    const { w } = await mountAt('/minutes/m1')
    expect($('[data-minutes-heading]')).toBeTruthy()
    expect($('[data-minutes-edit]')).toBeNull()
    expect($('[data-minutes-remove]')).toBeNull()
    /* AI 정리는 멤버 누구나 */
    expect($('[data-minutes-run]')).toBeTruthy()

    w.unmount()
    await mountAt('/minutes/m1/edit')
    expect($('[data-minutes-load-error]')!.textContent).toContain('쓴 사람만 고칠 수 있습니다')
    expect($('[data-minutes-save]')).toBeNull()
  })
})

describe('상세 — AI 정리 → 등록 → 나온 것', () => {
  it('본문은 줄바꿈을 살려 그대로, 처음엔 "아직 정리하지 않았어요" 와 [AI 정리]', async () => {
    await mountAt('/minutes/m1')
    expect($('[data-minutes-body]')!.textContent).toContain('2. 사내망 외부 모델 호출 허용 범위')
    expect($('[data-minutes-body]')!.className).toContain('whitespace-pre-wrap')
    expect($('[data-minutes-made-empty]')!.textContent).toContain('아직 정리하지 않았어요')
    expect($('[data-minutes-run]')!.textContent).toContain('AI 정리')
    expect($('[data-minutes-saved-summary]')).toBeNull()
  })

  it('정리 중에는 진행 한 줄과 [멈추기] — 멈추면 아무것도 남지 않는다', async () => {
    await mountAt('/minutes/m1')
    await click($('[data-minutes-run]'))
    expect($('[data-minutes-progress]')!.textContent).toContain('회의록을 읽는 중')
    await vi.advanceTimersByTimeAsync(130)
    expect($('[data-minutes-progress]')!.textContent).toContain('기존 안건 찾는 중')

    await click($('[data-minutes-stop]'))
    await vi.runAllTimersAsync()
    await flushPromises()
    expect($('[data-minutes-progress]')).toBeNull()
    expect($$('[data-minutes-row]')).toEqual([])
  })

  it('검토 — 요약 · 회의 날짜 · 세 묶음 · 근거, ownerHint 는 담당 칸에', async () => {
    await drafted()
    expect(($('[data-minutes-summary]') as HTMLTextAreaElement).value).toContain(
      '외부 모델 호출 허용 범위',
    )
    expect($('[data-minutes-date]')!.textContent).toContain('10월 16일')
    expect($$('[data-minutes-row]').map((r) => r.dataset.minutesRow)).toEqual([
      'n1',
      'n2',
      'e1',
      't1',
      't2',
      't3',
    ])
    expect($$('[data-minutes-quote]')).toHaveLength(6)
    expect($('[data-minutes-row="e1"] [data-minutes-thread="t3"]')!.textContent).toContain(
      '사내망에서 외부 모델 호출 허용 범위',
    )
    expect($('[data-minutes-row="t3"] [data-owner-hint]')!.textContent).toContain(
      '회의록: 최 선임 — 골라 주세요',
    )
    expect($('[data-minutes-apply]')!.textContent).toContain('등록 6건')
  })

  it('새 안건을 끄면 "안건 연결이 빠집니다", 등록하면 검토가 닫히고 나온 것 칩 · 요약이 는다', async () => {
    await drafted()
    await click(checkbox('n1'))
    expect($('[data-minutes-row="t1"] [data-minutes-dropped]')!.textContent).toContain(
      '안건 연결이 빠집니다 — 가상비서 대화 로그 보관 기간',
    )
    await click(checkbox('t3'))
    expect($('[data-minutes-apply]')!.textContent).toContain('등록 4건')

    await click($('[data-minutes-apply]'))
    expect($$('[data-minutes-row]')).toEqual([])
    expect($('[data-minutes-apply]')).toBeNull()
    expect($('[data-minutes-result]')!.textContent).toContain(
      '새 안건 1 · 이력 1 · 작업 2건을 등록했습니다',
    )
    expect($('[data-minutes-made-empty]')).toBeNull()
    expect($$('[data-made-thread]').map((b) => b.textContent)).toEqual([
      expect.stringContaining('기간계 테스트 데이터 마스킹 범위'),
    ])
    /* 이력 — 새 안건의 미룸 · t3 의 미룸 */
    expect($$('[data-made-entry]')).toHaveLength(2)
    expect($$('[data-made-task]').map((b) => b.textContent?.trim())).toEqual([
      'HW-23가상비서 대화 로그 현황 조사',
      'HW-24운영 DB 계정 · 권한 표 작성',
    ])
    expect($('[data-minutes-run]')!.textContent).toContain('다시 정리')
    expect($('[data-minutes-saved-summary]')!.textContent).toContain('외부 모델 호출 허용 범위')
  })

  it('나온 작업 칩을 누르면 작업 상세 — "회의록에서" 칩이 그 회의록을 가리킨다', async () => {
    const { router } = await drafted()
    await click($('[data-minutes-apply]'))
    await click($('[data-made-task]'))
    const dialog = $('[role="dialog"]')!
    expect(dialog.textContent).toContain('가상비서 대화 로그 현황 조사')
    const source = dialog.querySelector<HTMLAnchorElement>('[data-minutes-source="m1"]')!
    expect(source.textContent).toContain('회의록에서')
    expect(source.textContent).toContain('10월 셋째 주 주간 회의')
    expect(source.getAttribute('href')).toBe('/minutes/m1')
    expect(router.currentRoute.value.path).toBe('/minutes/m1')
  })

  it('나온 이력 칩을 누르면 안건 상세 — 그 이력 줄에 "회의록에서" 칩', async () => {
    await drafted()
    await click($('[data-minutes-apply]'))
    const t3 = $$('[data-made-entry]').find((b) => b.textContent?.includes('외부 모델'))
    await click(t3)
    const dialog = $('[role="dialog"]')!
    expect(dialog.querySelectorAll('[data-minutes-source="m1"]')).toHaveLength(1)
  })

  it('검토 중에 떠나면 묻는다 — 등록을 끝냈으면 묻지 않는다', async () => {
    const { router } = await drafted()
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    await router.push('/minutes')
    expect(ask).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.path).toBe('/minutes/m1')

    await click($('[data-minutes-apply]'))
    await router.push('/minutes')
    expect(ask).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.path).toBe('/minutes')
    expect(useMinutesDraftStore().minutesId).toBeNull()
  })
})

describe('지우기', () => {
  it('"여기서 나온 N건은 남습니다" 를 묻고 지운다 — 나온 것은 남고 출처만 빈다', async () => {
    const { router } = await drafted()
    await click($('[data-minutes-apply]'))
    const data = useDataStore()
    const made = data.allTasks.filter((t) => t.minutesId === 'm1').map((t) => t.id)
    expect(made).toHaveLength(3)

    await click($('[data-minutes-remove]'))
    expect($('[data-minutes-remove-note]')!.textContent).toContain('여기서 나온 7건은 남습니다')
    await click($('[data-minutes-remove-confirm]'))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/minutes')
    expect($$('[data-minutes-item]')).toEqual([])
    expect(made.map((id) => data.allTasks.find((t) => t.id === id)!.minutesId)).toEqual([
      null,
      null,
      null,
    ])
    expect(
      [...data.allThreads, ...data.allEntries, ...data.allTasks].some((r) => r.minutesId === 'm1'),
    ).toBe(false)
  })

  it('프로젝트 관리자 · 시스템 관리자는 남의 회의록을 지울 수 있지만 고칠 수는 없다', async () => {
    await switchTo('u0')
    await mountAt('/minutes/m1')
    expect($('[data-minutes-remove]')).toBeTruthy()
    expect($('[data-minutes-edit]')).toBeNull()
  })
})
