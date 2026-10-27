<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronRight, FolderClosed, Plus, Trash2, TriangleAlert } from 'lucide-vue-next'
import EntryKindBadge from '@/components/app/EntryKindBadge.vue'
import OwnerSelect from '@/components/app/OwnerSelect.vue'
import ParentTaskPicker from '@/components/app/ParentTaskPicker.vue'
import PartField from '@/components/app/PartField.vue'
import TestRefs from '@/components/app/TestRefs.vue'
import TestStatusBadge from '@/components/app/TestStatusBadge.vue'
import TestStatusSection from '@/components/app/TestStatusSection.vue'
import TestStepsEditor from '@/components/app/TestStepsEditor.vue'
import { Button } from '@/components/ui/button'
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
import { monthDay } from '@/lib/date'
import { TEST_LEVEL_OPTIONS, testFieldProblems } from '@/lib/testcase'
import { fitTextarea } from '@/lib/utils'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import { useTestStore } from '@/stores/test'
import type { TestLevel, TestRef, TestStatusInput, TestStep } from '@/types/domain'

/* 테스트 상세 · 추가 — 작업 상세와 따로 만든 팝업이다(입력 항목이 다르다, Q55).
   상세(testId)는 보는 자리가 곧 고치는 자리라 칸을 벗어나면 그 값만 바로 들어간다.
   추가(testId = null)는 같은 칸을 채운 뒤 [만들기] 로 한 번에 보낸다 — 늘 작성 중으로 들어간다.
   왼쪽이 제목 · 태그 · 목적 · 사전조건 · 테스트 데이터 · 단계 · 상태 · 기준 바뀜, 오른쪽이 속성이다 */
const props = defineProps<{
  testId: string | null
  /** 추가할 때 미리 채울 것 — 줄의 + 는 상위, 작업 · 안건 상세의 [테스트 추가] 는 태그 */
  initialParentId?: string | null
  initialRefs?: TestRef[]
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  (e: 'open-test', id: string): void
  (e: 'open-task', id: string): void
  (e: 'open-thread', id: string): void
  (e: 'created', id: string): void
}>()

const data = useDataStore()
const partStore = usePartStore()
const testStore = useTestStore()

const isNew = computed(() => props.testId === null)
const test = computed(() => (props.testId ? (testStore.byId[props.testId] ?? null) : null))
const row = computed(() => (test.value ? testStore.toRow(test.value) : null))
/* 다 받았는데 없으면 지워졌거나 못 보는 테스트다 */
const missing = computed(() => !isNew.value && testStore.loaded && !test.value)

/* 칸들 — 상세는 고치는 동안 들고 있다가 벗어날 때 넣고, 추가는 [만들기] 때 모아 보낸다 */
const title = ref('')
const purpose = ref('')
const precondition = ref('')
const testData = ref('')
const level = ref<TestLevel | null>(null)
const ownerId = ref<string | null>(null)
const partId = ref<string | null>(null)
const parentId = ref<string | null>(null)
const start = ref('')
const due = ref('')
const steps = ref<TestStep[]>([])
const refs = ref<TestRef[]>([])
const problems = ref<Record<string, string>>({})
const saving = ref(false)

const titleField = ref<HTMLTextAreaElement | null>(null)
const fitTitle = () => fitTextarea(titleField.value)
watch(titleField, fitTitle)

/** 새 테스트의 파트 — 상위 테스트의 것. 보관한 파트는 새로 달 수 없어 공통으로 둔다 */
function partForChild(parent: string | null) {
  const p = parent ? (testStore.byId[parent]?.partId ?? null) : null
  return p && partStore.parts.find((x) => x.id === p)?.active ? p : null
}

function fill() {
  const t = test.value
  problems.value = {}
  if (t) {
    title.value = t.title
    purpose.value = t.purpose
    precondition.value = t.precondition
    testData.value = t.testData
    level.value = t.level
    ownerId.value = t.ownerId
    partId.value = t.partId
    parentId.value = t.parentId
    start.value = t.start ?? ''
    due.value = t.due ?? ''
    steps.value = t.steps.map((s) => ({ ...s }))
    refs.value = [...t.refs]
  } else if (isNew.value) {
    title.value = ''
    purpose.value = ''
    precondition.value = ''
    testData.value = ''
    level.value = null
    ownerId.value = null
    parentId.value = props.initialParentId ?? null
    partId.value = partForChild(parentId.value)
    start.value = ''
    due.value = ''
    steps.value = []
    refs.value = [...(props.initialRefs ?? [])]
  }
  void nextTick(fitTitle)
}

watch([() => props.testId, open, () => test.value !== null], fill, { immediate: true })

/* ── 상세: 칸마다 바로 넣는다 ── */

function commitTitle() {
  const t = test.value
  if (!t) return
  const next = title.value.trim()
  if (next && next !== t.title) void testStore.patch(t.id, { title: next })
  title.value = next || t.title
  void nextTick(fitTitle)
}

function onTitleKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'Enter') {
    e.preventDefault()
    ;(e.target as HTMLTextAreaElement).blur()
  } else if (e.key === 'Escape' && test.value) {
    /* 팝업까지 닫히지 않게 여기서 멈춘다 */
    e.stopPropagation()
    e.preventDefault()
    title.value = test.value.title
    ;(e.target as HTMLTextAreaElement).blur()
  }
}

type TextKey = 'purpose' | 'precondition' | 'testData'
const textRefs = { purpose, precondition, testData }

function commitText(key: TextKey) {
  const t = test.value
  if (!t) return
  const value = textRefs[key].value
  if (value !== t[key]) void testStore.patch(t.id, { [key]: value })
}

function setLevel(value: string) {
  level.value = value === 'none' ? null : (value as TestLevel)
  if (test.value && level.value !== test.value.level)
    void testStore.patch(test.value.id, { level: level.value })
}

watch(ownerId, (v) => {
  if (test.value && v !== test.value.ownerId) void testStore.patch(test.value.id, { ownerId: v })
})
watch(partId, (v) => {
  if (test.value && v !== test.value.partId) void testStore.patch(test.value.id, { partId: v })
})
watch(parentId, (v) => {
  if (test.value && v !== test.value.parentId) void testStore.patch(test.value.id, { parentId: v })
  /* 추가에서 상위를 바꾸면 파트도 그 상위를 따른다 */
  if (isNew.value) partId.value = partForChild(v)
})

const periodHint = computed(() =>
  start.value && due.value && start.value > due.value ? '기한이 시작 날짜보다 앞섭니다' : '',
)

/* 날짜는 다 고른 뒤(change)에만 넣는다. 한쪽만 있는 기간도 받는다 — 간트에는 둘 다 있어야 막대가 선다 */
function commitPeriod() {
  const t = test.value
  if (!t || periodHint.value) return
  const next = { start: start.value || null, due: due.value || null }
  if (next.start !== t.start || next.due !== t.due) void testStore.patch(t.id, next)
}

const picked = (e: Event) => (e.target as HTMLInputElement).value

/* 단계 — 행동이 빈 줄이 있으면 서버가 받지 않으니 채울 때까지 보내지 않는다 */
const stepHint = ref('')
function onSteps(next: TestStep[]) {
  steps.value = next
  if (!test.value) return
  if (next.some((s) => !s.action.trim())) {
    stepHint.value = '행동을 다 적으면 단계가 저장됩니다.'
    return
  }
  stepHint.value = ''
  void testStore.patch(test.value.id, { steps: next })
}

function addRef(ref: TestRef) {
  if (test.value) void testStore.addRef(test.value.id, ref)
  else refs.value = [...refs.value, ref]
}

function removeRef(ref: TestRef) {
  if (test.value) void testStore.removeRef(test.value.id, ref)
  else refs.value = refs.value.filter((r) => !(r.kind === ref.kind && r.id === ref.id))
}

const shownRefs = computed(() => test.value?.refs ?? refs.value)

function openRef(ref: TestRef) {
  if (ref.kind === 'task') emit('open-task', ref.id)
  else emit('open-thread', ref.id)
}

function setStatus(input: TestStatusInput) {
  if (test.value) void testStore.setStatus(test.value.id, input)
}

/* 기준 바뀜 — 태그로 닿는 안건에 테스트를 확인한 뒤 생긴 결정 줄. 안건 이력처럼 보인다 */
const changedEntries = computed(() =>
  (test.value?.changedEntryIds ?? []).map((id) => {
    const entry = data.allEntries.find((e) => e.id === id) ?? null
    const thread = entry ? (data.allThreads.find((t) => t.id === entry.threadId) ?? null) : null
    return { id, entry, thread }
  }),
)

const parentChoices = computed(() => testStore.parentChoicesFor(props.testId))

const canRemove = computed(() => (test.value ? testStore.canRemove(test.value) : false))

async function remove() {
  const t = test.value
  if (!t) return
  if (!window.confirm(`테스트를 지울까요?\n${t.key} ${t.title}`)) return
  if (await testStore.remove(t.id)) open.value = false
}

/* ── 추가: 모아 보낸다 ── */
async function create() {
  if (saving.value) return
  /* 아무것도 안 적은 단계 줄은 빼고 보낸다 */
  const sent = steps.value.filter((s) => s.action.trim() || s.expected.trim())
  const found = testFieldProblems({
    title: title.value,
    purpose: purpose.value,
    precondition: precondition.value,
    testData: testData.value,
    steps: sent,
    start: start.value || null,
    due: due.value || null,
  })
  problems.value = found
  if (Object.keys(found).length > 0) return
  saving.value = true
  const id = await testStore.create({
    title: title.value.trim(),
    parentId: parentId.value,
    purpose: purpose.value,
    precondition: precondition.value,
    testData: testData.value,
    steps: sent,
    refs: refs.value,
    level: level.value,
    start: start.value || null,
    due: due.value || null,
    ownerId: ownerId.value,
    partId: partId.value,
  })
  saving.value = false
  if (id) emit('created', id)
}

const stepProblem = computed(
  () => Object.entries(problems.value).find(([k]) => k.startsWith('steps'))?.[1] ?? stepHint.value,
)

const ghost =
  'h-8 w-full border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-accent focus-visible:bg-background focus-visible:border-input'
const area =
  'min-h-[60px] resize-none border-transparent bg-transparent px-2 text-sm shadow-none [field-sizing:content] hover:border-border focus-visible:border-input focus-visible:bg-background'
</script>

<template>
  <Dialog v-model:open="open">
    <DialogScrollContent
      v-if="isNew || test || missing"
      class="max-w-[1140px] gap-0 p-0"
      @open-auto-focus.prevent
    >
      <div class="flex items-center gap-2 border-b border-border px-[22px] py-3.5 pr-[60px]">
        <FolderClosed class="size-3.5 text-muted-foreground" />
        <span class="text-xs text-muted-foreground">{{ data.currentProject?.name }}</span>
        <ChevronRight class="size-3 text-muted-foreground" />
        <span class="text-xs text-muted-foreground">테스트</span>
        <ChevronRight class="size-3 text-muted-foreground" />
        <span class="text-xs">{{ test?.key ?? (isNew ? '새 테스트' : '') }}</span>
        <span class="grow" />
        <span class="text-xs text-muted-foreground">{{
          isNew ? '[만들기] 를 눌러야 들어갑니다' : '고치면 바로 저장됩니다'
        }}</span>
      </div>

      <div v-if="missing" class="px-[22px] py-10 text-center text-sm text-muted-foreground">
        <DialogTitle class="sr-only">테스트를 찾을 수 없습니다</DialogTitle>
        <DialogDescription
          >테스트를 찾을 수 없습니다. 지워졌거나 볼 수 없는 테스트입니다.</DialogDescription
        >
      </div>

      <div v-else class="flex items-stretch">
        <div class="flex min-w-0 grow flex-col gap-6 px-[22px] pt-4 pb-6">
          <header class="flex flex-col gap-1">
            <DialogTitle class="sr-only">{{ test?.title ?? '테스트 추가' }}</DialogTitle>
            <textarea
              ref="titleField"
              v-model="title"
              rows="1"
              aria-label="제목"
              :placeholder="isNew ? '무엇을 확인하는 테스트인가' : ''"
              class="-mx-2 resize-none overflow-hidden [field-sizing:content] rounded-md border border-transparent bg-transparent px-2 py-1 text-xl leading-snug font-semibold tracking-tight outline-none placeholder:text-muted-foreground hover:border-border focus:border-input"
              @input="fitTitle"
              @keydown="onTitleKeydown"
              @blur="!isNew && commitTitle()"
            />
            <p v-if="problems.title" class="text-xs text-destructive">{{ problems.title }}</p>
            <DialogDescription as-child>
              <button
                v-if="row"
                type="button"
                class="self-start text-xs text-muted-foreground underline-offset-4 enabled:hover:underline"
                :disabled="!test?.parentId"
                @click="test?.parentId && emit('open-test', test.parentId)"
              >
                {{ row.pathLabel }}
              </button>
              <p v-else class="text-xs text-muted-foreground">
                새 테스트는 작성 중으로 들어갑니다. 다 쓰면 [준비됨] 으로 올립니다.
              </p>
            </DialogDescription>
          </header>

          <TestRefs :refs="shownRefs" @add="addRef" @remove="removeRef" @open="openRef" />

          <section class="flex flex-col gap-3">
            <label class="flex flex-col gap-1">
              <span class="text-xs font-medium">목적</span>
              <Textarea
                v-model="purpose"
                aria-label="목적"
                placeholder="이 테스트로 무엇을 확인하나 (한두 줄)"
                :class="area"
                @blur="commitText('purpose')"
              />
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label class="flex flex-col gap-1">
                <span class="text-xs font-medium">사전조건</span>
                <Textarea
                  v-model="precondition"
                  aria-label="사전조건"
                  placeholder="돌리기 전에 갖춰져 있어야 하는 것"
                  :class="area"
                  @blur="commitText('precondition')"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-xs font-medium">테스트 데이터</span>
                <Textarea
                  v-model="testData"
                  aria-label="테스트 데이터"
                  placeholder="쓸 계정 · 값 · 파일"
                  :class="area"
                  @blur="commitText('testData')"
                />
              </label>
            </div>
          </section>

          <section class="flex flex-col gap-2">
            <div class="flex items-baseline gap-2">
              <span class="text-xs font-medium">단계</span>
              <span class="text-xs text-muted-foreground">{{ steps.length }}개</span>
              <span class="grow" />
              <span class="text-xs text-muted-foreground">행동 ↔ 기대 결과를 짝으로</span>
            </div>
            <TestStepsEditor
              :steps="test ? test.steps : steps"
              :failed-step="test?.status === 'fail' ? test.failedStep : null"
              @change="onSteps"
            />
            <p v-if="stepProblem" class="text-xs text-destructive">{{ stepProblem }}</p>
          </section>

          <TestStatusSection
            v-if="row"
            :row="row"
            @set="setStatus"
            @open-test="(id) => emit('open-test', id)"
          />

          <section
            v-if="changedEntries.length"
            class="flex flex-col gap-3 rounded-lg border border-border border-l-[3px] border-l-destructive px-4 py-3"
            data-test-basis
          >
            <div class="flex items-center gap-2">
              <TriangleAlert class="size-4 shrink-0 text-destructive" />
              <span class="text-sm font-medium">기준 바뀜</span>
              <span class="grow text-xs text-muted-foreground"
                >태그한 안건의 결정이 이 테스트를 확인한 뒤에 바뀌었습니다</span
              >
              <Button
                variant="outline"
                size="sm"
                class="shrink-0"
                @click="test && testStore.confirmBasis(test.id)"
              >
                그대로 맞다
              </Button>
            </div>
            <div v-for="c in changedEntries" :key="c.id" class="flex gap-4" data-test-basis-entry>
              <div class="w-[74px] shrink-0 pt-0.5 text-right text-xs font-medium">
                {{ c.entry ? monthDay(c.entry.createdAt) : '—' }}
              </div>
              <div class="w-px shrink-0 bg-border" />
              <div class="flex min-w-0 grow flex-col gap-1.5">
                <div class="flex flex-wrap items-center gap-2">
                  <EntryKindBadge v-if="c.entry" :kind="c.entry.kind" />
                  <button
                    v-if="c.thread"
                    type="button"
                    class="truncate text-xs text-muted-foreground underline-offset-4 hover:underline"
                    @click="emit('open-thread', c.thread.id)"
                  >
                    {{ c.thread.title }}
                  </button>
                </div>
                <p class="text-sm leading-relaxed text-pretty">
                  {{ c.entry?.text ?? '지금은 볼 수 없는 기록입니다.' }}
                </p>
                <div
                  v-if="c.entry?.detail.length"
                  class="flex flex-col gap-1 border-l-2 border-border pl-3"
                >
                  <p
                    v-for="(line, i) in c.entry.detail"
                    :key="i"
                    class="text-[13px] leading-relaxed text-muted-foreground text-pretty"
                  >
                    {{ line }}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <div v-if="isNew" class="flex justify-end gap-2">
            <Button variant="outline" @click="open = false">취소</Button>
            <Button :disabled="saving" @click="create">
              <Plus class="size-4" />
              만들기
            </Button>
          </div>
        </div>

        <aside
          class="flex w-[340px] shrink-0 flex-col gap-4 border-l border-border bg-muted/50 px-4 pt-4 pb-6"
        >
          <div v-if="row" class="flex flex-col gap-1.5">
            <div class="flex items-center gap-2">
              <TestStatusBadge :status="row.status" />
              <span v-if="!row.isGroup" class="text-xs text-muted-foreground" data-test-status-days>
                {{ row.test.statusDays === 0 ? '오늘부터' : `${row.test.statusDays}일째` }}
              </span>
              <span v-else class="text-xs text-muted-foreground">하위에서 모은 상태</span>
            </div>
          </div>
          <div v-else class="flex items-center gap-2">
            <TestStatusBadge status="draft" />
            <span class="text-xs text-muted-foreground">새 테스트는 작성 중입니다</span>
          </div>

          <dl class="flex flex-col gap-0.5">
            <div class="flex min-h-9 items-center gap-2">
              <dt class="w-[72px] shrink-0 text-xs text-muted-foreground">레벨</dt>
              <dd class="min-w-0 grow">
                <Select
                  :model-value="level ?? 'none'"
                  @update:model-value="(v) => setLevel(String(v))"
                >
                  <SelectTrigger :class="ghost" aria-label="레벨">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">정하지 않음</SelectItem>
                    <SelectItem v-for="o in TEST_LEVEL_OPTIONS" :key="o.value" :value="o.value">
                      {{ o.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </dd>
            </div>

            <div class="flex min-h-9 items-center gap-2">
              <dt class="w-[72px] shrink-0 text-xs text-muted-foreground">담당자</dt>
              <dd class="min-w-0 grow">
                <OwnerSelect v-model="ownerId" label="담당자" />
              </dd>
            </div>

            <PartField v-model="partId" :trigger-class="ghost" />

            <div class="flex min-h-9 items-center gap-2">
              <dt class="w-[72px] shrink-0 text-xs text-muted-foreground">상위 테스트</dt>
              <dd class="min-w-0 grow">
                <ParentTaskPicker v-model="parentId" :choices="parentChoices" noun="테스트" />
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
                  @change="
                    (e: Event) => {
                      start = picked(e)
                      commitPeriod()
                    }
                  "
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
                  @change="
                    (e: Event) => {
                      due = picked(e)
                      commitPeriod()
                    }
                  "
                />
              </dd>
            </div>
            <p v-if="periodHint || problems.due" class="pl-[80px] text-xs text-destructive">
              {{ periodHint || problems.due }}
            </p>
            <p v-else-if="!start || !due" class="pl-[80px] text-xs text-muted-foreground">
              시작 · 기한이 다 있어야 간트차트에 막대가 섭니다
            </p>
          </dl>

          <template v-if="test">
            <div class="h-px bg-border" />
            <dl class="flex flex-col gap-2 px-0.5 text-xs">
              <div class="flex gap-2">
                <dt class="w-[72px] shrink-0 text-muted-foreground">만든 사람</dt>
                <dd>{{ data.memberName(test.createdBy) ?? '—' }}</dd>
              </div>
              <div class="flex gap-2">
                <dt class="w-[72px] shrink-0 text-muted-foreground">만든 날짜</dt>
                <dd>{{ monthDay(test.createdAt) }}</dd>
              </div>
            </dl>
            <div class="grow" />
            <Button
              v-if="canRemove"
              variant="ghost"
              size="sm"
              class="self-start text-destructive hover:text-destructive"
              :disabled="row?.isGroup"
              :title="row?.isGroup ? '하위 테스트가 있으면 지울 수 없습니다' : ''"
              data-test-remove
              @click="remove"
            >
              <Trash2 class="size-3.5" />
              테스트 지우기
            </Button>
          </template>
        </aside>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
