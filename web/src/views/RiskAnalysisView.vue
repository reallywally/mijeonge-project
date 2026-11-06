<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { ChevronLeft, Loader2, Pencil, Sparkles, Trash2 } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import ChatRefText from '@/components/app/ChatRefText.vue'
import MemberAvatar from '@/components/app/MemberAvatar.vue'
import RiskAnalysisTitleDialog from '@/components/app/RiskAnalysisTitleDialog.vue'
import StatusPill, { type StatusTone } from '@/components/app/StatusPill.vue'
import RiskKindBadge from '@/components/app/RiskKindBadge.vue'
import TaskDetailDialog from '@/components/app/TaskDetailDialog.vue'
import TestDetailDialog from '@/components/app/TestDetailDialog.vue'
import AgendaDetailDialog from '@/components/app/AgendaDetailDialog.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ApiError, messageOf } from '@/api'
import { dayTime, monthDay } from '@/lib/date'
import {
  asRiskLevel,
  isStrongSignal,
  RISK_KIND_LABEL,
  riskSettingsLine,
  signalLabel,
} from '@/lib/risk'
import { useAgendaStore } from '@/stores/agenda'
import { useDataStore } from '@/stores/data'
import { useRiskAnalysisStore } from '@/stores/riskAnalysis'
import { useTestStore } from '@/stores/test'
import type { RiskCompareRef, RiskKind, RiskLevel } from '@/types/domain'

/* 저장한 AI 리스크 분석 상세 — 저장한 글 · 그때의 리스크 줄 · 지난 분석 대비를 그대로 그린다. 다시 계산하지 않는다(기록이다).
   근거 칩은 지금 분석 카드와 같은 부품(ChatRefText) — 지금 프로젝트에 없는 안건 · 작업은 그리지 않는다 (docs/api/risk-analysis.md '화면') */
const route = useRoute()
const router = useRouter()
const data = useDataStore()
const agendaStore = useAgendaStore()
const analyses = useRiskAnalysisStore()
const testStore = useTestStore()
onMounted(() => testStore.ensure())

const BOARD = { path: '/risks', query: { tab: 'saved' } }

const analysisId = computed(() => String(route.params.analysisId ?? ''))
const loadState = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
const loadError = ref('')
const a = computed(() =>
  loadState.value === 'ready' ? analyses.byId[analysisId.value] : undefined,
)
/** 분석의 프로젝트 — 다른 프로젝트의 분석 주소로 들어오면 그 프로젝트로 옮긴다 (Q70) */
const projectId = computed(() => a.value?.projectId ?? data.currentProjectId)

async function load(id: string) {
  loadState.value = 'loading'
  try {
    await analyses.fetchOne(id)
    if (analysisId.value !== id) return
    const owner = analyses.byId[id]?.projectId
    if (owner && owner !== data.currentProjectId) data.setProject(owner)
    loadState.value = 'ready'
  } catch (e) {
    if (analysisId.value !== id) return
    loadState.value = e instanceof ApiError && e.status === 404 ? 'missing' : 'error'
    loadError.value = messageOf(e)
  }
}
watch(analysisId, (id) => void load(id), { immediate: true })

/* 보는 중에 위에서 프로젝트를 바꾸면 이 분석은 그 프로젝트의 것이 아니다 — 게시판으로 */
watch(
  () => data.currentProjectId,
  (id) => {
    if (id !== a.value?.projectId) void router.replace(BOARD)
  },
)

const authorName = computed(() =>
  a.value?.createdBy ? (data.memberName(a.value.createdBy) ?? '알 수 없음') : '알 수 없음',
)

const LEVEL_TONE: Record<RiskLevel, StatusTone> = {
  high: 'blocked',
  medium: 'warn',
  low: 'todo',
}
const toneOf = (level: string): StatusTone => {
  const known = asRiskLevel(level)
  return known ? LEVEL_TONE[known] : 'todo'
}

/** 그때의 리스크 한 줄 — 세 종류를 한 모양으로 */
interface SnapRow {
  kind: RiskKind
  id: string
  key: string | null
  title: string
  level: string
  score: number
  signals: string[]
  ownerName: string | null
}

const KIND_ORDER: Record<RiskKind, number> = { task: 0, agenda: 1, test: 2 }

/** 세 종류를 섞어 점수 순(같으면 안건 · 작업 · 테스트, 그다음 저장된 순서) — 대시보드 목록과 같은 순서 */
const snapRows = computed<SnapRow[]>(() => {
  const f = a.value?.facts
  if (!f) return []
  const rows: SnapRow[] = [
    ...f.agendas.map((x) => ({ kind: 'agenda' as const, id: x.agendaId, ...x })),
    ...f.tasks.map((x) => ({ kind: 'task' as const, id: x.taskId, ...x })),
    ...f.tests.map((x) => ({ kind: 'test' as const, id: x.testId, ...x })),
  ]
  return rows
    .map((row, i) => ({ row, i }))
    .sort(
      (p, q) =>
        q.row.score - p.row.score || KIND_ORDER[p.row.kind] - KIND_ORDER[q.row.kind] || p.i - q.i,
    )
    .map((x) => x.row)
})

/** 지금도 있는가 — 있는 것만 눌러 상세가 뜬다 */
function exists(kind: RiskKind, id: string) {
  if (kind === 'agenda') return agendaStore.rows.some((r) => r.agenda.id === id)
  if (kind === 'task') return data.allTasks.some((t) => t.id === id)
  return testStore.byId[id] !== undefined
}

/** 대비 칸의 이름 — 이번 스냅샷 · 지금 것 순으로 찾는다. 앞 분석에만 있던 줄은 지금 것에서 */
function refTitle(ref: RiskCompareRef) {
  const snap = snapRows.value.find((r) => r.kind === ref.kind && r.id === ref.id)
  if (snap) return snap.key ? `${snap.key} ${snap.title}` : snap.title
  if (ref.kind === 'agenda') {
    const found = agendaStore.rows.find((r) => r.agenda.id === ref.id)?.agenda.title
    if (found) return found
  } else if (ref.kind === 'task') {
    const t = data.allTasks.find((x) => x.id === ref.id)
    if (t) return `${t.key} ${t.title}`
  } else {
    const t = testStore.byId[ref.id]
    if (t) return `${t.key} ${t.title}`
  }
  return `찾을 수 없는 ${RISK_KIND_LABEL[ref.kind]}`
}

const compare = computed(() => a.value?.facts.compare ?? null)
const changedLevels = computed(() =>
  (compare.value?.kept ?? []).filter((k) => k.levelFrom !== k.levelTo),
)
const compareRows = computed(() => {
  const c = compare.value
  if (!c) return []
  return [
    { key: 'added', label: '새로 생김', refs: c.added, muted: false },
    { key: 'removed', label: '풀림', refs: c.removed, muted: true },
    { key: 'changed', label: '등급 바뀜', refs: changedLevels.value, muted: false },
  ]
})
const levelChange = (ref: RiskCompareRef) => {
  const k = changedLevels.value.find((x) => x.kind === ref.kind && x.id === ref.id)
  return k ? ` · ${k.levelFrom} → ${k.levelTo}` : ''
}

/* 제목 고치기(작성자만) · 지우기(작성자 · 프로젝트 관리자 · 시스템 관리자) */
const renameOpen = ref(false)
async function submitRename(title: string): Promise<string | null> {
  const got = await analyses.rename(analysisId.value, title)
  return got.ok ? null : got.problem
}

const removeOpen = ref(false)
const removing = ref(false)
async function remove() {
  if (!a.value || removing.value) return
  removing.value = true
  const ok = await analyses.remove(analysisId.value)
  removing.value = false
  if (!ok) return
  removeOpen.value = false
  toast.success('분석을 지웠습니다.')
  await router.replace(BOARD)
}

/* 근거 칩 · 표의 줄을 누르면 상세 팝업. 이 화면 안에서만 여닫으므로 주소를 바꾸지 않는다. 지금 없는 것은 열지 않는다 */
const detail = ref<{ kind: RiskKind; id: string } | null>(null)
const openOf = (kind: RiskKind) =>
  computed({
    get: () => detail.value?.kind === kind,
    set: (open: boolean) => {
      if (!open && detail.value?.kind === kind) detail.value = null
    },
  })
const agendaOpen = openOf('agenda')
const taskOpen = openOf('task')
const testOpen = openOf('test')
const detailId = (kind: RiskKind) => (detail.value?.kind === kind ? detail.value.id : null)

function openDetail(kind: RiskKind, id: string) {
  if (!exists(kind, id)) return
  detail.value = { kind, id }
}
const openAgenda = (id: string) => openDetail('agenda', id)
const openTask = (id: string) => openDetail('task', id)
const openTest = (id: string) => openDetail('test', id)
</script>

<template>
  <AppShell>
    <div class="flex h-11 shrink-0 items-center gap-2.5 border-b border-border bg-card px-6">
      <RouterLink
        :to="BOARD"
        class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        data-analysis-back
      >
        <ChevronLeft class="size-3.5" />
        목록
      </RouterLink>
    </div>

    <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
      <div class="flex w-full max-w-[900px] flex-col gap-4 pb-[26px]">
        <div
          v-if="loadState === 'loading'"
          class="flex h-[110px] items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 class="size-4 animate-spin" />
          분석을 받는 중입니다.
        </div>
        <p
          v-else-if="!a"
          class="rounded-lg border border-border px-[17px] py-3 text-sm text-muted-foreground"
          role="alert"
          data-analysis-load-error
        >
          {{
            loadState === 'missing'
              ? '분석을 찾을 수 없습니다. 지워졌거나 볼 수 없는 분석입니다.'
              : loadError
          }}
        </p>

        <template v-else>
          <header class="flex items-start gap-4">
            <div class="flex min-w-0 grow flex-col gap-2">
              <span class="text-xs text-muted-foreground tabular-nums">#{{ a.seq }}</span>
              <h1
                class="text-[22px] font-bold tracking-[-0.025em] text-pretty"
                data-analysis-heading
              >
                {{ a.title }}
              </h1>
              <p
                class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
                data-analysis-meta
              >
                <span class="flex items-center gap-1.5 text-foreground">
                  <MemberAvatar
                    :name="authorName"
                    :src="data.memberAvatar(a.createdBy)"
                    :size="18"
                  />
                  {{ authorName }}
                </span>
                <span>·</span>
                <span>{{ dayTime(a.savedAt) }} 저장</span>
                <span>·</span>
                <span :title="riskSettingsLine(a.facts.settings)" data-analysis-as-of
                  >분석 기준 {{ monthDay(a.facts.asOf) }}</span
                >
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Button
                v-if="analyses.canRename(a)"
                variant="outline"
                data-analysis-rename
                @click="renameOpen = true"
              >
                <Pencil class="size-4" />
                제목 고치기
              </Button>
              <Button
                v-if="analyses.canRemove(a, projectId)"
                variant="outline"
                data-analysis-remove
                @click="removeOpen = true"
              >
                <Trash2 class="size-4" />
                지우기
              </Button>
            </div>
          </header>

          <!-- AI 가 낸 글 — v-html 없이 줄바꿈만 살리고 근거만 칩으로 -->
          <section
            class="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-[17px] py-[11px] shadow-sm"
            aria-label="AI 리스크 분석"
          >
            <div class="flex items-center gap-2.5">
              <Sparkles class="size-4 shrink-0 text-muted-foreground" />
              <span class="text-sm font-medium">AI 리스크 분석</span>
            </div>
            <ChatRefText
              :text="a.body"
              data-analysis-body
              @open-agenda="openAgenda"
              @open-task="openTask"
              @open-test="openTest"
            />
          </section>

          <!-- 지난 분석 대비 — 분석을 돌린 때 센 것이라 그 뒤 저장 · 지우기로 바뀌지 않는다 -->
          <section
            v-if="compare"
            class="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-[17px] py-[11px] shadow-sm"
            aria-label="지난 분석 대비"
            data-analysis-compare
          >
            <div class="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h2 class="text-sm font-medium">지난 분석 대비</h2>
              <RouterLink
                :to="`/risks/analyses/${compare.previousId}`"
                class="min-w-0 truncate text-xs underline-offset-4 hover:underline"
                data-analysis-previous
                >{{ compare.previousTitle }}</RouterLink
              >
              <span class="text-xs text-muted-foreground"
                >{{ dayTime(compare.previousSavedAt) }} 저장</span
              >
            </div>
            <dl class="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-sm">
              <template v-for="g in compareRows" :key="g.key">
                <dt class="text-muted-foreground" :data-compare-count="g.key">
                  {{ g.label }} {{ g.refs.length }}
                </dt>
                <dd class="flex flex-wrap gap-1">
                  <Badge
                    v-for="r in g.refs"
                    :key="`${r.kind}:${r.id}`"
                    variant="outline"
                    class="gap-1.5 font-normal"
                    :class="g.muted ? 'text-muted-foreground' : ''"
                    :data-compare-ref="`${r.kind}:${r.id}`"
                    ><span class="text-muted-foreground">{{ RISK_KIND_LABEL[r.kind] }}</span
                    >{{ refTitle(r) }}{{ g.key === 'changed' ? levelChange(r) : '' }}</Badge
                  >
                  <span v-if="g.refs.length === 0" class="text-muted-foreground">—</span>
                </dd>
              </template>
            </dl>
          </section>

          <!-- 그때의 리스크 — 스냅샷이라 지금 값이 아니다. 세 종류를 섞어 점수 순 -->
          <section class="flex flex-col gap-2.5" aria-label="그때의 리스크">
            <div class="flex items-baseline gap-2">
              <h2 class="text-base font-semibold">그때의 리스크</h2>
              <span class="text-xs text-muted-foreground" data-analysis-snapshot-as-of
                >{{ monthDay(a.facts.asOf) }} 기준 · 안건 {{ a.facts.agendas.length }} · 작업
                {{ a.facts.tasks.length }} · 테스트 {{ a.facts.tests.length }}건</span
              >
            </div>
            <div
              class="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
            >
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/60 hover:bg-muted/60">
                    <TableHead class="h-10 w-[64px] text-xs font-medium text-muted-foreground"
                      >종류</TableHead
                    >
                    <TableHead class="h-10 text-xs font-medium text-muted-foreground"
                      >제목</TableHead
                    >
                    <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground"
                      >등급</TableHead
                    >
                    <TableHead
                      class="h-10 w-[64px] text-right text-xs font-medium text-muted-foreground"
                      >점수</TableHead
                    >
                    <TableHead class="h-10 w-[96px] text-xs font-medium text-muted-foreground"
                      >담당자</TableHead
                    >
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow
                    v-for="row in snapRows"
                    :key="`${row.kind}:${row.id}`"
                    :class="exists(row.kind, row.id) ? 'cursor-pointer' : 'hover:bg-transparent'"
                    :data-analysis-row="`${row.kind}:${row.id}`"
                    :data-analysis-agenda="row.kind === 'agenda' ? row.id : undefined"
                    @click="openDetail(row.kind, row.id)"
                  >
                    <TableCell class="py-2.5 align-top"
                      ><RiskKindBadge :kind="row.kind"
                    /></TableCell>
                    <TableCell class="max-w-0 min-w-0 py-2.5">
                      <div class="flex min-w-0 items-center gap-2">
                        <span
                          v-if="row.key"
                          class="shrink-0 font-mono text-xs text-muted-foreground"
                          >{{ row.key }}</span
                        >
                        <span class="min-w-0 truncate text-sm">{{ row.title }}</span>
                      </div>
                      <div class="mt-1.5 flex flex-wrap gap-1">
                        <Badge
                          v-for="s in row.signals"
                          :key="s"
                          variant="outline"
                          class="font-normal whitespace-nowrap text-muted-foreground"
                          :class="isStrongSignal(s) ? 'border-destructive/40' : ''"
                          >{{ signalLabel(s, row.kind) }}</Badge
                        >
                      </div>
                    </TableCell>
                    <TableCell class="py-2.5 align-top">
                      <StatusPill :tone="toneOf(row.level)">{{ row.level }}</StatusPill>
                    </TableCell>
                    <TableCell class="py-2.5 text-right align-top text-sm tabular-nums">{{
                      row.score
                    }}</TableCell>
                    <TableCell
                      class="py-2.5 align-top text-sm"
                      :class="row.ownerName ? '' : 'text-muted-foreground'"
                      >{{ row.ownerName ?? '미정' }}</TableCell
                    >
                  </TableRow>
                  <TableRow v-if="snapRows.length === 0" class="hover:bg-transparent">
                    <TableCell colspan="5" class="h-20 text-center text-sm text-muted-foreground">
                      그때 짚은 리스크가 없습니다.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>
        </template>
      </div>
    </div>

    <RiskAnalysisTitleDialog
      v-if="a"
      v-model:open="renameOpen"
      heading="제목 고치기"
      description="제목만 고칠 수 있습니다. 글과 그때의 리스크 줄은 기록이라 그대로 둡니다."
      :initial="a.title"
      submit-label="저장"
      :submit="submitRename"
    />

    <Dialog v-model:open="removeOpen">
      <DialogContent class="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>분석을 지울까요?</DialogTitle>
          <DialogDescription class="text-pretty">
            지운 분석은 되돌릴 수 없습니다. 이미 이 분석과 견준 다음 분석의 '지난 분석 대비' 는
            그대로 남습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="removeOpen = false">취소</Button>
          <Button
            variant="destructive"
            :disabled="removing"
            data-analysis-remove-confirm
            @click="remove"
          >
            <Loader2 v-if="removing" class="animate-spin" />
            지우기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AgendaDetailDialog v-model:open="agendaOpen" :agenda-id="detailId('agenda')" />
    <TaskDetailDialog
      v-model:open="taskOpen"
      :task-id="detailId('task')"
      @open-task="openTask"
      @open-agenda="openAgenda"
    />
    <TestDetailDialog
      v-model:open="testOpen"
      :test-id="detailId('test')"
      @open-test="openTest"
      @open-task="openTask"
      @open-agenda="openAgenda"
    />
  </AppShell>
</template>
