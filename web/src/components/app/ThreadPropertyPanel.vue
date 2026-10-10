<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { useDataStore } from '@/stores/data'

/* 안건의 속성 — 안건 상세와 안건 추가의 오른쪽 칸. 값은 부모가 들고, 여기는 보여 주고 고친 값을 올린다.
   상세는 올라온 값을 바로 저장하고, 추가는 만들 때 한꺼번에 넣는다.
   결정 기한은 'YYYY-MM-DD' 또는 빈 문자열이다. 위 슬롯에는 상태를, 아래 슬롯에는 읽기 전용 정보를 넣는다. */
defineProps<{ overdue?: boolean }>()
const dueDate = defineModel<string>('dueDate', { required: true })
const ownerId = defineModel<string | null>('ownerId', { required: true })

const data = useDataStore()
const NONE = 'none'
const ownerName = computed(() => data.memberName(ownerId.value))

/* 날짜는 다 고른 뒤(change)에만 올린다 — 글자를 치는 중의 반쪽 날짜를 올리지 않게 */
const picked = (e: Event) => (e.target as HTMLInputElement).value

const ghost =
  'h-8 w-full border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-accent focus-visible:bg-background focus-visible:border-input'
</script>

<template>
  <aside
    class="flex w-[300px] shrink-0 flex-col gap-4 border-l border-border bg-muted/50 px-4 pt-4 pb-6"
  >
    <slot name="top" />

    <dl class="flex flex-col gap-0.5">
      <div class="flex min-h-9 items-center gap-2">
        <dt class="w-[72px] shrink-0 text-xs text-muted-foreground">결정 기한</dt>
        <dd class="min-w-0 grow">
          <Input
            :model-value="dueDate"
            type="date"
            aria-label="결정 기한"
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
      <p v-else-if="!dueDate" class="pl-[80px] text-xs text-muted-foreground">
        기한 없음 — 미뤄지기 쉽습니다
      </p>

      <div class="flex min-h-9 items-center gap-2">
        <dt class="w-[72px] shrink-0 text-xs text-muted-foreground">담당자</dt>
        <dd class="min-w-0 grow">
          <Select
            :model-value="ownerId ?? NONE"
            @update:model-value="(v) => (ownerId = v === NONE ? null : String(v))"
          >
            <SelectTrigger :class="ghost" aria-label="담당자">
              <span class="flex min-w-0 items-center gap-2">
                <span
                  class="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-secondary text-[10px]"
                  :class="ownerName ? '' : 'text-muted-foreground'"
                >
                  {{ ownerName ? ownerName.charAt(0) : '–' }}
                </span>
                <span class="truncate" :class="ownerName ? '' : 'text-muted-foreground'">
                  {{ ownerName ?? '미정' }}
                </span>
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="NONE">미정 (담당자 없음)</SelectItem>
              <SelectItem v-for="m in data.allMembers" :key="m.id" :value="m.id">
                {{ m.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </dd>
      </div>
    </dl>

    <slot />
  </aside>
</template>
