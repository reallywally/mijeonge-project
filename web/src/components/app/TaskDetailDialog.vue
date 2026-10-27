<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronRight, FolderClosed } from 'lucide-vue-next'
import HistorySection from '@/components/app/HistorySection.vue'
import MinutesSourceChip from '@/components/app/MinutesSourceChip.vue'
import TaggedTests from '@/components/app/TaggedTests.vue'
import TaskBodyEditor from '@/components/app/TaskBodyEditor.vue'
import TaskComments from '@/components/app/TaskComments.vue'
import TaskDependencies from '@/components/app/TaskDependencies.vue'
import TaskLinks from '@/components/app/TaskLinks.vue'
import TaskPropertyPanel from '@/components/app/TaskPropertyPanel.vue'
import TaskRelated from '@/components/app/TaskRelated.vue'
import { Dialog, DialogDescription, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { monthDay } from '@/lib/date'
import { statusSinceLabel } from '@/lib/dependency'
import { periodProblem } from '@/lib/task'
import { fitTextarea } from '@/lib/utils'
import { useDataStore } from '@/stores/data'
import { useTaskStore } from '@/stores/task'
import { useThreadStore } from '@/stores/thread'
import type { TaskLine } from '@/types/domain'

/* 작업 상세 — 목록 위 팝업. 보는 자리가 곧 고치는 자리다: 칸을 눌러 고치면 그 값이 바로 들어가고
   따로 저장 버튼이 없다. 왼쪽이 제목 · 본문 · 연관 작업 · 선행 작업 · 연결, 오른쪽이 속성이다.
   안건 맵핑은 memo 의 연관 관계대로 여기서만 한다. 그 아래 댓글, 맨 아래가 접어 둔 변경 이력이다. */
const props = defineProps<{ taskId: string | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  (e: 'open-task', id: string): void
  (e: 'open-thread', id: string): void
}>()

const data = useDataStore()
const taskStore = useTaskStore()
const threadStore = useThreadStore()

const detail = computed(() => (props.taskId ? taskStore.taskDetail(props.taskId) : null))

/* 제목 — Enter 나 벗어나면 들어가고, Esc 는 되돌린다. 비우면 원래 제목으로 돌아간다 */
const titleDraft = ref('')
const titleField = ref<HTMLTextAreaElement | null>(null)

const fitTitle = () => fitTextarea(titleField.value)

/* 팝업이 열려 칸이 붙는 순간에도 긴 제목이 잘리지 않게 높이를 맞춘다 */
watch(titleField, fitTitle)

function commitTitle() {
  if (!props.taskId) return
  if (titleDraft.value.trim()) taskStore.setTitle(props.taskId, titleDraft.value)
  titleDraft.value = detail.value?.task.title ?? ''
  void nextTick(fitTitle)
}

function onTitleKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'Enter') {
    e.preventDefault()
    ;(e.target as HTMLTextAreaElement).blur()
  } else if (e.key === 'Escape') {
    /* 팝업까지 닫히지 않게 여기서 멈춘다 */
    e.stopPropagation()
    e.preventDefault()
    titleDraft.value = detail.value?.task.title ?? ''
    ;(e.target as HTMLTextAreaElement).blur()
  }
}

function saveBody(lines: TaskLine[]) {
  if (props.taskId) taskStore.setBody(props.taskId, lines)
}

/* 기간 — 둘 다 있거나 둘 다 없어야 기간이다(간트의 규칙). 한쪽만 적은 동안은 여기서 들고 있다가
   짝이 맞으면 넣는다. 그래야 시작을 먼저 고르고 기한을 고르는 동안 값이 날아가지 않는다. */
const startDraft = ref('')
const dueDraft = ref('')

function commitPeriod() {
  if (!props.taskId) return
  const start = startDraft.value
  const due = dueDraft.value
  if (!periodProblem(start, due)) taskStore.setPeriod(props.taskId, start || null, due || null)
}

/* 다른 작업으로 옮기거나 팝업을 다시 열면 칸들을 그 작업의 값으로 채운다 */
watch(
  [() => props.taskId, open],
  () => {
    const task = detail.value?.task
    titleDraft.value = task?.title ?? ''
    startDraft.value = task?.start ?? ''
    dueDraft.value = task?.due ?? ''
    void nextTick(fitTitle)
  },
  { immediate: true },
)

/* 아직 안 건 안건 — 검색 칸이 이 안에서 찾는다 */
const threadChoices = computed(() => {
  const linked = new Set(detail.value?.threads.map((t) => t.thread.id))
  return threadStore.threads.filter((t) => !linked.has(t.id))
})
</script>

<template>
  <Dialog v-model:open="open">
    <!-- 열자마자 제목 칸에 커서가 서면 고치는 중처럼 보인다 — 처음 포커스는 주지 않는다 -->
    <DialogScrollContent v-if="detail" class="max-w-[1140px] gap-0 p-0" @open-auto-focus.prevent>
      <div class="flex items-center gap-2 border-b border-border px-[22px] py-3.5 pr-[60px]">
        <FolderClosed class="size-3.5 text-muted-foreground" />
        <span class="text-xs text-muted-foreground">{{ data.currentProject?.name }}</span>
        <ChevronRight class="size-3 text-muted-foreground" />
        <span class="text-xs text-muted-foreground">작업</span>
        <ChevronRight class="size-3 text-muted-foreground" />
        <span class="text-xs">{{ detail.task.key }}</span>
        <span class="grow" />
        <span class="text-xs text-muted-foreground">고치면 바로 저장됩니다</span>
      </div>

      <div class="flex items-stretch">
        <div class="flex min-w-0 grow flex-col gap-6 px-[22px] pt-4 pb-6">
          <header class="flex flex-col gap-1">
            <DialogTitle class="sr-only">{{ detail.task.title }}</DialogTitle>
            <textarea
              ref="titleField"
              v-model="titleDraft"
              rows="1"
              aria-label="제목"
              class="-mx-2 resize-none overflow-hidden [field-sizing:content] rounded-md border border-transparent bg-transparent px-2 py-1 text-xl leading-snug font-semibold tracking-tight outline-none hover:border-border focus:border-input"
              @input="fitTitle"
              @keydown="onTitleKeydown"
              @blur="commitTitle"
            />
            <DialogDescription class="sr-only">{{ detail.task.key }} 작업 상세</DialogDescription>
            <div v-if="detail.task.minutesId" class="flex min-w-0">
              <MinutesSourceChip :minutes-id="detail.task.minutesId" />
            </div>
          </header>

          <section class="flex flex-col gap-1.5">
            <span class="text-xs font-medium">내용</span>
            <!-- 스냅샷을 다시 받으면(쓰기 실패로 되돌릴 때) 편집기도 서버 값으로 다시 선다 -->
            <TaskBodyEditor
              :key="`${detail.task.id}:${data.snapshotRevision}`"
              :lines="detail.task.body"
              @change="saveBody"
            />
          </section>

          <TaskRelated
            :task-id="detail.task.id"
            :related="detail.related"
            @open-task="(id) => emit('open-task', id)"
          />

          <TaskDependencies :task-id="detail.task.id" @open-task="(id) => emit('open-task', id)" />

          <TaskLinks
            :threads="detail.threads"
            :thread-choices="threadChoices"
            @link-thread="(id) => taskStore.linkThread(detail!.task.id, id)"
            @unlink-thread="(id) => taskStore.unlinkThread(detail!.task.id, id)"
            @open-thread="(id) => emit('open-thread', id)"
          />

          <TaggedTests kind="task" :ref-id="detail.task.id" />

          <div class="h-px bg-border" />
          <TaskComments :task-id="detail.task.id" />

          <div class="h-px bg-border" />
          <HistorySection kind="task" :target-id="detail.task.id" />
        </div>

        <TaskPropertyPanel
          v-model:start="startDraft"
          v-model:due="dueDraft"
          :status="detail.task.status"
          :owner-id="detail.task.ownerId"
          :priority="detail.task.priority"
          :part-id="detail.task.partId"
          :status-since="statusSinceLabel(detail.task)"
          show-done
          @update:status="(v) => taskStore.setStatus(detail!.task.id, v)"
          @update:owner-id="(v) => taskStore.setOwner(detail!.task.id, v)"
          @update:priority="(v) => taskStore.setPriority(detail!.task.id, v)"
          @update:part-id="(v) => taskStore.setPart(detail!.task.id, v)"
          @update:start="commitPeriod"
          @update:due="commitPeriod"
        >
          <div class="h-px bg-border" />
          <dl class="flex flex-col gap-2 px-0.5 text-xs">
            <div class="flex gap-2">
              <dt class="w-[72px] shrink-0 text-muted-foreground">연관 안건</dt>
              <dd>{{ detail.threads.length }}건</dd>
            </div>
            <div class="flex gap-2">
              <dt class="w-[72px] shrink-0 text-muted-foreground">만든 날짜</dt>
              <dd>{{ monthDay(detail.task.createdAt) }}</dd>
            </div>
          </dl>
        </TaskPropertyPanel>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
