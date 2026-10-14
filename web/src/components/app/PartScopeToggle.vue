<script setup lang="ts">
import { usePartStore } from '@/stores/part'
import type { PartScope } from '@/lib/part'

/* [내 파트 | 전체] — 작업 세 탭과 안건 목록이 같이 따른다. 내가 속한 파트가 없으면 숨는다(늘 전체).
   보기 범위일 뿐이다 — 상세를 주소로 열면 '내 파트' 여도 열린다 */
const partStore = usePartStore()

const options: { key: PartScope; label: string }[] = [
  { key: 'mine', label: '내 파트' },
  { key: 'all', label: '전체' },
]
</script>

<template>
  <div
    v-if="partStore.canNarrow"
    role="group"
    aria-label="보기 범위"
    class="flex items-center gap-0.5 rounded-md border border-border bg-muted/50 p-0.5"
  >
    <button
      v-for="o in options"
      :key="o.key"
      type="button"
      class="inline-flex h-6 items-center rounded-sm px-3 text-xs"
      :class="
        partStore.scope === o.key
          ? 'bg-background font-medium shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      "
      :aria-pressed="partStore.scope === o.key"
      :data-scope="o.key"
      @click="partStore.setScope(o.key)"
    >
      {{ o.label }}
    </button>
  </div>
</template>
