<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Link2,
  ListTree,
  Loader2,
  Lock,
  Pencil,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
  Undo2,
} from 'lucide-vue-next'
import TaskBodyEditor from '@/components/app/TaskBodyEditor.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { firstLine } from '@/lib/agenda'
import { dayTime } from '@/lib/date'
import {
  bareLines,
  bodyDiff,
  IMPACT_CHANGED_TEXT,
  IMPACT_LOCKED_TEXT,
  IMPACT_UNLINKED_TEXT,
  impactKey,
  inReview,
  linkOnly,
  textDiff,
  type CompactOp,
  type ImpactKind,
} from '@/lib/impact'
import { useDataStore } from '@/stores/data'
import { useImpactStore } from '@/stores/impact'
import { useTestStore } from '@/stores/test'
import type { ImpactTask, ImpactTest, TaskLine } from '@/types/domain'

/* 안건 상세의 'AI 영향도 분석' 칸 (docs/api/impact.md '화면') — 결정내용 아래. [AI 영향도 분석] 으로만 돈다.
   결정이 바뀌었는데 그 판으로 분석한 적이 없으면 머리가 알림 줄로 바뀐다. 결과는 회의록 검토처럼
   고칠 작업 · 고칠 테스트 줄을 체크 · [고치기] · [지우기] 로 고르고 [반영 N건]. 검색으로 찾은 연결 안 된 줄은
   배지와 '이 안건에 연결' 체크가 붙고, 그중 확인 필요(check) 줄은 연결만 고른다. 부딪히는 결정은 칩 · 근거만 —
   안건을 고칠지는 사람이 정한다. 근거 · 고친 안은 AI 가 낸 글이라 v-html 없이 글로만 그린다 */
const props = defineProps<{ agendaId: string; focus?: boolean }>()

const data = useDataStore()
const impact = useImpactStore()
const testStore = useTestStore()
/* 상세 팝업은 여러 화면이 띄운다 — 화면마다 이벤트를 잇지 않고 칩은 그 상세 주소로 간다(TaggedTests 와 같다) */
const router = useRouter()

const agenda = computed(() => data.allAgendas.find((t) => t.id === props.agendaId) ?? null)
const state = computed(() => impact.states[props.agendaId] ?? null)
const latest = computed(() => state.value?.latest ?? null)
const review = computed(() => (latest.value ? impact.reviewOf(latest.value) : null))
const running = computed(() => impact.isRunning(props.agendaId))
const stale = computed(() => (latest.value ? impact.isStale(latest.value) : false))

/** 결정 판 ≥ 2 이고 지금 판으로 분석한 적이 없으면 — 살펴볼 것이 하나도 없으면 띄우지 않는다 */
const showAlert = computed(() => {
  const a = agenda.value
  const s = state.value
  if (!a || !s || a.decisionRev < 2) return false
  if (s.latest && s.latest.decisionRev === a.decisionRev) return false
  return s.taskCount + s.testCount + s.decidedAgendaCount > 0
})

const showSeen = ref(false)

/* 칸을 열 때 · 같은 화면에서 결정을 고쳐 판이 오를 때 다시 받는다 */
watch(
  [() => props.agendaId, () => agenda.value?.decisionRev],
  ([id], [oldId]) => {
    if (oldId && oldId !== id) impact.stop(oldId)
    showSeen.value = false
    void impact.load(id)
  },
  { immediate: true },
)

const section = ref<HTMLElement | null>(null)
onMounted(async () => {
  testStore.ensure()
  if (!props.focus) return
  await nextTick()
  section.value?.scrollIntoView?.({ block: 'start' })
})
/* 팝업을 닫으면 받는 중인 분석을 끊는다 — 끝까지 받지 못한 분석은 남지 않는다 */
onBeforeUnmount(() => impact.stop(props.agendaId))

function run() {
  if (running.value) return
  void impact.run(props.agendaId)
}

/* 고칠 작업 · 고칠 테스트 — update 줄과 검색으로 찾은 check 줄(찾아낸 것이라 접지 않는다) */
const updateTasks = computed(() =>
  (latest.value?.tasks ?? []).filter(
    (t) => inReview(t) && !impact.isRemoved(latest.value!, key('task', t.taskId)),
  ),
)
const updateTests = computed(() =>
  (latest.value?.tests ?? []).filter(
    (t) => inReview(t) && !impact.isRemoved(latest.value!, key('test', t.testId)),
  ),
)
const hasUpdates = computed(
  () => (latest.value?.tasks ?? []).some(inReview) || (latest.value?.tests ?? []).some(inReview),
)
/** 살펴본 것 — 연결된 check · ok 작업 · 테스트 한 줄씩 */
const seen = computed(() => [
  ...(latest.value?.tasks ?? [])
    .filter((t) => !inReview(t))
    .map((t) => ({ ...t, kind: 'task' as const, id: t.taskId, title: t.before.title })),
  ...(latest.value?.tests ?? [])
    .filter((t) => !inReview(t))
    .map((t) => ({ ...t, kind: 'test' as const, id: t.testId, title: t.before.title })),
])

const key = (kind: ImpactKind, id: string) => impactKey(kind, id)
const taskKey = (id: string) => data.allTasks.find((t) => t.id === id)?.key ?? '—'
const testKey = (id: string) => testStore.byId[id]?.key ?? '—'
const keyOf = (kind: ImpactKind, id: string) => (kind === 'task' ? taskKey(id) : testKey(id))
const agendaTitle = (id: string) => data.allAgendas.find((t) => t.id === id)?.title ?? null

const status = (kind: ImpactKind, id: string) => impact.rowStatus(latest.value!, kind, id)
const picked = (kind: ImpactKind, id: string) => impact.isPicked(latest.value!, kind, id)
const linking = (kind: ImpactKind, id: string) => impact.isLinking(latest.value!, kind, id)
/* 연결만 하는 줄은 연결 체크가 곧 고름 — 고칠 안이 있는 줄은 줄을 켰을 때만 연결을 고른다 */
const linkDisabled = (row: ImpactTask | ImpactTest, kind: ImpactKind, id: string) =>
  status(kind, id) !== 'open' ||
  stale.value ||
  (!linkOnly(row) && !review.value?.picked[key(kind, id)])
function setLink(kind: ImpactKind, id: string, on: boolean) {
  impact.setLink(latest.value!, key(kind, id), on)
}
const editing = (kind: ImpactKind, id: string) => !!review.value?.editing[key(kind, id)]
const problemOf = (kind: ImpactKind, id: string) => {
  if (!picked(kind, id)) return ''
  const k = key(kind, id)
  return impact.problems(latest.value!)[k] ?? review.value?.errors[k] ?? ''
}

const taskForm = (t: ImpactTask) => review.value!.tasks[t.taskId]
const testForm = (t: ImpactTest) => review.value!.tests[t.testId]
/* '후' — 반영한 줄은 서버가 남긴 반영한 값, 아니면 검토에서 고친 안 */
const taskAfter = (t: ImpactTask) =>
  t.appliedAt ? { title: t.title, body: t.body } : (taskForm(t) ?? {})
const testAfter = (t: ImpactTest) =>
  t.appliedAt ? { title: t.title, content: t.content, testData: t.testData } : (testForm(t) ?? {})

/* 편집기는 줄 id 를 단 TaskLine 을 쓴다 — 고친 안에는 id 가 없어 자리로 붙이고, 올릴 때 뗀다 */
const editLines = (t: ImpactTask): TaskLine[] =>
  (taskForm(t).body ?? []).map((l, i) => ({ id: `${t.taskId}-${i}`, ...l }))
function setBody(t: ImpactTask, lines: TaskLine[]) {
  taskForm(t).body = bareLines(lines)
}

const lastRemovedLabel = computed(() => {
  const k = review.value?.removed.at(-1)
  if (!k || !latest.value) return ''
  const [kind, id] = k.split(':') as [ImpactKind, string]
  const title =
    kind === 'task'
      ? latest.value.tasks.find((t) => t.taskId === id)?.before.title
      : latest.value.tests.find((t) => t.testId === id)?.before.title
  return `${kind === 'task' ? '작업' : '테스트'} ${keyOf(kind, id)} '${title ?? ''}'`
})

const STATUS_TEXT = {
  task: { missing: '찾을 수 없는 작업' },
  test: { missing: '찾을 수 없는 테스트' },
}

/* 끈 줄 · 잠긴 줄은 흐리게 — 체크는 흐리지 않아야 다시 켤 자리가 보인다 */
const rowClass = (kind: ImpactKind, id: string) =>
  status(kind, id) === 'open' && picked(kind, id) ? '' : 'bg-muted/50'

const OP_CLASS: Record<CompactOp['op'], string> = {
  same: 'text-muted-foreground',
  del: 'text-destructive line-through',
  add: 'text-status-done',
  gap: 'text-muted-foreground',
}
const OP_MARK: Record<CompactOp['op'], string> = { same: ' ', del: '−', add: '+', gap: '' }

function openTarget(kind: ImpactKind | 'agenda', id: string) {
  void router?.push(`/${kind === 'task' ? 'tasks' : kind === 'test' ? 'tests' : 'agendas'}/${id}`)
}
</script>

<template>
  <section
    v-if="agenda && agenda.decision.trim()"
    ref="section"
    class="flex min-w-0 flex-col gap-2.5"
    aria-label="AI 영향도 분석"
    data-impact-section
  >
    <!-- 머리 — 결정이 바뀌었는데 이 판으로 분석한 적이 없으면 알림 줄이 된다 -->
    <div
      class="flex items-center gap-2"
      :class="
        showAlert ? 'rounded-md border border-status-warn/40 bg-status-warn/10 px-3 py-2' : ''
      "
      :data-impact-alert="showAlert || undefined"
    >
      <TriangleAlert v-if="showAlert" class="size-3.5 shrink-0 text-status-warn" />
      <Sparkles v-else class="size-3.5 shrink-0 text-muted-foreground" />
      <span class="text-xs font-medium">AI 영향도 분석</span>
      <span v-if="showAlert" class="min-w-0 truncate text-xs" data-impact-alert-text
        >결정이 바뀌었어요 — 연결 작업 {{ state!.taskCount }} · 테스트 {{ state!.testCount }}</span
      >
      <span v-else class="min-w-0 truncate text-xs text-muted-foreground"
        >바뀐 결정에 걸린 작업 · 테스트 · 다른 결정을 AI 가 살펴봅니다</span
      >
      <Loader2
        v-if="impact.loading[agendaId] && !state"
        class="size-3 shrink-0 animate-spin text-muted-foreground"
        aria-label="불러오는 중"
      />
      <span class="grow" />
      <Button
        v-if="!running"
        variant="outline"
        size="xs"
        class="shrink-0"
        :disabled="impact.applying !== null"
        data-impact-run
        @click="run"
      >
        <Sparkles />
        {{ latest ? '다시 분석' : 'AI 영향도 분석' }}
      </Button>
    </div>

    <p v-if="impact.loadErrors[agendaId] && !state" class="text-xs text-destructive">
      {{ impact.loadErrors[agendaId] }}
    </p>

    <!-- 분석 중 — 진행 한 줄과 [멈추기] -->
    <div
      v-if="running"
      class="flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2"
      aria-live="polite"
    >
      <Loader2 class="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      <span class="min-w-0 grow truncate text-xs text-muted-foreground" data-impact-progress>
        {{ impact.running?.tool || '결정을 읽는 중' }}
      </span>
      <Button variant="outline" size="xs" data-impact-stop @click="impact.stop(agendaId)">
        <Square class="size-3 fill-current" />
        멈추기
      </Button>
    </div>
    <p
      v-if="impact.runErrors[agendaId]"
      class="text-xs text-destructive"
      role="alert"
      data-impact-error
    >
      {{ impact.runErrors[agendaId] }}
    </p>

    <template v-if="latest && review && !running">
      <p
        v-if="stale"
        class="flex items-center gap-1.5 text-xs text-muted-foreground"
        data-impact-stale-note
      >
        <TriangleAlert class="size-3.5 shrink-0" />
        이전 결정으로 한 분석이에요 —
        <button
          type="button"
          class="font-medium text-foreground underline-offset-4 hover:underline"
          data-impact-rerun
          @click="run"
        >
          다시 분석
        </button>
      </p>

      <div
        class="flex flex-col gap-4"
        :class="stale ? 'opacity-60' : ''"
        :data-impact-result="latest.id"
        :data-impact-stale="stale || undefined"
      >
        <!-- 무엇이 바뀌었나 -->
        <div class="flex flex-col gap-1.5 rounded-md border border-border bg-muted/50 px-3 py-2.5">
          <p class="text-sm leading-relaxed whitespace-pre-line" data-impact-summary>
            {{ latest.summary }}
          </p>
          <p class="flex min-w-0 items-center gap-1.5 text-xs" data-impact-decision>
            <span class="shrink-0 text-muted-foreground">결정</span>
            <span
              v-if="latest.decisionBefore"
              class="min-w-0 truncate text-muted-foreground line-through"
              :title="latest.decisionBefore"
              >{{ firstLine(latest.decisionBefore) }}</span
            >
            <span v-else class="shrink-0 text-muted-foreground">새 결정</span>
            <span class="shrink-0 text-muted-foreground">→</span>
            <span class="min-w-0 truncate" :title="latest.decisionAfter">{{
              firstLine(latest.decisionAfter)
            }}</span>
          </p>
          <p class="text-xs text-muted-foreground" data-impact-meta>
            {{ dayTime(latest.createdAt) }} ·
            {{ data.memberName(latest.createdBy) ?? '알 수 없음' }} 분석
          </p>
        </div>

        <p
          v-if="!hasUpdates && latest.conflicts.length === 0"
          class="text-xs text-muted-foreground"
          data-impact-nothing
        >
          고칠 작업 · 테스트와 부딪히는 결정이 없어요.
        </p>

        <!-- 고칠 작업 -->
        <section v-if="updateTasks.length > 0" class="flex flex-col gap-1.5" aria-label="고칠 작업">
          <h3 class="flex items-baseline gap-2 text-xs font-medium">
            고칠 작업
            <span class="font-normal text-muted-foreground">{{ updateTasks.length }}</span>
          </h3>
          <ul
            class="divide-y divide-border overflow-hidden rounded-md border border-border bg-card"
          >
            <li
              v-for="t in updateTasks"
              :key="t.taskId"
              class="flex gap-2.5 px-3 py-2.5"
              :class="rowClass('task', t.taskId)"
              :data-impact-row="key('task', t.taskId)"
              :data-impact-status="status('task', t.taskId)"
            >
              <span v-if="linkOnly(t)" class="size-4 shrink-0" />
              <Checkbox
                v-else
                class="mt-0.5"
                :model-value="picked('task', t.taskId)"
                :disabled="status('task', t.taskId) !== 'open' || stale"
                :aria-label="`작업 '${t.before.title}' 반영`"
                data-impact-pick
                @update:model-value="
                  (v) => impact.setPicked(latest!, key('task', t.taskId), v === true)
                "
              />
              <div class="flex min-w-0 grow flex-col gap-1.5">
                <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs hover:bg-accent"
                    :data-impact-open="key('task', t.taskId)"
                    @click="openTarget('task', t.taskId)"
                  >
                    <span class="shrink-0 font-mono text-muted-foreground">{{
                      taskKey(t.taskId)
                    }}</span>
                    <span class="truncate">{{ t.before.title }}</span>
                  </button>
                  <Badge
                    v-if="!t.linked"
                    variant="outline"
                    class="gap-1 font-normal text-muted-foreground"
                    data-impact-unlinked
                    ><Link2 class="size-3" />{{ IMPACT_UNLINKED_TEXT }}</Badge
                  >
                  <span v-if="linkOnly(t)" class="text-xs font-medium" data-impact-check
                    >확인 필요</span
                  >
                  <span
                    v-if="status('task', t.taskId) === 'applied'"
                    class="inline-flex items-center gap-1 text-xs text-status-done"
                    data-impact-applied
                    ><Check class="size-3" />반영함{{ t.linkedOnApply ? ' · 연결함' : '' }}</span
                  >
                  <span
                    v-else-if="status('task', t.taskId) === 'changed'"
                    class="text-xs text-destructive"
                    data-impact-changed
                    >{{ IMPACT_CHANGED_TEXT }}</span
                  >
                  <span
                    v-else-if="status('task', t.taskId) === 'locked'"
                    class="inline-flex items-center gap-1 text-xs text-muted-foreground"
                    data-impact-locked
                    ><Lock class="size-3" />{{ IMPACT_LOCKED_TEXT }}</span
                  >
                  <span
                    v-else-if="status('task', t.taskId) === 'missing'"
                    class="text-xs text-muted-foreground"
                    >{{ STATUS_TEXT.task.missing }}</span
                  >
                </div>
                <p class="text-xs leading-relaxed text-muted-foreground" data-impact-reason>
                  {{ t.reason }}
                </p>

                <template v-if="editing('task', t.taskId)">
                  <Input
                    v-if="taskForm(t).title !== undefined"
                    v-model="taskForm(t).title"
                    class="h-8 text-sm"
                    aria-label="고칠 작업 제목"
                    data-impact-edit-title
                  />
                  <div
                    v-if="taskForm(t).body !== undefined"
                    class="rounded-md border border-border bg-background px-2 py-1"
                    data-impact-edit-body
                  >
                    <TaskBodyEditor :lines="editLines(t)" @change="(l) => setBody(t, l)" />
                  </div>
                </template>
                <template v-else>
                  <p
                    v-if="taskAfter(t).title !== undefined"
                    class="flex min-w-0 items-center gap-1.5 text-xs"
                    data-impact-title
                  >
                    <span class="min-w-0 truncate text-muted-foreground line-through">{{
                      t.before.title
                    }}</span>
                    <span class="shrink-0 text-muted-foreground">→</span>
                    <span class="min-w-0 truncate">{{ taskAfter(t).title }}</span>
                  </p>
                  <ul
                    v-if="taskAfter(t).body !== undefined"
                    class="flex flex-col rounded-md bg-muted/50 px-2 py-1 text-xs leading-relaxed"
                    data-impact-diff
                  >
                    <li
                      v-for="(op, i) in bodyDiff(t.before.body, taskAfter(t).body!)"
                      :key="i"
                      class="flex gap-1.5 whitespace-pre-wrap"
                      :class="OP_CLASS[op.op]"
                      :data-op="op.op"
                    >
                      <template v-if="op.op === 'gap'">… {{ op.count }}줄 그대로</template>
                      <template v-else
                        ><span class="w-2 shrink-0">{{ OP_MARK[op.op] }}</span
                        ><span class="min-w-0">{{ op.text }}</span></template
                      >
                    </li>
                  </ul>
                </template>
                <label
                  v-if="!t.linked && status('task', t.taskId) !== 'applied'"
                  class="inline-flex items-center gap-1.5 self-start text-xs"
                >
                  <Checkbox
                    :model-value="linking('task', t.taskId)"
                    :disabled="linkDisabled(t, 'task', t.taskId)"
                    data-impact-link
                    @update:model-value="(v) => setLink('task', t.taskId, v === true)"
                  />
                  이 안건에 연결
                </label>
                <p v-if="problemOf('task', t.taskId)" class="text-xs text-destructive" role="alert">
                  {{ problemOf('task', t.taskId) }}
                </p>
              </div>
              <div
                v-if="status('task', t.taskId) !== 'applied'"
                class="flex shrink-0 items-start gap-0.5"
              >
                <Button
                  v-if="!linkOnly(t)"
                  variant="ghost"
                  size="icon-sm"
                  class="text-muted-foreground"
                  :disabled="status('task', t.taskId) !== 'open' || stale"
                  :aria-label="`작업 '${t.before.title}' 고칠 안 고치기`"
                  title="고치기 — 고칠 안을 손으로 고칩니다"
                  data-impact-edit
                  @click="impact.toggleEdit(latest!, key('task', t.taskId))"
                >
                  <Pencil class="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="text-muted-foreground hover:text-destructive"
                  :aria-label="`작업 '${t.before.title}' 지우기`"
                  title="지우기 — 반영하지 않습니다"
                  data-impact-remove
                  @click="impact.removeRow(latest!, key('task', t.taskId))"
                >
                  <Trash2 class="size-3.5" />
                </Button>
              </div>
            </li>
          </ul>
        </section>

        <!-- 고칠 테스트 -->
        <section
          v-if="updateTests.length > 0"
          class="flex flex-col gap-1.5"
          aria-label="고칠 테스트"
        >
          <h3 class="flex items-baseline gap-2 text-xs font-medium">
            고칠 테스트
            <span class="font-normal text-muted-foreground">{{ updateTests.length }}</span>
          </h3>
          <ul
            class="divide-y divide-border overflow-hidden rounded-md border border-border bg-card"
          >
            <li
              v-for="t in updateTests"
              :key="t.testId"
              class="flex gap-2.5 px-3 py-2.5"
              :class="rowClass('test', t.testId)"
              :data-impact-row="key('test', t.testId)"
              :data-impact-status="status('test', t.testId)"
            >
              <span v-if="linkOnly(t)" class="size-4 shrink-0" />
              <Checkbox
                v-else
                class="mt-0.5"
                :model-value="picked('test', t.testId)"
                :disabled="status('test', t.testId) !== 'open' || stale"
                :aria-label="`테스트 '${t.before.title}' 반영`"
                data-impact-pick
                @update:model-value="
                  (v) => impact.setPicked(latest!, key('test', t.testId), v === true)
                "
              />
              <div class="flex min-w-0 grow flex-col gap-1.5">
                <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs hover:bg-accent"
                    :data-impact-open="key('test', t.testId)"
                    @click="openTarget('test', t.testId)"
                  >
                    <span class="shrink-0 font-mono text-muted-foreground">{{
                      testKey(t.testId)
                    }}</span>
                    <span class="truncate">{{ t.before.title }}</span>
                  </button>
                  <Badge
                    v-if="!t.linked"
                    variant="outline"
                    class="gap-1 font-normal text-muted-foreground"
                    data-impact-unlinked
                    ><Link2 class="size-3" />{{ IMPACT_UNLINKED_TEXT }}</Badge
                  >
                  <span v-if="linkOnly(t)" class="text-xs font-medium" data-impact-check
                    >확인 필요</span
                  >
                  <span
                    v-if="status('test', t.testId) === 'applied'"
                    class="inline-flex items-center gap-1 text-xs text-status-done"
                    data-impact-applied
                    ><Check class="size-3" />반영함{{ t.linkedOnApply ? ' · 연결함' : '' }}</span
                  >
                  <span
                    v-else-if="status('test', t.testId) === 'changed'"
                    class="text-xs text-destructive"
                    data-impact-changed
                    >{{ IMPACT_CHANGED_TEXT }}</span
                  >
                  <span
                    v-else-if="status('test', t.testId) === 'locked'"
                    class="inline-flex items-center gap-1 text-xs text-muted-foreground"
                    data-impact-locked
                    ><Lock class="size-3" />{{ IMPACT_LOCKED_TEXT }}</span
                  >
                  <span
                    v-else-if="status('test', t.testId) === 'missing'"
                    class="text-xs text-muted-foreground"
                    >{{ STATUS_TEXT.test.missing }}</span
                  >
                </div>
                <p class="text-xs leading-relaxed text-muted-foreground" data-impact-reason>
                  {{ t.reason }}
                </p>

                <template v-if="editing('test', t.testId)">
                  <Input
                    v-if="testForm(t).title !== undefined"
                    v-model="testForm(t).title"
                    class="h-8 text-sm"
                    aria-label="고칠 테스트 제목"
                    data-impact-edit-title
                  />
                  <Textarea
                    v-if="testForm(t).content !== undefined"
                    v-model="testForm(t).content"
                    rows="4"
                    class="resize-y bg-background text-xs leading-relaxed"
                    aria-label="고칠 테스트 내용"
                    data-impact-edit-content
                  />
                  <Textarea
                    v-if="testForm(t).testData !== undefined"
                    v-model="testForm(t).testData"
                    rows="2"
                    class="resize-y bg-background text-xs leading-relaxed"
                    aria-label="고칠 테스트 데이터"
                    data-impact-edit-test-data
                  />
                </template>
                <template v-else>
                  <p
                    v-if="testAfter(t).title !== undefined"
                    class="flex min-w-0 items-center gap-1.5 text-xs"
                    data-impact-title
                  >
                    <span class="min-w-0 truncate text-muted-foreground line-through">{{
                      t.before.title
                    }}</span>
                    <span class="shrink-0 text-muted-foreground">→</span>
                    <span class="min-w-0 truncate">{{ testAfter(t).title }}</span>
                  </p>
                  <template v-for="field in ['content', 'testData'] as const" :key="field">
                    <div v-if="testAfter(t)[field] !== undefined" class="flex flex-col gap-0.5">
                      <span class="text-xs text-muted-foreground">{{
                        field === 'content' ? '테스트 내용' : '테스트 데이터'
                      }}</span>
                      <ul
                        class="flex flex-col rounded-md bg-muted/50 px-2 py-1 text-xs leading-relaxed"
                        data-impact-diff
                      >
                        <li
                          v-for="(op, i) in textDiff(t.before[field], testAfter(t)[field]!)"
                          :key="i"
                          class="flex gap-1.5 whitespace-pre-wrap"
                          :class="OP_CLASS[op.op]"
                          :data-op="op.op"
                        >
                          <template v-if="op.op === 'gap'">… {{ op.count }}줄 그대로</template>
                          <template v-else
                            ><span class="w-2 shrink-0">{{ OP_MARK[op.op] }}</span
                            ><span class="min-w-0">{{ op.text }}</span></template
                          >
                        </li>
                      </ul>
                    </div>
                  </template>
                </template>
                <label
                  v-if="!t.linked && status('test', t.testId) !== 'applied'"
                  class="inline-flex items-center gap-1.5 self-start text-xs"
                >
                  <Checkbox
                    :model-value="linking('test', t.testId)"
                    :disabled="linkDisabled(t, 'test', t.testId)"
                    data-impact-link
                    @update:model-value="(v) => setLink('test', t.testId, v === true)"
                  />
                  이 안건에 연결
                </label>
                <p v-if="problemOf('test', t.testId)" class="text-xs text-destructive" role="alert">
                  {{ problemOf('test', t.testId) }}
                </p>
              </div>
              <div
                v-if="status('test', t.testId) !== 'applied'"
                class="flex shrink-0 items-start gap-0.5"
              >
                <Button
                  v-if="!linkOnly(t)"
                  variant="ghost"
                  size="icon-sm"
                  class="text-muted-foreground"
                  :disabled="status('test', t.testId) !== 'open' || stale"
                  :aria-label="`테스트 '${t.before.title}' 고칠 안 고치기`"
                  title="고치기 — 고칠 안을 손으로 고칩니다"
                  data-impact-edit
                  @click="impact.toggleEdit(latest!, key('test', t.testId))"
                >
                  <Pencil class="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="text-muted-foreground hover:text-destructive"
                  :aria-label="`테스트 '${t.before.title}' 지우기`"
                  title="지우기 — 반영하지 않습니다"
                  data-impact-remove
                  @click="impact.removeRow(latest!, key('test', t.testId))"
                >
                  <Trash2 class="size-3.5" />
                </Button>
              </div>
            </li>
          </ul>
        </section>

        <!-- 부딪히는 결정 — 반영할 것이 없다. 칩 · 그 결정 한 줄 · 근거 -->
        <section
          v-if="latest.conflicts.length > 0"
          class="flex flex-col gap-1.5"
          aria-label="부딪히는 결정"
        >
          <h3 class="flex items-baseline gap-2 text-xs font-medium">
            부딪히는 결정
            <span class="font-normal text-muted-foreground">{{ latest.conflicts.length }}</span>
          </h3>
          <ul class="flex flex-col gap-1.5">
            <li
              v-for="c in latest.conflicts"
              :key="c.agendaId"
              class="flex flex-col gap-1 rounded-md border px-3 py-2"
              :class="
                c.verdict === 'conflict'
                  ? 'border-destructive/40 bg-destructive/5'
                  : 'border-border bg-card'
              "
              :data-impact-conflict="c.agendaId"
              :data-verdict="c.verdict"
            >
              <div class="flex min-w-0 items-center gap-1.5">
                <span
                  class="shrink-0 text-xs font-medium"
                  :class="c.verdict === 'conflict' ? 'text-destructive' : 'text-muted-foreground'"
                  >{{ c.verdict === 'conflict' ? '부딪힘' : '확인 필요' }}</span
                >
                <button
                  v-if="agendaTitle(c.agendaId)"
                  type="button"
                  class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs hover:bg-accent"
                  :data-impact-agenda="c.agendaId"
                  @click="openTarget('agenda', c.agendaId)"
                >
                  <ListTree class="size-3 shrink-0 text-muted-foreground" />
                  <span class="truncate">{{ agendaTitle(c.agendaId) }}</span>
                </button>
                <span v-else class="text-xs text-muted-foreground">지워진 안건</span>
              </div>
              <p class="truncate text-xs" :title="c.decision">{{ firstLine(c.decision) }}</p>
              <p class="text-xs leading-relaxed text-muted-foreground" data-impact-reason>
                {{ c.reason }}
              </p>
            </li>
          </ul>
        </section>

        <!-- 살펴본 것 — 접어 둔다 -->
        <div v-if="seen.length > 0" class="flex flex-col gap-1.5">
          <button
            type="button"
            class="inline-flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
            :aria-expanded="showSeen"
            data-impact-seen-toggle
            @click="showSeen = !showSeen"
          >
            <ChevronDown v-if="showSeen" class="size-3" />
            <ChevronRight v-else class="size-3" />
            살펴본 것 {{ seen.length }}건
          </button>
          <ul v-if="showSeen" class="flex flex-col gap-1" data-impact-seen>
            <li
              v-for="s in seen"
              :key="key(s.kind, s.id)"
              class="flex min-w-0 items-baseline gap-1.5 text-xs"
              :data-impact-seen-row="key(s.kind, s.id)"
            >
              <span
                class="shrink-0"
                :class="s.verdict === 'check' ? 'font-medium' : 'text-muted-foreground'"
                >{{ s.verdict === 'check' ? '볼 것' : '그대로' }}</span
              >
              <button
                type="button"
                class="shrink-0 font-mono text-muted-foreground underline-offset-4 hover:underline"
                @click="openTarget(s.kind, s.id)"
              >
                {{ keyOf(s.kind, s.id) }}
              </button>
              <span class="shrink-0 truncate">{{ s.title }}</span>
              <span class="min-w-0 truncate text-muted-foreground" :title="s.reason"
                >— {{ s.reason }}</span
              >
            </li>
          </ul>
        </div>

        <p
          v-if="review.removed.length > 0"
          class="flex items-center gap-2 text-xs text-muted-foreground"
          data-impact-rows-removed
        >
          지운 항목 {{ review.removed.length }}개 — 마지막: {{ lastRemovedLabel }}
          <Button
            variant="ghost"
            size="sm"
            class="h-7 gap-1 px-2 text-xs"
            data-impact-undo
            @click="impact.undoRemove(latest)"
          >
            <Undo2 class="size-3.5" />
            되돌리기
          </Button>
        </p>

        <div v-if="hasUpdates" class="flex items-center gap-2.5">
          <span class="min-w-0 grow text-xs text-muted-foreground">
            켠 줄만 반영합니다. 작업 · 테스트의 변경 이력에 남습니다.
          </span>
          <Button
            size="sm"
            :disabled="!impact.canApply(latest)"
            data-impact-apply
            @click="impact.apply(latest)"
          >
            <Loader2 v-if="impact.applying === latest.id" class="size-3.5 animate-spin" />
            <Check v-else class="size-3.5" />
            {{
              impact.applying === latest.id ? '반영하는 중' : `반영 ${impact.pickedCount(latest)}건`
            }}
          </Button>
        </div>
      </div>
    </template>
  </section>
</template>
