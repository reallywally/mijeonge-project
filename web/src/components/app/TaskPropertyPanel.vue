<script setup lang="ts">
import { computed } from 'vue'
import { Check } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { periodProblem, TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS } from '@/lib/task'
import { useDataStore } from '@/stores/data'
import type { TaskPriority, TaskStatus } from '@/types/domain'

/* 작업의 속성 — 작업 상세와 작업 추가의 오른쪽 칸. 값은 부모가 들고, 여기는 보여 주고 고친 값을 올린다.
   상세는 올라온 값을 바로 넣고, 추가는 만들 때 한꺼번에 넣는다.
   기간(start · due)은 'YYYY-MM-DD' 또는 빈 문자열이다 — 한쪽만 고른 동안에도 들고 있어야 해서다.
   아래 슬롯에는 상세의 읽기 전용 정보나 추가의 안내를 넣는다. */
defineProps<{
  /** 고를 수 있는 상위 작업 — 상세에서는 자기와 자기 아래가 빠진다 */
  parentChoices: { id: string; label: string }[]
  /** 상태 옆의 '완료' 버튼 — 이미 있는 작업에만 */
  showDone?: boolean
}>()
const status = defineModel<TaskStatus>('status', { required: true })
const ownerId = defineModel<string | null>('ownerId', { required: true })
const start = defineModel<string>('start', { required: true })
const due = defineModel<string>('due', { required: true })
const priority = defineModel<TaskPriority>('priority', { required: true })
const parentId = defineModel<string | null>('parentId', { required: true })

const data = useDataStore()
const NONE = 'none'

const ownerName = computed(() => data.memberName(ownerId.value))
const parentTitle = computed(
  () => data.allTasks.find((t) => t.id === parentId.value)?.title ?? null,
)
const periodHint = computed(() => periodProblem(start.value, due.value))

/* 날짜는 다 고른 뒤(change)에만 올린다 — 글자를 치는 중의 반쪽 날짜를 올리지 않게 */
const picked = (e: Event) => (e.target as HTMLInputElement).value

/* 평소엔 글처럼 보이고, 가리키면 고칠 수 있는 칸임이 드러난다 */
const ghost =
  'h-8 w-full border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-accent focus-visible:bg-background focus-visible:border-input'
</script>

<template>
  <aside
    class="flex w-[340px] shrink-0 flex-col gap-4 border-l border-border bg-muted/50 px-4 pt-4 pb-6"
  >
    <div class="flex items-center gap-2">
      <Select v-model="status">
        <SelectTrigger class="h-8 grow bg-background text-xs font-medium" aria-label="상태">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="o in TASK_STATUS_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </SelectItem>
        </SelectContent>
      </Select>
      <Button
        v-if="showDone"
        variant="outline"
        size="sm"
        class="shrink-0 bg-background"
        :disabled="status === 'done'"
        @click="status = 'done'"
      >
        <Check class="size-3.5" />
        완료
      </Button>
    </div>

    <dl class="flex flex-col gap-0.5">
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

      <div class="flex min-h-9 items-center gap-2">
        <dt class="w-[72px] shrink-0 text-xs text-muted-foreground">시작 날짜</dt>
        <dd class="min-w-0 grow">
          <Input
            :model-value="start"
            type="date"
            aria-label="시작 날짜"
            :class="[ghost, start ? '' : 'text-muted-foreground']"
            @change="(e: Event) => (start = picked(e))"
          />
        </dd>
      </div>
      <div class="flex min-h-9 items-center gap-2">
        <dt class="w-[72px] shrink-0 text-xs text-muted-foreground">기한</dt>
        <dd class="min-w-0 grow">
          <Input
            :model-value="due"
            type="date"
            aria-label="기한"
            :class="[ghost, due ? '' : 'text-muted-foreground']"
            @change="(e: Event) => (due = picked(e))"
          />
        </dd>
      </div>
      <p v-if="periodHint" class="pl-[80px] text-xs text-destructive">{{ periodHint }}</p>
      <p v-else-if="!start && !due" class="pl-[80px] text-xs text-muted-foreground">
        기간 미정 — 간트차트에 막대가 없습니다
      </p>

      <div class="flex min-h-9 items-center gap-2">
        <dt class="w-[72px] shrink-0 text-xs text-muted-foreground">우선순위</dt>
        <dd class="flex min-w-0 grow gap-1 rounded-md bg-secondary p-0.5">
          <button
            v-for="p in TASK_PRIORITY_OPTIONS"
            :key="p.value"
            type="button"
            class="h-7 grow rounded-[5px] text-xs transition-colors"
            :class="
              priority === p.value
                ? 'bg-background font-medium shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            "
            :aria-pressed="priority === p.value"
            @click="priority = p.value"
          >
            {{ p.label }}
          </button>
        </dd>
      </div>

      <div class="flex min-h-9 items-center gap-2">
        <dt class="w-[72px] shrink-0 text-xs text-muted-foreground">상위 작업</dt>
        <dd class="min-w-0 grow">
          <Select
            :model-value="parentId ?? NONE"
            @update:model-value="(v) => (parentId = v === NONE ? null : String(v))"
          >
            <SelectTrigger :class="ghost" aria-label="상위 작업">
              <span class="truncate" :class="parentTitle ? '' : 'text-muted-foreground'">
                {{ parentTitle ?? '없음 (최상위)' }}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="NONE">없음 (최상위 작업)</SelectItem>
              <SelectItem v-for="o in parentChoices" :key="o.id" :value="o.id">
                {{ o.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </dd>
      </div>
    </dl>

    <slot />
  </aside>
</template>
