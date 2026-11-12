<script setup lang="ts">
import { computed } from 'vue'
import { Check, ChevronDown, X } from 'lucide-vue-next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { PartPickArea } from '@/lib/part'
import { cn } from '@/lib/utils'
import { usePartStore } from '@/stores/part'

/* 볼 파트 고르기 — 담당자 고르기(OwnerPickFilter)처럼 내 파트(보기 권한이 있는 소속) 중 여럿을 고르고, 비우면 전체다.
   고른 값은 메뉴 묶음마다 따로다 — 업무(작업 세 탭 · 테스트 · 리스크)는 내 파트 전부로, 안건은 전체로 시작한다.
   내 파트가 없으면 숨는다(늘 전체). 보기 범위일 뿐이다 — 상세를 주소로 열면 걸러져 있어도 열린다 */
const props = defineProps<{ area: PartPickArea }>()
const partStore = usePartStore()

/** 내 파트 — 이름 순 */
const myParts = computed(() => partStore.parts.filter((p) => partStore.myPartIds.has(p.id)))
const picked = computed(() => partStore.pickedIdsOf(props.area))

const buttonLabel = computed(() => {
  const ids = picked.value
  if (ids.length === 0) return '전체 파트'
  const first = partStore.partName(ids[0]) ?? '알 수 없음'
  return ids.length > 1 ? `${first} 외 ${ids.length - 1}` : first
})
const titleLabel = computed(() =>
  picked.value
    .map((id) => partStore.partName(id))
    .filter(Boolean)
    .join(', '),
)
</script>

<template>
  <div v-if="partStore.canNarrow" class="flex items-center">
    <Popover>
      <PopoverTrigger as-child>
        <button
          type="button"
          aria-label="파트 고르기"
          :title="titleLabel || undefined"
          data-part-pick
          :class="
            cn(
              'flex h-7 max-w-44 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-xs whitespace-nowrap shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-[border-color,box-shadow] hover:border-[color-mix(in_oklab,var(--input),black_8%)] focus:border-ring focus:ring-[3px] focus:ring-ring/20 focus:outline-none',
              picked.length > 0 &&
                'rounded-r-none border-r-0 border-primary/35 bg-brand-soft text-primary',
            )
          "
        >
          <span class="min-w-0 truncate" data-part-pick-label>{{ buttonLabel }}</span>
          <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" class="w-48 p-0" data-part-pick-list>
        <p class="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">내 파트</p>
        <ul role="listbox" aria-multiselectable="true" class="max-h-64 overflow-y-auto p-1">
          <li
            v-for="p in myParts"
            :key="p.id"
            role="option"
            :aria-selected="picked.includes(p.id)"
            :data-part-choice="p.id"
            class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
            @click="partStore.togglePicked(p.id, area)"
          >
            <span class="min-w-0 grow truncate">{{ p.name }}</span>
            <span v-if="!p.active" class="text-muted-foreground">보관</span>
            <Check v-if="picked.includes(p.id)" class="size-3.5 shrink-0 text-primary" />
          </li>
        </ul>
      </PopoverContent>
    </Popover>
    <button
      v-if="picked.length > 0"
      type="button"
      aria-label="파트 고르기 풀기"
      title="풀기 — 전체 파트"
      data-part-pick-clear
      class="flex h-7 items-center rounded-r-md border border-primary/35 bg-brand-soft px-1.5 text-primary hover:bg-primary/10"
      @click="partStore.setScope('all', area)"
    >
      <X class="size-3.5" />
    </button>
  </div>
</template>
