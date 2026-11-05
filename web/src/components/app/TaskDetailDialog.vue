<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronRight, FolderClosed, Loader2, Lock, Plus, Trash2 } from 'lucide-vue-next'
import { ApiError } from '@/api'
import CommentThread from '@/components/app/CommentThread.vue'
import HistorySection from '@/components/app/HistorySection.vue'
import MinutesSourceChip from '@/components/app/MinutesSourceChip.vue'
import TaggedTests from '@/components/app/TaggedTests.vue'
import TaskBodyEditor from '@/components/app/TaskBodyEditor.vue'
import TaskLinks from '@/components/app/TaskLinks.vue'
import AgendaCreateDialog from '@/components/app/AgendaCreateDialog.vue'
import TaskPropertyPanel from '@/components/app/TaskPropertyPanel.vue'
import TaskStatusBadge from '@/components/app/TaskStatusBadge.vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { monthDay } from '@/lib/date'
import { toastError } from '@/lib/notify'
import {
  MAX_TASK_DEPTH,
  periodProblem,
  READONLY_HINT,
  statusSinceLabel,
  TASK_STATUS_OPTIONS,
  taskStatusLabel,
} from '@/lib/task'
import { fitTextarea } from '@/lib/utils'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import { useTaskStore } from '@/stores/task'
import { useAgendaStore } from '@/stores/agenda'
import type { TaskLine, TaskStatus } from '@/types/domain'

/* 작업 상세 — 목록 위 팝업. 보는 자리가 곧 고치는 자리다: 칸을 눌러 고치면 그 값이 바로 들어가고
   따로 저장 버튼이 없다. 왼쪽이 제목 · 본문 · 하위 작업 · 연결, 오른쪽이 속성이다.
   안건 맵핑은 memo 의 연관 관계대로 여기서만 한다. 그 아래 댓글, 맨 아래가 접어 둔 변경 이력이다.
   고치기는 작성자 · 담당자 · 관리자만 — 아니면 칸을 잠그고 보기만 한다(댓글은 누구나 쓴다) */
const props = defineProps<{ taskId: string | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  (e: 'open-task', id: string): void
  (e: 'open-agenda', id: string): void
}>()

const data = useDataStore()
const taskStore = useTaskStore()
const partStore = usePartStore()
const agendaStore = useAgendaStore()

const detail = computed(() => (props.taskId ? taskStore.taskDetail(props.taskId) : null))
const canEdit = computed(() => (detail.value ? taskStore.canEdit(detail.value.task) : false))
const canDelete = computed(() => (detail.value ? taskStore.canDelete(detail.value.task) : false))
/* 지우기 확인 다이얼로그 — 아래 watch 가 작업을 옮길 때 닫으므로 먼저 둔다 */
const confirmOpen = ref(false)
const deleting = ref(false)
const deleteError = ref('')

/* 제목 — Enter 나 벗어나면 들어가고, Esc 는 되돌린다. 비우면 원래 제목으로 돌아간다 */
const titleDraft = ref('')
const titleField = ref<HTMLTextAreaElement | null>(null)

const fitTitle = () => fitTextarea(titleField.value)

/* 팝업이 열려 칸이 붙는 순간에도 긴 제목이 잘리지 않게 높이를 맞춘다 */
watch(titleField, fitTitle)

function commitTitle() {
  if (!props.taskId) return
  if (canEdit.value && titleDraft.value.trim()) taskStore.setTitle(props.taskId, titleDraft.value)
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
  if (props.taskId && canEdit.value) taskStore.setBody(props.taskId, lines)
}

/* 기간 — 둘 다 있거나 둘 다 없어야 기간이다(간트의 규칙). 한쪽만 적은 동안은 여기서 들고 있다가
   짝이 맞으면 넣는다. 그래야 시작을 먼저 고르고 기한을 고르는 동안 값이 날아가지 않는다. */
const startDraft = ref('')
const dueDraft = ref('')

function commitPeriod() {
  if (!props.taskId || !canEdit.value) return
  const start = startDraft.value
  const due = dueDraft.value
  if (!periodProblem(start, due)) taskStore.setPeriod(props.taskId, start || null, due || null)
}

const parentChoices = computed(() => (props.taskId ? taskStore.parentOptionsFor(props.taskId) : []))

/* 하위 작업 추가 — 팝업을 띄우지 않고 제목만 받아 바로 만든다.
   나머지는 작업 추가의 기본값(해야 할 일 · 보통 · 담당자 · 기간 미정)으로 서고, 파트는 상위의 것이다.
   Enter 로 만들고 칸은 남겨 두어 이어서 적는다. Esc 나 빈 칸으로 벗어나면 닫는다. */
const subOpen = ref(false)
const subTitle = ref('')
const subInput = ref<InstanceType<typeof Input> | null>(null)
/* 서버가 만들어 돌려줄 때까지 Enter 를 또 받지 않는다 — 같은 작업이 두 번 생긴다 */
const subSaving = ref(false)

async function openSubtask() {
  subOpen.value = true
  await nextTick()
  ;(subInput.value?.$el as HTMLInputElement | undefined)?.focus()
}

function closeSubtask() {
  subOpen.value = false
  subTitle.value = ''
}

async function addSubtask(e: KeyboardEvent) {
  /* 한글 조합 중의 Enter 는 글자를 맺는 키다 — 그때 만들면 마지막 글자가 다음 칸으로 샌다 */
  if (e.isComposing || subSaving.value) return
  const title = subTitle.value.trim()
  if (!props.taskId || !title) return
  subSaving.value = true
  const id = await taskStore.addTask({
    title,
    parentId: props.taskId,
    body: [],
    status: 'todo',
    ownerId: null,
    start: null,
    due: null,
    priority: 'normal',
    agendaIds: [],
    partId: partStore.partForChildOf(props.taskId),
  })
  subSaving.value = false
  if (id) subTitle.value = ''
}

/* 다른 작업으로 옮기거나 팝업을 다시 열면 칸들을 그 작업의 값으로 채운다 */
watch(
  [() => props.taskId, open],
  () => {
    const task = detail.value?.task
    titleDraft.value = task?.title ?? ''
    startDraft.value = task?.start ?? ''
    dueDraft.value = task?.due ?? ''
    closeSubtask()
    confirmOpen.value = false
    void nextTick(fitTitle)
  },
  { immediate: true },
)

const subPct = computed(() => {
  const d = detail.value
  if (!d || d.children.length === 0) return 0
  return Math.round((d.doneChildCount / d.children.length) * 100)
})

/* 지우기 — 확인을 받고 루트와 모든 후손을 줄기째 지운다. 후손 가운데 못 지우는 것이 있으면 버튼을 막는다.
   그사이 못 지우는 하위가 달려 403 이 오면 이유를 띄우고 스냅샷을 다시 받아 하위를 보인다 */
const descendants = computed(() => (props.taskId ? taskStore.descendants(props.taskId) : []))
const blockedByDescendant = computed(() =>
  detail.value ? !taskStore.canDeleteTree(detail.value.task) : false,
)
/* 확인 다이얼로그에 늘어놓는 하위 — 많으면 앞의 몇 개만 두고 '외 N개' */
const SHOWN_DESCENDANTS = 5
const shownDescendants = computed(() => descendants.value.slice(0, SHOWN_DESCENDANTS))
const moreDescendants = computed(() => descendants.value.length - shownDescendants.value.length)

function askDelete() {
  deleteError.value = ''
  confirmOpen.value = true
}

async function removeTask() {
  const task = detail.value?.task
  if (!task || deleting.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await taskStore.deleteTask(task.id)
    confirmOpen.value = false
    open.value = false
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      deleteError.value = '지울 권한이 없는 하위 작업이 있어 지우지 못했습니다.'
      void data.reloadSnapshot()
    } else {
      confirmOpen.value = false
      toastError(e)
    }
  } finally {
    deleting.value = false
  }
}

/* 아직 안 건 안건 — 검색 칸이 이 안에서 찾는다 */
const agendaChoices = computed(() => {
  const linked = new Set(detail.value?.agendas.map((t) => t.agenda.id))
  return agendaStore.agendas.filter((t) => !linked.has(t.id))
})

/* 찾는 안건이 없으면 안건 추가 팝업을 이 위에 띄운다 — 적은 제목을 채워 열고, 설명 · 결정내용 · 상태까지
   여기서 적는다(안건 화면에 다녀오지 않게). 만들면 이 작업에 건다 */
const newAgendaOpen = ref(false)
const newAgendaTitle = ref('')

function createAgenda(title: string) {
  newAgendaTitle.value = title
  newAgendaOpen.value = true
}

function onAgendaCreated(id: string) {
  newAgendaOpen.value = false
  const taskId = detail.value?.task.id
  if (taskId) taskStore.linkAgenda(taskId, id)
}
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
        <span v-if="canEdit" class="text-xs text-muted-foreground">고치면 바로 저장됩니다</span>
        <span
          v-else
          class="flex items-center gap-1.5 text-xs text-muted-foreground"
          data-task-readonly
        >
          <Lock class="size-3" />
          {{ READONLY_HINT }}
        </span>
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
              :readonly="!canEdit"
              class="-mx-2 resize-none overflow-hidden [field-sizing:content] rounded-md border border-transparent bg-transparent px-2 py-1 text-xl leading-snug font-semibold tracking-tight outline-none"
              :class="canEdit ? 'hover:border-border focus:border-input' : ''"
              @input="fitTitle"
              @keydown="onTitleKeydown"
              @blur="commitTitle"
            />
            <DialogDescription as-child>
              <button
                type="button"
                class="self-start text-xs text-muted-foreground underline-offset-4 enabled:hover:underline"
                :disabled="!detail.parent"
                @click="detail.parent && emit('open-task', detail.parent.id)"
              >
                {{ detail.pathLabel }}
              </button>
            </DialogDescription>
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
              :readonly="!canEdit"
              @change="saveBody"
            />
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
                  :disabled="!taskStore.canEdit(child.task)"
                  @update:model-value="(v) => taskStore.setStatus(child.task.id, v as TaskStatus)"
                >
                  <SelectTrigger
                    class="h-7 w-[120px] shrink-0 justify-start gap-0.5 rounded-full border-transparent bg-transparent px-0 pr-1 shadow-none hover:border-transparent enabled:hover:bg-muted focus:ring-[3px] disabled:cursor-default disabled:opacity-100"
                    :aria-label="`상태 ${taskStatusLabel(child.task.status)}`"
                  >
                    <TaskStatusBadge :status="child.task.status" />
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

              <div v-if="subOpen" class="flex min-h-[38px] items-center gap-2 px-2 py-1">
                <Plus class="ml-1 size-3.5 shrink-0 text-muted-foreground" />
                <Input
                  ref="subInput"
                  v-model="subTitle"
                  placeholder="하위 작업 제목을 적고 Enter"
                  class="h-7 grow text-[13px]"
                  @keydown.enter.prevent="addSubtask"
                  @keydown.esc.stop.prevent="closeSubtask"
                  @blur="!subTitle.trim() && closeSubtask()"
                />
              </div>
              <p
                v-else-if="!taskStore.canAddChild(detail.task.id)"
                class="flex min-h-[34px] items-center gap-1.5 px-3 text-xs text-muted-foreground"
                data-subtask-limit
              >
                작업은 {{ MAX_TASK_DEPTH }}단까지라 이 밑에는 하위 작업을 더 둘 수 없습니다.
              </p>
              <button
                v-else
                type="button"
                class="flex min-h-[34px] items-center gap-1.5 px-3 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                @click="openSubtask"
              >
                <Plus class="size-3.5" />
                하위 작업 추가
              </button>
            </div>
          </section>

          <TaskLinks
            :agendas="detail.agendas"
            :agenda-choices="agendaChoices"
            :readonly="!canEdit"
            @link-agenda="(id) => taskStore.linkAgenda(detail!.task.id, id)"
            @unlink-agenda="(id) => taskStore.unlinkAgenda(detail!.task.id, id)"
            @create-agenda="createAgenda"
            @open-agenda="(id) => emit('open-agenda', id)"
          />

          <TaggedTests kind="task" :ref-id="detail.task.id" />

          <div class="h-px bg-border" />
          <CommentThread kind="task" :target-id="detail.task.id" />

          <div class="h-px bg-border" />
          <HistorySection kind="task" :target-id="detail.task.id" />
        </div>

        <TaskPropertyPanel
          v-model:start="startDraft"
          v-model:due="dueDraft"
          :status="detail.task.status"
          :owner-id="detail.task.ownerId"
          :priority="detail.task.priority"
          :parent-id="detail.task.parentId"
          :part-id="detail.task.partId"
          :parent-choices="parentChoices"
          :status-since="statusSinceLabel(detail.task)"
          show-done
          :readonly="!canEdit"
          @update:status="(v) => taskStore.setStatus(detail!.task.id, v)"
          @update:owner-id="(v) => taskStore.setOwner(detail!.task.id, v)"
          @update:priority="(v) => taskStore.setPriority(detail!.task.id, v)"
          @update:parent-id="(v) => taskStore.setParent(detail!.task.id, v)"
          @update:part-id="(v) => taskStore.setPart(detail!.task.id, v)"
          @update:start="commitPeriod"
          @update:due="commitPeriod"
        >
          <div class="h-px bg-border" />
          <dl class="flex flex-col gap-2 px-0.5 text-xs">
            <div class="flex gap-2">
              <dt class="w-[72px] shrink-0 text-muted-foreground">연관 안건</dt>
              <dd>{{ detail.agendas.length }}건</dd>
            </div>
            <div class="flex gap-2">
              <dt class="w-[72px] shrink-0 text-muted-foreground">작성자</dt>
              <dd data-task-creator>{{ data.memberName(detail.task.creatorId) ?? '—' }}</dd>
            </div>
            <div class="flex gap-2">
              <dt class="w-[72px] shrink-0 text-muted-foreground">만든 날짜</dt>
              <dd>{{ monthDay(detail.task.createdAt) }}</dd>
            </div>
          </dl>
          <template v-if="canDelete">
            <div class="grow" />
            <div class="flex flex-col gap-1">
              <Button
                variant="ghost"
                size="sm"
                class="self-start text-destructive hover:text-destructive"
                :disabled="blockedByDescendant"
                data-task-delete
                @click="askDelete"
              >
                <Trash2 class="size-3.5" />
                작업 지우기
              </Button>
              <p
                v-if="blockedByDescendant"
                class="px-0.5 text-xs text-muted-foreground"
                data-delete-reason
              >
                지울 수 없는 하위 작업이 있어 지울 수 없습니다.
              </p>
            </div>
          </template>
        </TaskPropertyPanel>
      </div>

      <Dialog v-model:open="confirmOpen">
        <DialogContent class="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{{ detail.task.key }} 작업을 지울까요?</DialogTitle>
            <DialogDescription class="text-pretty">
              <template v-if="descendants.length">
                <strong class="font-medium text-destructive" data-delete-descendant-count>
                  하위 작업 {{ descendants.length }}개도 함께 지워집니다.
                </strong>
                본문 · 댓글 · 안건 연결까지 모두 지워지고 되돌릴 수 없습니다.
              </template>
              <template v-else
                >본문 · 댓글 · 안건 연결도 함께 지워지고 되돌릴 수 없습니다.</template
              >
            </DialogDescription>
          </DialogHeader>
          <ul
            v-if="descendants.length"
            class="flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
            data-delete-descendants
          >
            <li v-for="t in shownDescendants" :key="t.id" class="flex min-w-0 gap-2">
              <span class="shrink-0 text-muted-foreground tabular-nums">{{ t.key }}</span>
              <span class="truncate">{{ t.title }}</span>
            </li>
            <li v-if="moreDescendants > 0" class="text-muted-foreground" data-delete-more>
              외 {{ moreDescendants }}개
            </li>
          </ul>
          <p v-if="deleteError" class="text-sm text-destructive" data-delete-error>
            {{ deleteError }}
          </p>
          <DialogFooter>
            <Button variant="outline" @click="confirmOpen = false">취소</Button>
            <Button
              variant="destructive"
              :disabled="deleting"
              data-delete-confirm
              @click="removeTask"
            >
              <Loader2 v-if="deleting" class="animate-spin" />
              {{ descendants.length ? '하위까지 지우기' : '지우기' }}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AgendaCreateDialog
        v-model:open="newAgendaOpen"
        :initial-title="newAgendaTitle"
        :link-note="`만들면 ${detail.task.key} 작업에 연결됩니다`"
        @created="onAgendaCreated"
      />
    </DialogScrollContent>
  </Dialog>
</template>
