<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Search, X } from 'lucide-vue-next'
import type { ParentChoice } from '@/types/domain'

/* 상위 작업 고르기 — 평소엔 지금 상위를 글처럼 보이고, 누르면 찾기 칸이 열린다.
   작업 번호(HW-4)나 경로(개발 환경 설정 › DB 설치)의 낱말로 찾는다. 낱말은 모두 들어가야 한다.
   ↑ ↓ 로 옮기고 Enter 로 고르며, Esc · 바깥 누르기는 고르지 않고 닫는다.
   테스트의 상위 테스트도 같은 칸이다 — noun 만 바꾼다.
   고르면 4단을 넘는 작업(disabledReason)은 목록에 두되 흐리게 이유를 적고 고르지 못하게 한다 */
const props = withDefaults(
  defineProps<{
    choices: ParentChoice[]
    /** 무엇의 상위인가 — 작업 · 테스트 */
    noun?: string
  }>(),
  { noun: '작업' },
)
const parentId = defineModel<string | null>({ required: true })

const LIMIT = 50

/* 받침에 따라 이 · 가 — 작업이 · 테스트가 */
const nounSubject = computed(() => {
  const code = props.noun.charCodeAt(props.noun.length - 1) - 0xac00
  return `${props.noun}${code >= 0 && code % 28 !== 0 ? '이' : '가'}`
})

const editing = ref(false)
const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)

const current = computed(() => props.choices.find((c) => c.id === parentId.value) ?? null)

/* 맨 위 '없음' 은 찾는 말이 없을 때만 — 고르면 최상위 작업이 된다 */
type Row = { id: string | null; key: string; label: string; disabledReason?: string }
const noneRow = computed<Row>(() => ({ id: null, key: '', label: `없음 (최상위 ${props.noun})` }))

const words = computed(() => query.value.trim().toLowerCase().split(/\s+/).filter(Boolean))
const found = computed(() =>
  props.choices.filter((c) => {
    const hay = `${c.key} ${c.label}`.toLowerCase()
    return words.value.every((w) => hay.includes(w))
  }),
)
const matches = computed<Row[]>(() => [
  ...(words.value.length ? [] : [noneRow.value]),
  ...found.value.slice(0, LIMIT),
])
const hiddenCount = computed(() => Math.max(found.value.length - LIMIT, 0))

/* ↑ ↓ 는 막힌 줄을 건너뛴다. 갈 곳이 없으면 그 자리 */
function step(from: number, by: 1 | -1) {
  for (let i = from + by; i >= 0 && i < matches.value.length; i += by)
    if (!matches.value[i]!.disabledReason) return i
  return from
}
const firstEnabled = () => Math.max(step(-1, 1), 0)

async function open() {
  editing.value = true
  query.value = ''
  active.value = firstEnabled()
  await nextTick()
  input.value?.focus()
}

function close() {
  editing.value = false
  query.value = ''
}

function pick(row: Row | undefined) {
  if (!row || row.disabledReason) return
  if (row.id !== parentId.value) parentId.value = row.id
  close()
}

function onKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    active.value = step(active.value, 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = step(active.value, -1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    pick(matches.value[active.value])
  } else if (e.key === 'Escape') {
    /* 찾기 칸만 닫고 팝업은 그대로 둔다 */
    e.stopPropagation()
    e.preventDefault()
    close()
  }
}
</script>

<template>
  <div class="relative">
    <div v-if="!editing" class="flex items-center">
      <button
        type="button"
        :aria-label="`상위 ${noun}`"
        class="flex h-8 min-w-0 grow items-center gap-1.5 rounded-md px-2 text-left text-xs hover:bg-accent"
        @click="open"
      >
        <template v-if="current">
          <span class="shrink-0 text-muted-foreground">{{ current.key }}</span>
          <span class="truncate" :title="current.label">{{ current.label }}</span>
        </template>
        <span v-else class="text-muted-foreground">없음 (최상위)</span>
      </button>
      <button
        v-if="current"
        type="button"
        :aria-label="`상위 ${noun} 빼기`"
        :title="`상위 ${noun} 빼기 — 최상위 ${nounSubject} 됩니다`"
        class="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        @click="parentId = null"
      >
        <X class="size-3.5" />
      </button>
    </div>

    <template v-else>
      <div
        class="flex h-8 items-center gap-2 rounded-md border border-input bg-background px-2.5 shadow-sm focus-within:ring-1 focus-within:ring-ring"
      >
        <Search class="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref="input"
          v-model="query"
          type="text"
          role="combobox"
          aria-expanded="true"
          :aria-label="`상위 ${noun} 찾기`"
          :placeholder="`${noun} 번호나 제목으로 찾기`"
          class="min-w-0 grow bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          @input="active = firstEnabled()"
          @blur="close"
          @keydown="onKeydown"
        />
      </div>
      <ul
        role="listbox"
        class="absolute inset-x-0 top-[calc(100%+4px)] z-50 flex max-h-72 flex-col overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
      >
        <li
          v-for="(row, i) in matches"
          :key="row.id ?? 'none'"
          role="option"
          :aria-selected="i === active"
          :aria-disabled="row.disabledReason ? 'true' : undefined"
          :title="row.disabledReason"
          class="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs"
          :class="[
            row.disabledReason ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer',
            i === active && !row.disabledReason ? 'bg-accent text-accent-foreground' : '',
            row.id === parentId ? 'font-medium' : '',
          ]"
          @mouseenter="!row.disabledReason && (active = i)"
          @mousedown.prevent="pick(row)"
        >
          <span v-if="row.key" class="shrink-0 text-muted-foreground">{{ row.key }}</span>
          <span class="min-w-0 grow truncate" :title="row.label">{{ row.label }}</span>
          <span v-if="row.disabledReason" class="shrink-0 text-muted-foreground">{{
            row.disabledReason
          }}</span>
        </li>
        <li v-if="matches.length === 0" class="px-2 py-1.5 text-xs text-muted-foreground">
          '{{ query.trim() }}' 이 들어간 {{ nounSubject }} 없습니다
        </li>
        <li v-if="hiddenCount > 0" class="px-2 py-1.5 text-xs text-muted-foreground">
          {{ hiddenCount }}건 더 있습니다 — 더 좁혀 찾아 주세요
        </li>
      </ul>
    </template>
  </div>
</template>
