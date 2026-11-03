<script setup lang="ts" generic="T">
import { computed, ref } from 'vue'
import { Plus, Search } from 'lucide-vue-next'

/* 검색해서 고르기 — 적은 말이 들어간 것만 아래로 펼치고, 고르면 올린 뒤 칸을 비운다.
   ↑ ↓ 로 옮기고 Enter 로 고른다. 무엇으로 찾는지는 부모가 `text` 로 준다(제목 · 날짜 · 사람 …).
   한 줄의 모양은 #item 슬롯으로 부모가 그린다.
   createLabel 을 주면 적은 말로 새로 만드는 줄이 맨 아래에 선다 — 고르면 'create' 로 그 말을 올린다. */
const props = defineProps<{
  items: T[]
  text: (item: T) => string
  /** 줄마다 다른 값 — v-for 의 key */
  keyOf: (item: T) => string
  placeholder: string
  /** 고를 것이 하나도 없을 때 */
  emptyLabel: string
  /** 새로 만드는 줄의 말 — 적은 말을 받아 그린다. 없으면 고르기만 한다 */
  createLabel?: (query: string) => string
}>()
const emit = defineEmits<{ (e: 'pick', item: T): void; (e: 'create', query: string): void }>()
defineSlots<{ item(props: { item: T }): unknown }>()

const query = ref('')
const opened = ref(false)
const active = ref(0)

/* 새로 만드는 줄 — 적은 말이 있을 때만. 자리는 matches 다음(active === matches.length) */
const creating = computed(() =>
  props.createLabel && query.value.trim() ? props.createLabel(query.value.trim()) : null,
)
const rowCount = computed(() => matches.value.length + (creating.value ? 1 : 0))
/* 고를 것이 없어도 만들 수는 있으면 칸을 연다 */
const usable = computed(() => props.items.length > 0 || props.createLabel !== undefined)

const LIMIT = 8
const matches = computed(() => {
  const words = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return props.items
    .filter((item) => {
      const hay = props.text(item).toLowerCase()
      return words.every((w) => hay.includes(w))
    })
    .slice(0, LIMIT)
})

function pick(item: T | undefined) {
  if (!item) return
  emit('pick', item)
  query.value = ''
  active.value = 0
}

function create() {
  const text = query.value.trim()
  if (!text) return
  emit('create', text)
  query.value = ''
  active.value = 0
}

function choose() {
  if (creating.value && active.value === matches.value.length) create()
  else pick(matches.value[active.value])
}

function onKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    opened.value = true
    active.value = Math.min(active.value + 1, rowCount.value - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = Math.max(active.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    choose()
  } else if (e.key === 'Escape' && (opened.value || query.value)) {
    /* 목록만 닫고 팝업은 그대로 둔다 */
    e.stopPropagation()
    e.preventDefault()
    opened.value = false
    query.value = ''
  }
}

function onInput() {
  opened.value = true
  active.value = 0
}
</script>

<template>
  <div class="relative">
    <div
      class="flex h-8 items-center gap-2 rounded-md border border-input bg-background px-2.5 shadow-sm focus-within:ring-1 focus-within:ring-ring"
    >
      <Search class="size-3.5 shrink-0 text-muted-foreground" />
      <input
        v-model="query"
        type="text"
        role="combobox"
        :aria-expanded="opened"
        :placeholder="items.length ? placeholder : emptyLabel"
        :disabled="!usable"
        class="min-w-0 grow bg-transparent text-xs outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        @input="onInput"
        @focus="opened = true"
        @blur="opened = false"
        @keydown="onKeydown"
      />
    </div>

    <ul
      v-if="opened && (items.length || creating)"
      role="listbox"
      class="absolute inset-x-0 top-[calc(100%+4px)] z-50 flex max-h-72 flex-col overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <li
        v-for="(item, i) in matches"
        :key="keyOf(item)"
        role="option"
        :aria-selected="i === active"
        class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs"
        :class="i === active ? 'bg-accent text-accent-foreground' : ''"
        @mouseenter="active = i"
        @mousedown.prevent="pick(item)"
      >
        <Plus class="size-3 shrink-0 text-muted-foreground" />
        <slot name="item" :item="item" />
      </li>
      <li
        v-if="creating"
        role="option"
        :aria-selected="active === matches.length"
        data-picker-create
        class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs font-medium"
        :class="[
          active === matches.length ? 'bg-accent text-accent-foreground' : '',
          matches.length ? 'mt-1 border-t border-border pt-2' : '',
        ]"
        @mouseenter="active = matches.length"
        @mousedown.prevent="create"
      >
        <Plus class="size-3 shrink-0 text-primary" />
        <span class="min-w-0 grow truncate">{{ creating }}</span>
      </li>
      <li v-else-if="matches.length === 0" class="px-2 py-1.5 text-xs text-muted-foreground">
        '{{ query.trim() }}' 이 들어간 것이 없습니다
      </li>
    </ul>
  </div>
</template>
