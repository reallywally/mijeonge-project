<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronRight, FolderClosed } from 'lucide-vue-next'
import TaskBodyEditor from '@/components/app/TaskBodyEditor.vue'
import TaskLinks from '@/components/app/TaskLinks.vue'
import TaskPropertyPanel from '@/components/app/TaskPropertyPanel.vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogDescription, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { periodProblem } from '@/lib/task'
import { fitTextarea } from '@/lib/utils'
import { useDataStore } from '@/stores/data'
import { useTaskStore } from '@/stores/task'
import { useThreadStore } from '@/stores/thread'
import type { TaskLine, TaskPriority, TaskStatus, Thread } from '@/types/domain'

/* 작업 추가 — 작업 상세와 같은 모양의 팝업이다. 세 탭(목록 · 간트 · 칸반) 어디서든 같은 것이 뜬다.
   상세는 고치는 즉시 들어가지만 여기는 아직 작업이 없으니 골라 두었다가 '만들기'로 한꺼번에 넣는다.
   하위 작업은 만든 뒤 상세에서 붙인다 — 만들면 바로 그 작업의 상세로 넘어간다.
   initialStatus 는 칸반의 칸마다 있는 '작업 추가' 가 그 칸의 상태로 열려고 넘긴다. */
const props = defineProps<{ parentId: string | null; initialStatus?: TaskStatus | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ (e: 'created', id: string): void }>()

const data = useDataStore()
const taskStore = useTaskStore()
const threadStore = useThreadStore()

const title = ref('')
const body = ref<TaskLine[]>([])
const status = ref<TaskStatus>('todo')
const ownerId = ref<string | null>(null)
const start = ref('')
const due = ref('')
const priority = ref<TaskPriority>('normal')
const parent = ref<string | null>(null)
const threadIds = ref<string[]>([])
const keepOpen = ref(false)
const saving = ref(false)
/* 본문 편집기는 자기 줄을 들고 있으니, 폼을 비울 때는 새로 띄운다 */
const bodyKey = ref(0)

const titleField = ref<HTMLTextAreaElement | null>(null)
const fitTitle = () => fitTextarea(titleField.value)

async function focusTitle() {
  await nextTick()
  titleField.value?.focus()
}

function resetForm() {
  title.value = ''
  body.value = []
  status.value = props.initialStatus ?? 'todo'
  ownerId.value = null
  start.value = ''
  due.value = ''
  priority.value = 'normal'
  parent.value = props.parentId
  threadIds.value = []
  bodyKey.value += 1
  void nextTick(fitTitle)
}

/* 하위 작업 추가로 들어오면 상위 작업이 채워진 채로 열린다 */
watch(
  () => [open.value, props.parentId, props.initialStatus] as const,
  ([isOpen]) => {
    if (isOpen) resetForm()
  },
  { immediate: true },
)

/* 골라 둔 안건 — 상세의 표와 같은 줄 모양으로 보여 준다 */
const pickedThreads = computed(() =>
  threadIds.value
    .map((id) => threadStore.threads.find((t) => t.id === id))
    .filter((t): t is Thread => t !== undefined)
    .map(taskStore.threadRow),
)
const threadChoices = computed(() =>
  threadStore.threads.filter((t) => !threadIds.value.includes(t.id)),
)

const toggle = (list: string[], id: string, on: boolean) =>
  on ? (list.includes(id) ? list : [...list, id]) : list.filter((x) => x !== id)

const parentPath = computed(() => {
  const label = taskStore.parentOptions.find((o) => o.id === parent.value)?.label
  return label ? `${label} 아래로 들어갑니다` : '최상위 작업으로 만듭니다'
})

const blocker = computed(() => {
  if (!title.value.trim()) return '제목을 적어야 만들 수 있습니다'
  return periodProblem(start.value, due.value)
})

async function submit() {
  if (saving.value) return
  if (blocker.value) {
    if (!title.value.trim()) void focusTitle()
    return
  }
  saving.value = true
  const id = await taskStore.addTask({
    title: title.value.trim(),
    parentId: parent.value,
    body: body.value,
    status: status.value,
    ownerId: ownerId.value,
    start: start.value || null,
    due: due.value || null,
    priority: priority.value,
    threadIds: [...threadIds.value],
  })
  saving.value = false
  /* 실패는 스토어가 알렸다 — 폼을 그대로 두어 다시 누를 수 있게 한다 */
  if (!id) return
  /* 만들고 계속 추가 — 폼만 비우고 팝업은 열어 둔다 */
  if (keepOpen.value) {
    resetForm()
    void focusTitle()
    return
  }
  emit('created', id)
}

function onTitleKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  /* 제목은 한 줄이다 — Enter 는 줄을 바꾸지 않고 본문으로 넘어간다 */
  if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    ;(document.querySelector('[data-task-body] textarea') as HTMLTextAreaElement | null)?.focus()
  }
}

/* 어디서든 ⌘/Ctrl + Enter 로 만든다 */
function onKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogScrollContent
      class="max-w-[1140px] gap-0 p-0"
      @open-auto-focus.prevent="focusTitle"
      @keydown="onKeydown"
    >
      <div class="flex items-center gap-2 border-b border-border px-[22px] py-3.5 pr-[60px]">
        <FolderClosed class="size-3.5 text-muted-foreground" />
        <span class="text-xs text-muted-foreground">{{ data.currentProject?.name }}</span>
        <ChevronRight class="size-3 text-muted-foreground" />
        <span class="text-xs text-muted-foreground">작업</span>
        <ChevronRight class="size-3 text-muted-foreground" />
        <DialogTitle class="text-xs font-normal">작업 추가</DialogTitle>
      </div>

      <div class="flex items-stretch">
        <div class="flex min-w-0 grow flex-col gap-6 px-[22px] pt-4 pb-6">
          <header class="flex flex-col gap-1">
            <textarea
              ref="titleField"
              v-model="title"
              rows="1"
              aria-label="제목"
              placeholder="작업 제목"
              class="-mx-2 resize-none overflow-hidden [field-sizing:content] rounded-md border border-transparent bg-transparent px-2 py-1 text-xl leading-snug font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60 hover:border-border focus:border-input"
              @input="fitTitle"
              @keydown="onTitleKeydown"
            />
            <DialogDescription class="text-xs text-muted-foreground">
              {{ parentPath }}
            </DialogDescription>
          </header>

          <section class="flex flex-col gap-1.5" data-task-body>
            <span class="text-xs font-medium">내용</span>
            <TaskBodyEditor :key="bodyKey" :lines="body" @change="(lines) => (body = lines)" />
          </section>

          <TaskLinks
            :threads="pickedThreads"
            :thread-choices="threadChoices"
            :navigable="false"
            @link-thread="(id) => (threadIds = toggle(threadIds, id, true))"
            @unlink-thread="(id) => (threadIds = toggle(threadIds, id, false))"
          />
        </div>

        <TaskPropertyPanel
          v-model:status="status"
          v-model:owner-id="ownerId"
          v-model:start="start"
          v-model:due="due"
          v-model:priority="priority"
          v-model:parent-id="parent"
          :parent-choices="taskStore.parentOptions"
        >
          <p
            v-if="threadIds.length && status !== 'blocked'"
            class="rounded-md border border-border bg-background px-3 py-2.5 text-xs leading-relaxed text-muted-foreground text-pretty"
          >
            안건을 {{ threadIds.length }}건 걸었습니다. 그 안건이 정해지기 전까지 상태를 막힘으로
            두면 칸반의 막힘 칸에 섭니다.
          </p>
        </TaskPropertyPanel>
      </div>

      <div class="flex items-center gap-2.5 border-t border-border bg-muted/50 px-5 py-3">
        <label class="flex items-center gap-2">
          <Checkbox :model-value="keepOpen" @update:model-value="(v) => (keepOpen = v === true)" />
          <span class="text-xs text-muted-foreground">만들고 계속 추가</span>
        </label>
        <div class="grow" />
        <span class="text-xs text-muted-foreground">{{ blocker || '⌘ / Ctrl + Enter' }}</span>
        <Button variant="outline" size="sm" @click="open = false">취소</Button>
        <Button size="sm" :disabled="!!blocker || saving" @click="submit">
          {{ saving ? '만드는 중…' : '만들기' }}
        </Button>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
