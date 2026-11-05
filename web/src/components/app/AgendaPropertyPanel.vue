<script setup lang="ts">
import { computed } from 'vue'
import AgendaStateSelect from '@/components/app/AgendaStateSelect.vue'
import CcField from '@/components/app/CcField.vue'
import OwnerSelect from '@/components/app/OwnerSelect.vue'
import PartField from '@/components/app/PartField.vue'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import type { AgendaState } from '@/types/domain'

/* 안건의 속성 — 안건 상세의 오른쪽 칸: 상태 · 결정 기한 · 담당자 · 참조 · 파트. 값은 부모가 들고, 여기는 보여 주고
   고친 값을 올린다 — 상세가 바로 저장한다. 결정 기한은 'YYYY-MM-DD' 또는 빈 문자열이다.
   위 슬롯에는 상태 아래 덧붙일 말을, 아래 슬롯에는 읽기 전용 정보를 넣는다.
   readonly 면 칸을 모두 잠근다 — 고칠 권한이 없는 안건(작성자 · 담당자 · 관리자만 고친다) */
const props = defineProps<{ overdue?: boolean; readonly?: boolean }>()
const state = defineModel<AgendaState>('state', { required: true })
const dueDate = defineModel<string>('dueDate', { required: true })
const ownerId = defineModel<string | null>('ownerId', { required: true })
const ccIds = defineModel<string[]>('ccIds', { required: true })
const partId = defineModel<string | null>('partId', { required: true })

/* 날짜는 다 고른 뒤(change)에만 올린다 — 글자를 치는 중의 반쪽 날짜를 올리지 않게 */
const picked = (e: Event) => (e.target as HTMLInputElement).value

/* 평소엔 글처럼 보이고, 가리키면 고칠 수 있는 칸임이 드러난다. 잠긴 칸은 흐리지 않고 글처럼만 둔다 */
const ghost = computed(() =>
  props.readonly
    ? 'h-8 w-full border-transparent bg-transparent px-2 text-xs shadow-none disabled:cursor-default disabled:opacity-100'
    : 'h-8 w-full border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-accent focus-visible:bg-background focus-visible:border-input',
)
</script>

<template>
  <aside
    class="flex w-[300px] shrink-0 flex-col gap-4 border-l border-border bg-muted/50 px-4 pt-4 pb-6"
  >
    <dl class="flex flex-col gap-0.5">
      <div class="flex min-h-9 items-center gap-2">
        <dt class="w-[72px] shrink-0 text-xs text-muted-foreground">상태</dt>
        <dd class="min-w-0 grow">
          <AgendaStateSelect v-model="state" :trigger-class="ghost" :disabled="readonly" />
        </dd>
      </div>
      <slot name="top" />

      <div class="flex min-h-9 items-center gap-2">
        <dt class="w-[72px] shrink-0 text-xs text-muted-foreground">결정 기한</dt>
        <dd class="min-w-0 grow">
          <Input
            :model-value="dueDate"
            type="date"
            aria-label="결정 기한"
            :disabled="readonly"
            :class="[
              ghost,
              dueDate ? '' : 'text-muted-foreground',
              overdue ? 'text-destructive' : '',
            ]"
            @change="(e: Event) => (dueDate = picked(e))"
          />
        </dd>
      </div>
      <p v-if="overdue" class="flex items-center gap-2 pl-[80px]">
        <Badge variant="destructive">기한 지남</Badge>
      </p>
      <p v-else-if="!dueDate && !readonly" class="pl-[80px] text-xs text-muted-foreground">
        기한 없음 — 미뤄지기 쉽습니다
      </p>

      <div class="flex min-h-9 items-center gap-2">
        <dt class="w-[72px] shrink-0 text-xs text-muted-foreground">담당자</dt>
        <dd class="min-w-0 grow">
          <OwnerSelect
            v-model="ownerId"
            label="담당자"
            :trigger-class="ghost"
            :disabled="readonly"
          />
        </dd>
      </div>

      <CcField v-model="ccIds" :readonly="readonly" />

      <PartField v-model="partId" :trigger-class="ghost" :disabled="readonly" />
    </dl>

    <slot />
  </aside>
</template>
