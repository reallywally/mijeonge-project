<script setup lang="ts">
import { computed } from 'vue'
import { Check, ChevronRight, FolderClosed, Plus } from 'lucide-vue-next'
import TaskStatusBadge from '@/components/app/TaskStatusBadge.vue'
import ThreadStateBadge from '@/components/app/ThreadStateBadge.vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { monthDay } from '@/lib/date'
import { TASK_STATUS_OPTIONS, taskPriorityLabel } from '@/lib/task'
import { useDataStore } from '@/stores/data'
import { useMeetingStore } from '@/stores/meeting'
import { useTaskStore } from '@/stores/task'
import { useThreadStore } from '@/stores/thread'
import type { TaskStatus } from '@/types/domain'

/* 작업 상세 — 목록 위 팝업. 왼쪽이 본문, 오른쪽이 필드다.
   맵핑(안건 · 회의)은 memo 의 연관 관계대로 여기와 회의 상세에서만 한다. */
const props = defineProps<{ taskId: string | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  (e: 'open-task', id: string): void
  (e: 'add-subtask', parentId: string): void
  (e: 'open-thread', id: string): void
  (e: 'open-meeting', id: string): void
}>()

const data = useDataStore()
const taskStore = useTaskStore()
const threadStore = useThreadStore()
const meetingStore = useMeetingStore()

const detail = computed(() => (props.taskId ? taskStore.taskDetail(props.taskId) : null))

function setStatus(status: TaskStatus) {
  if (props.taskId) taskStore.setStatus(props.taskId, status)
}

const subPct = computed(() => {
  const d = detail.value
  if (!d || d.children.length === 0) return 0
  return Math.round((d.doneChildCount / d.children.length) * 100)
})

const periodLabel = computed(() => {
  const task = detail.value?.task
  if (!task?.start || !task.due) return '기간 미정'
  return `${monthDay(task.start)} ~ ${monthDay(task.due)}`
})

const parentLabel = computed(() => {
  const parent = detail.value?.parent
  return parent ? taskStore.fullPath(parent) : '없음 (최상위 작업)'
})

/* 아직 안 건 안건 · 회의 — 팝업을 한 겹 더 띄우지 않고 펼쳐 둔다 */
const threadChoices = computed(() => {
  const linked = new Set(detail.value?.threads.map((t) => t.thread.id))
  return threadStore.threads.filter((t) => !linked.has(t.id))
})

const linkedMeetings = computed(() => {
  const linked = new Set(detail.value?.meetings.map((m) => m.id))
  return meetingStore.rows.filter((r) => linked.has(r.meeting.id))
})

const meetingChoices = computed(() => {
  const linked = new Set(detail.value?.meetings.map((m) => m.id))
  return meetingStore.rows.filter((r) => !linked.has(r.meeting.id))
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogScrollContent v-if="detail" class="max-w-[1140px] gap-0 p-0">
      <div class="flex items-center gap-2 border-b border-border px-[22px] py-3.5 pr-[60px]">
        <FolderClosed class="size-3.5 text-muted-foreground" />
        <span class="text-xs text-muted-foreground">{{ data.currentProject.name }}</span>
        <ChevronRight class="size-3 text-muted-foreground" />
        <span class="text-xs text-muted-foreground">작업</span>
        <ChevronRight class="size-3 text-muted-foreground" />
        <span class="text-xs">{{ detail.task.key }}</span>
      </div>

      <div class="flex items-stretch">
        <div class="flex min-w-0 grow flex-col gap-6 px-[22px] pt-5 pb-6">
          <header class="flex flex-col gap-2.5">
            <DialogTitle class="text-xl leading-snug font-semibold tracking-tight text-pretty">
              {{ detail.task.title }}
            </DialogTitle>
            <div class="flex flex-wrap items-center gap-2">
              <TaskStatusBadge :status="detail.task.status" />
              <DialogDescription class="text-xs text-muted-foreground">
                {{ detail.ownerName ?? '담당자 미정' }} · {{ periodLabel }}
              </DialogDescription>
            </div>
            <button
              type="button"
              class="self-start text-xs text-muted-foreground underline-offset-4 hover:underline"
              :disabled="!detail.parent"
              @click="detail.parent && emit('open-task', detail.parent.id)"
            >
              {{ detail.pathLabel }}
            </button>
          </header>

          <section class="flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium">내용</span>
              <span class="text-xs text-muted-foreground">체크박스는 눌러서 켜고 끕니다</span>
            </div>
            <div class="flex flex-col gap-0.5 rounded-md border border-border px-3.5 py-3">
              <component
                :is="line.kind === 'check' ? 'button' : 'div'"
                v-for="line in detail.task.body"
                :key="line.id"
                :type="line.kind === 'check' ? 'button' : undefined"
                class="flex min-h-7 items-start gap-2.5 py-1 text-left"
                :style="{ paddingLeft: `${line.level * 26}px` }"
                @click="line.kind === 'check' && taskStore.toggleBodyLine(detail.task.id, line.id)"
              >
                <span
                  v-if="line.kind === 'check'"
                  class="mt-0.5 flex size-[17px] shrink-0 items-center justify-center rounded-sm border"
                  :class="line.done ? 'border-primary bg-primary' : 'border-input'"
                >
                  <Check v-if="line.done" class="size-3 text-primary-foreground" />
                </span>
                <span v-else class="mt-[9px] size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                <span
                  class="min-w-0 grow text-[13px] leading-relaxed text-pretty"
                  :class="line.done ? 'text-muted-foreground line-through' : ''"
                >
                  {{ line.text }}
                </span>
              </component>
              <p v-if="detail.task.body.length === 0" class="text-[13px] text-muted-foreground">
                적어 둔 내용이 없습니다.
              </p>
            </div>
          </section>

          <section class="flex flex-col gap-3">
            <div class="flex items-center gap-2.5">
              <span class="shrink-0 text-xs font-medium">하위 작업</span>
              <div class="h-1.5 grow overflow-hidden rounded-full bg-secondary">
                <div class="h-full bg-primary" :style="{ width: `${subPct}%` }" />
              </div>
              <span class="shrink-0 text-xs text-muted-foreground">
                {{ detail.doneChildCount }} / {{ detail.children.length }} 완료
              </span>
            </div>

            <div class="flex flex-col overflow-hidden rounded-md border border-border">
              <div
                class="flex h-8 items-center gap-3 border-b border-border bg-muted/50 px-3 text-xs font-medium tracking-wider text-muted-foreground"
              >
                <span class="min-w-0 grow">작업</span>
                <span class="w-[120px] shrink-0">상태</span>
                <span class="w-14 shrink-0">담당자</span>
              </div>

              <div
                v-for="child in detail.children"
                :key="child.task.id"
                class="flex min-h-[38px] items-center gap-3 border-b border-border px-3 py-1"
              >
                <span class="flex min-w-0 grow items-center gap-2.5">
                  <span class="shrink-0 text-xs text-muted-foreground">{{ child.task.key }}</span>
                  <button
                    type="button"
                    class="min-w-0 truncate text-left text-[13px] underline-offset-4 hover:underline"
                    @click="emit('open-task', child.task.id)"
                  >
                    {{ child.task.title }}
                  </button>
                </span>
                <Select
                  :model-value="child.task.status"
                  @update:model-value="(v) => taskStore.setStatus(child.task.id, v as TaskStatus)"
                >
                  <SelectTrigger class="h-[26px] w-[120px] shrink-0 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="o in TASK_STATUS_OPTIONS" :key="o.value" :value="o.value">
                      {{ o.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <span class="w-14 shrink-0 truncate text-xs text-muted-foreground">
                  {{ child.ownerName ?? '미정' }}
                </span>
              </div>

              <p
                v-if="detail.children.length === 0"
                class="px-3 py-2.5 text-xs text-muted-foreground"
              >
                하위 작업이 없습니다.
              </p>

              <button
                type="button"
                class="flex min-h-[34px] items-center gap-1.5 px-3 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                @click="emit('add-subtask', detail.task.id)"
              >
                <Plus class="size-3.5" />
                하위 작업 추가
              </button>
            </div>
          </section>

          <section class="flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium">연관 안건</span>
              <span class="text-xs text-muted-foreground"
                >이 작업을 하다가 정해야 했던 것들입니다</span
              >
            </div>

            <div
              v-for="row in detail.threads"
              :key="row.thread.id"
              class="flex items-start gap-3 rounded-md border border-border border-l-[3px] px-3.5 py-3"
              :class="row.thread.state === 'decided' ? 'border-l-primary' : 'border-l-border'"
            >
              <div class="flex min-w-0 grow flex-col gap-1.5">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-[13px] font-medium text-pretty">{{ row.thread.title }}</span>
                  <ThreadStateBadge :state="row.thread.state" :defer-count="row.deferCount" />
                </div>
                <p class="text-xs leading-relaxed text-muted-foreground text-pretty">
                  {{ row.line }}
                </p>
                <p class="text-xs text-muted-foreground">{{ row.where }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <Button variant="outline" size="xs" @click="emit('open-thread', row.thread.id)">
                  안건 이력
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  class="text-muted-foreground"
                  @click="taskStore.unlinkThread(detail.task.id, row.thread.id)"
                >
                  연결 해제
                </Button>
              </div>
            </div>

            <div
              class="flex flex-col gap-2 rounded-md border border-border bg-muted/50 px-3.5 py-3"
            >
              <span class="text-xs font-medium tracking-wider text-muted-foreground"
                >등록된 안건에서 고르기</span
              >
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="t in threadChoices"
                  :key="t.id"
                  type="button"
                  class="inline-flex h-[30px] items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs shadow-sm hover:bg-accent hover:text-accent-foreground"
                  @click="taskStore.linkThread(detail.task.id, t.id)"
                >
                  <Plus class="size-3 text-muted-foreground" />
                  {{ t.title }}
                </button>
                <span v-if="threadChoices.length === 0" class="text-xs text-muted-foreground">
                  고를 수 있는 안건을 모두 연결했습니다.
                </span>
              </div>
            </div>
          </section>

          <section class="flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium">연관 회의</span>
              <span class="text-xs text-muted-foreground">이 작업이 걸린 회의입니다</span>
            </div>

            <div
              v-for="row in linkedMeetings"
              :key="row.meeting.id"
              class="flex items-start gap-3 rounded-md border border-border px-3.5 py-3"
            >
              <div class="flex min-w-0 grow flex-col gap-1.5">
                <span class="text-[13px] font-medium text-pretty">{{ row.meeting.title }}</span>
                <p class="text-xs text-muted-foreground text-pretty">
                  {{ row.dateLabel }} · {{ row.attendeeNames.join(' · ') }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <Button variant="outline" size="xs" @click="emit('open-meeting', row.meeting.id)">
                  그 회의 보기
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  class="text-muted-foreground"
                  @click="taskStore.unlinkMeeting(detail.task.id, row.meeting.id)"
                >
                  연결 해제
                </Button>
              </div>
            </div>

            <div
              class="flex flex-col gap-2 rounded-md border border-border bg-muted/50 px-3.5 py-3"
            >
              <span class="text-xs font-medium tracking-wider text-muted-foreground"
                >등록된 회의에서 고르기</span
              >
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="row in meetingChoices"
                  :key="row.meeting.id"
                  type="button"
                  class="inline-flex h-[30px] items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs shadow-sm hover:bg-accent hover:text-accent-foreground"
                  @click="taskStore.linkMeeting(detail.task.id, row.meeting.id)"
                >
                  <Plus class="size-3 text-muted-foreground" />
                  {{ row.meeting.title }}
                  <span class="text-muted-foreground">{{ row.dateLabel }}</span>
                </button>
                <span v-if="meetingChoices.length === 0" class="text-xs text-muted-foreground">
                  이 프로젝트의 회의를 모두 연결했습니다.
                </span>
              </div>
            </div>
          </section>
        </div>

        <div
          class="flex w-[360px] shrink-0 flex-col gap-3 border-l border-border bg-muted/50 px-[18px] pt-5 pb-6"
        >
          <div class="flex items-center gap-2">
            <Select
              :model-value="detail.task.status"
              @update:model-value="(v) => setStatus(v as TaskStatus)"
            >
              <SelectTrigger class="h-8 grow bg-background text-xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="o in TASK_STATUS_OPTIONS" :key="o.value" :value="o.value">
                  {{ o.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              class="shrink-0 bg-background"
              @click="setStatus('done')"
            >
              <Check class="size-3.5" />
              완료
            </Button>
          </div>

          <div class="overflow-hidden rounded-md border border-border bg-background">
            <div
              class="flex h-8 items-center border-b border-border px-3 text-xs font-medium tracking-wider text-muted-foreground"
            >
              기간
            </div>
            <dl class="flex flex-col gap-1 px-3 py-2.5">
              <div class="flex min-h-7 items-start gap-2.5 py-1">
                <dt class="w-20 shrink-0 text-xs text-muted-foreground">시작 날짜</dt>
                <dd
                  class="min-w-0 grow text-xs"
                  :class="detail.task.start ? '' : 'text-muted-foreground'"
                >
                  {{ detail.task.start ? monthDay(detail.task.start) : '미정' }}
                </dd>
              </div>
              <div class="flex min-h-7 items-start gap-2.5 py-1">
                <dt class="w-20 shrink-0 text-xs text-muted-foreground">기한</dt>
                <dd
                  class="min-w-0 grow text-xs"
                  :class="detail.task.due ? '' : 'text-muted-foreground'"
                >
                  {{ detail.task.due ? monthDay(detail.task.due) : '미정' }}
                </dd>
              </div>
            </dl>
          </div>

          <div class="overflow-hidden rounded-md border border-border bg-background">
            <div
              class="flex h-8 items-center border-b border-border px-3 text-xs font-medium tracking-wider text-muted-foreground"
            >
              세부 사항
            </div>
            <dl class="flex flex-col gap-1 px-3 py-2.5">
              <div class="flex min-h-7 items-start gap-2.5 py-1">
                <dt class="w-20 shrink-0 text-xs text-muted-foreground">담당자</dt>
                <dd class="flex min-w-0 grow items-center gap-2 text-xs">
                  <span
                    v-if="detail.ownerName"
                    class="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-secondary text-[10px]"
                  >
                    {{ detail.ownerName.charAt(0) }}
                  </span>
                  <span :class="detail.ownerName ? '' : 'text-muted-foreground'">
                    {{ detail.ownerName ?? '미정' }}
                  </span>
                </dd>
              </div>
              <div class="flex min-h-7 items-start gap-2.5 py-1">
                <dt class="w-20 shrink-0 text-xs text-muted-foreground">상위 작업</dt>
                <dd
                  class="min-w-0 grow text-xs text-pretty"
                  :class="detail.parent ? '' : 'text-muted-foreground'"
                >
                  {{ parentLabel }}
                </dd>
              </div>
              <div class="flex min-h-7 items-start gap-2.5 py-1">
                <dt class="w-20 shrink-0 text-xs text-muted-foreground">우선순위</dt>
                <dd class="min-w-0 grow text-xs">{{ taskPriorityLabel(detail.task.priority) }}</dd>
              </div>
              <div class="flex min-h-7 items-start gap-2.5 py-1">
                <dt class="w-20 shrink-0 text-xs text-muted-foreground">연관 안건</dt>
                <dd class="min-w-0 grow text-xs">{{ detail.threads.length }}건</dd>
              </div>
              <div class="flex min-h-7 items-start gap-2.5 py-1">
                <dt class="w-20 shrink-0 text-xs text-muted-foreground">연관 회의</dt>
                <dd class="min-w-0 grow text-xs">{{ detail.meetings.length }}건</dd>
              </div>
            </dl>
          </div>

          <div class="rounded-md border border-border bg-background px-3 py-2.5">
            <p class="text-xs text-muted-foreground">
              만든 날짜 {{ monthDay(detail.task.createdAt) }}
            </p>
          </div>
        </div>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
