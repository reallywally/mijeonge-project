<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Check, ChevronDown, X } from 'lucide-vue-next'
import MemberAvatar from '@/components/app/MemberAvatar.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { matchMember } from '@/lib/member'
import { NO_OWNER, ownerPickLabel, toggleOwnerPick } from '@/lib/ownerPick'
import { cn } from '@/lib/utils'
import { useDataStore } from '@/stores/data'

/* 담당자 고르기(여럿) — 작업 · 테스트의 간트 위와 목록 조회 조건이 같이 쓴다. 고른 값은 화면이 주소(?owner=)에 둔다.
   맨 위 '나', 그 아래 프로젝트의 활성 멤버(나는 빼고), 맨 아래 '담당자 없음'. 눌러도 닫히지 않고 넣고 빼기만 한다.
   생김새는 MemberPicker 를 따른다 — 열면 찾는 칸에 포커스, ↑ ↓ · Enter · Esc */
const props = defineProps<{
  /** 트리거의 aria-label */
  label: string
  triggerClass?: string
}>()
const picked = defineModel<string[]>({ required: true })

const data = useDataStore()
const open = ref(false)
const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)

const me = computed(() => data.currentMemberId)
const NONE_LABEL = '담당자 없음'

type Row = { id: string; name: string; avatarUrl: string | null; muted?: boolean }
const rows = computed<Row[]>(() => {
  const q = query.value.trim()
  const meMember = data.allMembers.find((m) => m.id === me.value)
  /* 주소로 들어온 사람이 지금은 비활성이어도 뺄 수 있게 목록에 남긴다 */
  const others = [
    ...data.assignable,
    ...data.allMembers.filter(
      (m) => picked.value.includes(m.id) && !data.assignable.some((a) => a.id === m.id),
    ),
  ]
    .filter((m) => m.id !== me.value && matchMember(m, q))
    .map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl }))
  const out: Row[] = []
  if (meMember && (!q || '나'.includes(q) || matchMember(meMember, q)))
    out.push({ id: meMember.id, name: '나', avatarUrl: meMember.avatarUrl })
  out.push(...others)
  if (!q || NONE_LABEL.includes(q))
    out.push({ id: NO_OWNER, name: NONE_LABEL, avatarUrl: null, muted: true })
  return out
})

const buttonLabel = computed(() => ownerPickLabel(picked.value, me.value, data.memberName))
const titleLabel = computed(() =>
  picked.value
    .map((id) => (id === NO_OWNER ? NONE_LABEL : id === me.value ? '나' : data.memberName(id)))
    .filter(Boolean)
    .join(', '),
)

function onOpen(v: boolean) {
  open.value = v
  if (!v) return
  query.value = ''
  active.value = 0
}

function focusInput(e: Event) {
  e.preventDefault()
  void nextTick(() => input.value?.focus())
}

function toggle(row: Row | undefined) {
  if (!row) return
  picked.value = toggleOwnerPick(picked.value, row.id)
}

function move(by: number) {
  if (rows.value.length === 0) return
  active.value = Math.min(Math.max(active.value + by, 0), rows.value.length - 1)
  void nextTick(() =>
    list.value
      ?.querySelector<HTMLElement>(`[data-owner-row="${active.value}"]`)
      ?.scrollIntoView?.({ block: 'nearest' }),
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
    toggle(rows.value[active.value])
  }
}

/* v-model 은 한글 조합이 끝나야 값을 올린다 — 치는 대로 거르도록 input 을 직접 받는다 */
function onInput(e: Event) {
  query.value = (e.target as HTMLInputElement).value
  active.value = 0
}
</script>

<template>
  <div class="flex items-center">
    <Popover :open="open" @update:open="onOpen">
      <PopoverTrigger as-child>
        <button
          type="button"
          :aria-label="props.label"
          :title="titleLabel || undefined"
          data-owner-pick
          :class="
            cn(
              'flex h-7 max-w-44 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-xs whitespace-nowrap shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-[border-color,box-shadow] hover:border-[color-mix(in_oklab,var(--input),black_8%)] focus:border-ring focus:ring-[3px] focus:ring-ring/20 focus:outline-none',
              picked.length > 0 && 'border-primary/35 bg-brand-soft text-primary',
              picked.length > 0 && 'rounded-r-none border-r-0',
              props.triggerClass,
            )
          "
        >
          <span class="min-w-0 truncate" data-owner-pick-label>{{ buttonLabel }}</span>
          <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        class="w-56 p-0"
        data-owner-pick-list
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
            :aria-label="`${props.label} 찾기`"
            placeholder="이름으로 찾기"
            class="h-7 w-full rounded-sm bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground"
            @input="onInput"
            @keydown="onKeydown"
          />
        </div>
        <ul
          ref="list"
          role="listbox"
          aria-multiselectable="true"
          class="max-h-64 overflow-y-auto p-1"
        >
          <li
            v-for="(row, i) in rows"
            :key="row.id"
            role="option"
            :aria-selected="picked.includes(row.id)"
            :data-owner-row="i"
            :data-owner-choice="row.id"
            class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs"
            :class="[
              i === active ? 'bg-accent text-accent-foreground' : '',
              row.muted ? 'text-muted-foreground' : '',
            ]"
            @mouseenter="active = i"
            @mousedown.prevent
            @click="toggle(row)"
          >
            <MemberAvatar :name="row.muted ? null : row.name" :src="row.avatarUrl" :size="18" />
            <span class="min-w-0 grow truncate">{{ row.name }}</span>
            <Check v-if="picked.includes(row.id)" class="size-3.5 shrink-0 text-primary" />
          </li>
          <li v-if="rows.length === 0" class="px-2 py-1.5 text-xs text-muted-foreground">
            찾는 사람이 없습니다
          </li>
        </ul>
      </PopoverContent>
    </Popover>
    <button
      v-if="picked.length > 0"
      type="button"
      aria-label="담당자 고르기 풀기"
      title="풀기"
      data-owner-pick-clear
      class="flex h-7 items-center rounded-r-md border border-primary/35 bg-brand-soft px-1.5 text-primary hover:bg-primary/10"
      @click="picked = []"
    >
      <X class="size-3.5" />
    </button>
  </div>
</template>
