<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'
import MemberAvatar from '@/components/app/MemberAvatar.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { matchMember } from '@/lib/member'
import { cn } from '@/lib/utils'
import { useDataStore } from '@/stores/data'

/* 사람을 찾아 고르는 칸 — 담당자(OwnerSelect) · 참조(CcField) 가 같이 쓴다. 트리거는 #trigger 슬롯으로 부모가 그린다.
   열면 맨 위 '이름으로 찾기' 칸에 포커스가 가고, ↑ ↓ 로 옮기고 Enter 로 고르고 Esc 로 닫는다.
   후보는 고른 프로젝트의 활성 멤버(data.assignable)에서 exclude 를 뺀 것.
   allowNone 이면 맨 위에 '미정' 줄 — 고르면 null 을 올린다.
   keepOpen 이면 고른 뒤에도 닫지 않고 찾는 말만 비운다 — 참조처럼 여럿을 잇달아 고를 때.
   목록은 Portal 로 body 에 띄운다 — 다이얼로그 안에서 잘리지 않게. 나머지 속성(data-*)은 트리거 버튼에 붙는다 */
defineOptions({ inheritAttrs: false })
const props = defineProps<{
  /** 트리거 버튼의 aria-label */
  label: string
  /** 지금 고른 사람 — 목록에 표시하고, 열 때 그 줄에 선다 */
  selectedId?: string | null
  exclude?: string[]
  allowNone?: boolean
  keepOpen?: boolean
  disabled?: boolean
  triggerClass?: string
  /** 참조의 '+ 참조' 처럼 화살표 없는 트리거 */
  hideChevron?: boolean
}>()
const emit = defineEmits<{ (e: 'pick', id: string | null): void }>()
defineSlots<{ trigger(): unknown }>()

const data = useDataStore()
const open = ref(false)
const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)

const NONE_LABEL = '미정 (담당자 없음)'

type Row = { id: string | null; name: string; avatarUrl: string | null }
const rows = computed<Row[]>(() => {
  const q = query.value.trim()
  const members = data.assignable
    .filter((m) => !props.exclude?.includes(m.id))
    .filter((m) => matchMember(m, q))
    .map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl }))
  const none = props.allowNone && (!q || NONE_LABEL.includes(q))
  return none ? [{ id: null, name: NONE_LABEL, avatarUrl: null }, ...members] : members
})

function onOpen(v: boolean) {
  open.value = v
  if (!v) return
  query.value = ''
  const at = rows.value.findIndex((r) => r.id === (props.selectedId ?? null))
  active.value = Math.max(at, 0)
}

/* 기본 자동 포커스 대신 찾는 칸에 바로 — 첫 줄의 버튼이 아니라 */
function focusInput(e: Event) {
  e.preventDefault()
  void nextTick(() => input.value?.focus())
}

function pick(row: Row | undefined) {
  if (!row) return
  emit('pick', row.id)
  if (props.keepOpen) {
    query.value = ''
    active.value = 0
    input.value?.focus()
  } else open.value = false
}

function move(by: number) {
  if (rows.value.length === 0) return
  active.value = Math.min(Math.max(active.value + by, 0), rows.value.length - 1)
  void nextTick(() =>
    list.value
      ?.querySelector<HTMLElement>(`[data-member-row="${active.value}"]`)
      ?.scrollIntoView?.({
        block: 'nearest',
      }),
  )
}

function onKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    pick(rows.value[active.value])
  }
}

/* v-model 은 한글 조합이 끝나야 값을 올린다 — 치는 대로 거르도록 input 을 직접 받는다 */
function onInput(e: Event) {
  query.value = (e.target as HTMLInputElement).value
  active.value = 0
}
</script>

<template>
  <Popover :open="open" @update:open="onOpen">
    <PopoverTrigger as-child :disabled="disabled">
      <button
        v-bind="$attrs"
        type="button"
        :aria-label="label"
        :disabled="disabled"
        :class="
          cn(
            'flex h-8 w-full items-center justify-between gap-1.5 rounded-md border border-input bg-card px-2.5 py-1 text-start text-[13px] whitespace-nowrap shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-[border-color,box-shadow] hover:border-[color-mix(in_oklab,var(--input),black_8%)] focus:border-ring focus:ring-[3px] focus:ring-ring/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate',
            triggerClass,
          )
        "
      >
        <slot name="trigger" />
        <ChevronDown v-if="!hideChevron" class="size-3.5 shrink-0 text-muted-foreground" />
      </button>
    </PopoverTrigger>
    <PopoverContent
      align="start"
      class="w-(--reka-popover-trigger-width) min-w-56 p-0"
      data-member-picker
      @open-auto-focus="focusInput"
    >
      <div class="border-b border-border p-1.5">
        <input
          ref="input"
          :value="query"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          :aria-label="`${label} 찾기`"
          placeholder="이름으로 찾기"
          class="h-7 w-full rounded-sm bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground"
          @input="onInput"
          @keydown="onKeydown"
        />
      </div>
      <ul ref="list" role="listbox" class="max-h-64 overflow-y-auto p-1">
        <li
          v-for="(row, i) in rows"
          :key="row.id ?? 'none'"
          role="option"
          :aria-selected="i === active"
          :data-member-row="i"
          :data-member-choice="row.id ?? 'none'"
          class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs"
          :class="[
            i === active ? 'bg-accent text-accent-foreground' : '',
            row.id === null ? 'text-muted-foreground' : '',
          ]"
          @mouseenter="active = i"
          @mousedown.prevent
          @click="pick(row)"
        >
          <MemberAvatar :name="row.id === null ? null : row.name" :src="row.avatarUrl" :size="18" />
          <span class="min-w-0 grow truncate">{{ row.name }}</span>
          <Check
            v-if="!keepOpen && row.id === (selectedId ?? null)"
            class="size-3.5 shrink-0 text-muted-foreground"
          />
        </li>
        <li
          v-if="rows.length === 0"
          class="px-2 py-1.5 text-xs text-muted-foreground"
          data-member-empty
        >
          찾는 사람이 없습니다
        </li>
      </ul>
    </PopoverContent>
  </Popover>
</template>
