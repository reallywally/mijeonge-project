<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ATTENTION_SIGNAL_LABEL, statusSpan } from '@/lib/progress'
import { useDataStore } from '@/stores/data'
import type { TaskAttention, TaskAttentionSignal } from '@/types/domain'

/* 손쓸 작업 표 — 저장된 attention 전부를 그대로 그린다(다시 계산하지 않는다).
   작업 이름 · 담당은 지금 스냅샷에서 찾는다. 그사이 지워진 작업은 흐리게 '지워진 작업' */
const props = defineProps<{ attention: TaskAttention[] }>()
const emit = defineEmits<{ 'open-task': [id: string] }>()

const data = useDataStore()
const taskOf = (id: string) => data.allTasks.find((t) => t.id === id)

/** 늦어서 남을 미는 신호 · 풀어도 되는 신호는 눈에 띄게 */
const STRONG: TaskAttentionSignal[] = ['lateBlocker', 'decidedButBlocked']

/* 선행 작업은 2026-10-28 걷었다(Q63) — 기다림 · 막음은 지난 리포트의 facts 에만 있어 그때만 칸을 세운다 */
const waitingOf = (a: TaskAttention) => a.waitingOnTaskIds ?? []
const blockingOf = (a: TaskAttention) => a.blockingTaskIds ?? []
const legacy = computed(() =>
  props.attention.some((a) => waitingOf(a).length > 0 || blockingOf(a).length > 0),
)
</script>

<template>
  <div
    class="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
  >
    <Table>
      <TableHeader>
        <TableRow class="bg-muted/60 hover:bg-muted/60">
          <TableHead class="h-10 text-xs font-medium text-muted-foreground">작업</TableHead>
          <TableHead class="h-10 w-[96px] text-xs font-medium text-muted-foreground"
            >상태 며칠째</TableHead
          >
          <TableHead class="h-10 w-[56px] text-right text-xs font-medium text-muted-foreground"
            >계획</TableHead
          >
          <TableHead v-if="legacy" class="h-10 w-[168px] text-xs font-medium text-muted-foreground"
            >기다림 / 막음</TableHead
          >
          <TableHead class="h-10 w-[76px] text-xs font-medium text-muted-foreground"
            >담당</TableHead
          >
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="a in attention"
          :key="a.taskId"
          class="hover:bg-transparent"
          :data-attention="a.taskId"
        >
          <TableCell class="min-w-0 py-2.5">
            <button
              v-if="taskOf(a.taskId)"
              type="button"
              class="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs hover:bg-accent"
              :data-attention-task="a.taskId"
              @click="emit('open-task', a.taskId)"
            >
              <span class="shrink-0 font-mono text-muted-foreground">{{
                taskOf(a.taskId)!.key
              }}</span>
              <span class="truncate">{{ taskOf(a.taskId)!.title }}</span>
            </button>
            <span v-else class="text-xs text-muted-foreground">지워진 작업</span>
            <div class="mt-1.5 flex flex-wrap gap-1" data-attention-signals>
              <Badge
                v-for="s in a.signals"
                :key="s"
                variant="outline"
                class="font-normal whitespace-nowrap text-muted-foreground"
                :class="STRONG.includes(s) ? 'border-destructive/40' : ''"
                >{{ ATTENTION_SIGNAL_LABEL[s] }}</Badge
              >
            </div>
          </TableCell>
          <TableCell class="text-sm" data-attention-days>{{ statusSpan(a) }}</TableCell>
          <TableCell class="text-right text-sm text-muted-foreground">{{
            a.plannedDays !== null ? `${a.plannedDays}일` : '—'
          }}</TableCell>
          <TableCell v-if="legacy" class="py-2.5">
            <div class="flex flex-col gap-1">
              <div
                v-if="waitingOf(a).length > 0"
                class="flex flex-wrap items-center gap-1"
                data-attention-waiting
              >
                <span class="text-xs text-muted-foreground">기다림</span>
                <button
                  v-for="id in waitingOf(a)"
                  :key="id"
                  type="button"
                  class="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-xs hover:bg-accent"
                  :title="taskOf(id)?.title"
                  @click="emit('open-task', id)"
                >
                  {{ taskOf(id)?.key ?? '—' }}
                </button>
              </div>
              <div
                v-if="blockingOf(a).length > 0"
                class="flex flex-wrap items-center gap-1"
                data-attention-blocking
              >
                <span class="text-xs text-muted-foreground">막음</span>
                <button
                  v-for="id in blockingOf(a)"
                  :key="id"
                  type="button"
                  class="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-xs hover:bg-accent"
                  :title="taskOf(id)?.title"
                  @click="emit('open-task', id)"
                >
                  {{ taskOf(id)?.key ?? '—' }}
                </button>
              </div>
              <span
                v-if="waitingOf(a).length === 0 && blockingOf(a).length === 0"
                class="text-sm text-muted-foreground"
                >—</span
              >
            </div>
          </TableCell>
          <TableCell
            class="text-sm"
            :class="taskOf(a.taskId)?.ownerId ? '' : 'text-muted-foreground'"
            >{{ data.memberName(taskOf(a.taskId)?.ownerId ?? null) ?? '미정' }}</TableCell
          >
        </TableRow>
        <TableRow v-if="attention.length === 0" class="hover:bg-transparent">
          <TableCell
            :colspan="legacy ? 5 : 4"
            class="h-20 text-center text-sm text-muted-foreground"
          >
            손쓸 작업이 없습니다.
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
