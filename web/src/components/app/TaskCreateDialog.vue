<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ListTree, X } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogDescription, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { parseTaskBody, TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS } from '@/lib/task'
import { useDataStore } from '@/stores/data'
import { useTaskStore } from '@/stores/task'
import { useThreadStore } from '@/stores/thread'
import type { TaskPriority, TaskStatus } from '@/types/domain'

/* 작업 추가 — 목록 위 팝업. 세 탭(목록 · 간트 · 칸반) 어디서든 같은 폼이 뜬다.
   고른 값은 이름이 아니라 id 로 들고 다닌다 (parentId · ownerId · threadIds). */
const props = defineProps<{ parentId: string | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ (e: 'created', id: string): void }>()

const data = useDataStore()
const taskStore = useTaskStore()
const threadStore = useThreadStore()

const NONE = 'none'

const parent = ref(NONE)
const title = ref('')
const bodyText = ref('')
const start = ref('')
const due = ref('')
const undated = ref(false)
const status = ref<TaskStatus>('todo')
const priority = ref<TaskPriority>('normal')
const owner = ref(NONE)
const picked = ref<string[]>([])
const keepOpen = ref(false)

function resetForm() {
  parent.value = props.parentId ?? NONE
  title.value = ''
  bodyText.value = ''
  start.value = ''
  due.value = ''
  undated.value = false
  status.value = 'todo'
  priority.value = 'normal'
  owner.value = NONE
  picked.value = []
}

/* 하위 작업 추가로 들어오면 상위 작업이 채워진 채로 열린다 */
watch(
  () => [open.value, props.parentId] as const,
  ([isOpen]) => {
    if (isOpen) resetForm()
  },
  { immediate: true },
)

const parentHint = computed(() => {
  if (parent.value === NONE) return '목록 맨 위 단계에 섭니다'
  const label = taskStore.parentOptions.find((o) => o.id === parent.value)?.label
  return label ? `${label} 아래로 들어갑니다` : ''
})

const ownerName = computed(() => data.memberName(owner.value === NONE ? null : owner.value))

const pickedThreads = computed(() =>
  picked.value
    .map((id) => threadStore.threads.find((t) => t.id === id))
    .filter((t) => t !== undefined),
)

const threadChoices = computed(() =>
  threadStore.threads.filter((t) => !picked.value.includes(t.id)),
)

function pickThread(id: string) {
  if (!picked.value.includes(id)) picked.value = [...picked.value, id]
}

function dropThread(id: string) {
  picked.value = picked.value.filter((t) => t !== id)
}

const canSubmit = computed(() => title.value.trim() !== '')

function submit() {
  if (!canSubmit.value) return
  const id = taskStore.addTask({
    title: title.value.trim(),
    parentId: parent.value === NONE ? null : parent.value,
    body: parseTaskBody(bodyText.value),
    status: status.value,
    ownerId: owner.value === NONE ? null : owner.value,
    start: undated.value ? null : start.value || null,
    due: undated.value ? null : due.value || null,
    priority: priority.value,
    threadIds: [...picked.value],
  })
  /* 만들고 계속 추가 — 폼만 비우고 팝업은 열어 둔다 */
  if (keepOpen.value) {
    resetForm()
    return
  }
  emit('created', id)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogScrollContent class="max-w-[760px] gap-0 p-0">
      <div class="flex items-center gap-2.5 border-b border-border px-5 py-3.5 pr-[60px]">
        <DialogTitle class="text-sm font-semibold tracking-tight">작업 추가</DialogTitle>
        <DialogDescription class="text-xs text-muted-foreground">
          {{ data.currentProject.name }}
        </DialogDescription>
      </div>

      <div class="flex flex-col gap-4 px-5 py-[18px]">
        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground">상위 작업</span>
          <div class="flex items-center gap-2">
            <Select v-model="parent">
              <SelectTrigger class="h-8 grow text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="NONE">없음 (최상위 작업으로 만듭니다)</SelectItem>
                <SelectItem v-for="o in taskStore.parentOptions" :key="o.id" :value="o.id">
                  {{ o.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <span class="shrink-0 text-xs text-muted-foreground">{{ parentHint }}</span>
          </div>
        </div>

        <label class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground">제목</span>
          <Input v-model="title" placeholder="예: 보험료 산출 기간계 API 개발" />
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground">내용</span>
            <span class="text-xs text-muted-foreground">
              [] 로 시작하면 체크박스, - 로 시작하면 불릿이 됩니다
            </span>
          </span>
          <Textarea
            v-model="bodyText"
            :rows="5"
            class="leading-relaxed"
            placeholder="[] 서버 신청서 제출&#10;[] 개발자 접속 계정 만들기&#10;- 방화벽은 정보보안팀에 따로 신청"
          />
        </label>

        <div class="grid grid-cols-2 gap-3.5">
          <label class="flex flex-col gap-1.5">
            <span class="text-xs text-muted-foreground">시작 날짜</span>
            <Input v-model="start" type="date" class="h-8 text-xs" :disabled="undated" />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-xs text-muted-foreground">기한</span>
            <Input v-model="due" type="date" class="h-8 text-xs" :disabled="undated" />
          </label>
        </div>

        <label class="flex items-center gap-2">
          <Checkbox :model-value="undated" @update:model-value="(v) => (undated = v === true)" />
          <span class="text-xs text-muted-foreground">
            기간은 아직 못 정했습니다 — 간트차트에 막대 없이 목록에만 섭니다
          </span>
        </label>

        <div class="grid grid-cols-2 gap-3.5">
          <div class="flex flex-col gap-1.5">
            <span class="text-xs text-muted-foreground">상태</span>
            <Select v-model="status">
              <SelectTrigger class="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="o in TASK_STATUS_OPTIONS" :key="o.value" :value="o.value">
                  {{ o.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex flex-col gap-1.5">
            <span class="text-xs text-muted-foreground">우선순위</span>
            <div class="flex gap-1.5">
              <button
                v-for="p in TASK_PRIORITY_OPTIONS"
                :key="p.value"
                type="button"
                class="inline-flex h-8 grow items-center justify-center rounded-md border text-xs transition-colors"
                :class="
                  priority === p.value
                    ? 'border-primary bg-primary font-medium text-primary-foreground shadow'
                    : 'border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'
                "
                @click="priority = p.value"
              >
                {{ p.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground">담당자</span>
          <div class="flex items-center gap-2">
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs"
              :class="ownerName ? '' : 'text-muted-foreground'"
            >
              {{ ownerName ? ownerName.charAt(0) : '–' }}
            </span>
            <Select v-model="owner">
              <SelectTrigger class="h-8 w-[240px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="NONE">미정 (담당자 없음)</SelectItem>
                <SelectItem v-for="m in data.allMembers" :key="m.id" :value="m.id">
                  {{ m.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <span v-if="owner === NONE" class="text-xs text-muted-foreground"
              >나중에 정해도 됩니다</span
            >
          </div>
        </div>

        <section
          class="flex flex-col gap-2 rounded-md border border-border bg-muted/50 px-3.5 py-3"
        >
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium tracking-wider text-muted-foreground">연관 안건</span>
            <span class="text-xs text-muted-foreground">
              이 작업을 하려면 먼저 정해야 하는 것이 있으면 여기서 겁니다
            </span>
          </div>

          <div class="flex items-center gap-2">
            <Select :model-value="''" @update:model-value="(v) => pickThread(String(v))">
              <SelectTrigger class="h-8 grow bg-background text-xs">
                <span class="text-muted-foreground">안건 고르기…</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="t in threadChoices" :key="t.id" :value="t.id">
                  {{ t.title }}
                </SelectItem>
              </SelectContent>
            </Select>
            <span class="shrink-0 text-xs text-muted-foreground">
              {{ picked.length === 0 ? '없어도 됩니다' : `${picked.length}건 골랐습니다` }}
            </span>
          </div>

          <div v-if="pickedThreads.length" class="flex flex-col gap-1.5">
            <div
              v-for="t in pickedThreads"
              :key="t.id"
              class="flex min-h-[34px] items-center gap-2.5 rounded-md border border-border bg-background px-2.5"
            >
              <ListTree class="size-3 shrink-0 text-muted-foreground" />
              <span class="min-w-0 grow truncate text-xs">{{ t.title }}</span>
              <button
                type="button"
                class="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-accent"
                :aria-label="`${t.title} 빼기`"
                @click="dropThread(t.id)"
              >
                <X class="size-3.5 text-muted-foreground" />
              </button>
            </div>
          </div>

          <p v-if="picked.length" class="text-xs text-destructive">
            {{ picked.length }}건을 걸었습니다. 그 안건이 정해지기 전까지는 상태를 막힘으로 두면
            칸반의 막힘 칸에 섭니다.
          </p>
        </section>
      </div>

      <div class="flex items-center gap-2.5 border-t border-border bg-muted/50 px-5 py-3">
        <label class="flex items-center gap-2">
          <Checkbox :model-value="keepOpen" @update:model-value="(v) => (keepOpen = v === true)" />
          <span class="text-xs text-muted-foreground">만들고 계속 추가</span>
        </label>
        <div class="grow" />
        <span v-if="!canSubmit" class="text-xs text-muted-foreground"
          >제목을 적어야 만들 수 있습니다</span
        >
        <Button variant="outline" size="sm" @click="open = false">취소</Button>
        <Button size="sm" :disabled="!canSubmit" @click="submit">만들기</Button>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
