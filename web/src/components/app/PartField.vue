<script setup lang="ts">
import { computed } from 'vue'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { usePartStore } from '@/stores/part'

/* 작업 · 안건 속성 칸의 파트 한 줄. 고를 수 있는 것은 공통 + 활성 파트, 그리고 이미 달린 보관 파트.
   프로젝트에 파트가 하나도 없으면 줄째로 숨는다 — 고를 것이 공통뿐인 칸은 노이즈다 */
const partId = defineModel<string | null>({ required: true })
defineProps<{ triggerClass: string }>()

const partStore = usePartStore()
const COMMON = 'common'

const choices = computed(() => partStore.choicesFor(partId.value))
const current = computed(() => choices.value.find((p) => p.id === partId.value) ?? null)
const shown = computed(() => partStore.parts.length > 0 || partId.value !== null)
</script>

<template>
  <div v-if="shown" class="flex min-h-9 items-center gap-2">
    <dt class="w-[72px] shrink-0 text-xs text-muted-foreground">파트</dt>
    <dd class="min-w-0 grow">
      <Select
        :model-value="partId ?? COMMON"
        @update:model-value="(v) => (partId = v === COMMON ? null : String(v))"
      >
        <SelectTrigger :class="triggerClass" aria-label="파트">
          <span class="truncate" :class="current ? '' : 'text-muted-foreground'">
            {{ current ? current.name : '공통' }}
            <template v-if="current && !current.active"> (보관)</template>
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="COMMON">공통 (프로젝트 전체)</SelectItem>
          <SelectItem v-for="p in choices" :key="p.id" :value="p.id">
            {{ p.active ? p.name : `${p.name} (보관)` }}
          </SelectItem>
        </SelectContent>
      </Select>
    </dd>
  </div>
</template>
