<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Check,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Square,
} from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import ChatRefText from '@/components/app/ChatRefText.vue'
import PartScopeToggle from '@/components/app/PartScopeToggle.vue'
import RiskAnalysisBoard from '@/components/app/RiskAnalysisBoard.vue'
import RiskAnalysisTitleDialog from '@/components/app/RiskAnalysisTitleDialog.vue'
import RiskSettingsDialog from '@/components/app/RiskSettingsDialog.vue'
import RiskSignalBars from '@/components/app/RiskSignalBars.vue'
import RiskStatCards from '@/components/app/RiskStatCards.vue'
import RiskTable from '@/components/app/RiskTable.vue'
import TaskDetailDialog from '@/components/app/TaskDetailDialog.vue'
import TestDetailDialog from '@/components/app/TestDetailDialog.vue'
import AgendaDetailDialog from '@/components/app/AgendaDetailDialog.vue'
import { Button } from '@/components/ui/button'
import { canManageProject } from '@/lib/access'
import { kstToday, monthDay } from '@/lib/date'
import { defaultAnalysisTitle, riskSettingsLine } from '@/lib/risk'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useRiskStore } from '@/stores/risk'
import { useRiskAnalysisStore } from '@/stores/riskAnalysis'
import { useTestStore } from '@/stores/test'
import type { RiskKind, RiskSummaryInput } from '@/types/domain'

/* 리스크 대시보드 — 안건 · 작업 · 테스트의 지연과 흔들림. 계산은 서버가 하고 여기는 받아 그린다(Q35 · risk-dashboard.md).
   받는 때는 들어올 때 · 기준을 바꾼 뒤 · [새로 고침] 뿐이다. 프로젝트를 바꾸면 그 프로젝트 것으로 다시 받는다 */
const data = useDataStore()
const auth = useAuthStore()
const risk = useRiskStore()
const analyses = useRiskAnalysisStore()
const testStore = useTestStore()
const route = useRoute()
const router = useRouter()

/* 테스트 줄 · 근거 칩의 상세는 테스트 목록에서 찾는다 — 아직 안 받았으면 받는다 */
onMounted(() => testStore.ensure())

/* 게시판도 같이 받는다 — 탭 이름에 저장한 분석 수를 띄운다 */
watch(
  () => data.currentProjectId,
  () => {
    void risk.load()
    void analyses.load()
  },
  { immediate: true },
)

/* [지금 리스크 | 저장한 분석 N] — 쿼리 ?tab=saved 로 기억해 뒤로 가기가 탭을 되돌린다. 탭을 바꿔도 분석은 남는다 */
type Tab = 'now' | 'saved'
const tab = computed<Tab>(() => (route.query.tab === 'saved' ? 'saved' : 'now'))
const tabs = computed(() => [
  { key: 'now' as const, label: '지금 리스크', count: null },
  { key: 'saved' as const, label: '저장한 분석', count: analyses.count },
])
function selectTab(key: Tab) {
  if (key === tab.value) return
  const query = { ...route.query }
  if (key === 'saved') query.tab = 'saved'
  else delete query.tab
  void router.push({ query })
}

/* [저장] — 끝까지 받은 분석(analysisId 가 있는 것)만. 목록이 바뀌어 흐려져도 그때 분석한 것을 남길 수 있다 */
const saveOpen = ref(false)
const saveTitle = ref('')
const canSave = computed(
  () =>
    risk.summary?.status === 'done' && risk.summary.analysisId !== null && !risk.summary.savedId,
)
function openSave() {
  saveTitle.value = defaultAnalysisTitle(kstToday())
  saveOpen.value = true
}
async function submitSave(title: string): Promise<string | null> {
  const analysisId = risk.summary?.analysisId
  if (!analysisId) return '저장할 분석이 없습니다. 다시 분석해 주세요.'
  const got = await analyses.save(analysisId, title)
  if (got.ok) {
    risk.markSummarySaved(analysisId, got.analysis.id)
    return null
  }
  /* 이미 저장했으면 같은 id 가 게시판에 있다 — 버튼만 '저장됨' 으로 */
  if (got.alreadySaved) {
    risk.markSummarySaved(analysisId, analysisId)
    void analyses.load()
    return null
  }
  return got.problem
}

/* AI 리스크 분석은 이 화면에서만 산다 — 떠나면 버리고, 받는 중이면 끊는다 */
onBeforeUnmount(() => risk.resetSummary())

/** '안건 n · 작업 m · 테스트 k건' */
const countsOf = (ids: RiskSummaryInput) =>
  `작업 ${ids.taskIds.length} · 안건 ${ids.agendaIds.length} · 테스트 ${ids.testIds.length}건`

const summaryLine = computed(() => {
  const s = risk.summary
  if (s && risk.summaryChanged) return '목록이 바뀌었습니다 —'
  if (s?.status === 'streaming') return `보이는 ${countsOf(s)}을 분석하는 중…`
  if (s) return `${s.asOf} 기준 · ${countsOf(s)}`
  if (risk.tooManyToSummarize) return '보이는 줄이 너무 많습니다 — 내 파트나 거르기로 좁혀 주세요.'
  if (risk.visibleCount === 0) return '보이는 리스크가 없어 분석할 것이 없습니다.'
  return `보이는 ${countsOf(risk.visibleIds)}을 분석합니다`
})

const canEditSettings = computed(
  () => data.currentProjectId !== '' && canManageProject(auth.me, data.currentProjectId),
)

const settingsOpen = ref(false)

/* 줄 · 근거 칩을 누르면 기존 상세 팝업. 리스크 화면 안에서만 여닫으므로 주소를 바꾸지 않는다. 한 번에 하나만 */
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
  detail.value = { kind, id }
}
const openAgenda = (id: string) => openDetail('agenda', id)
const openTask = (id: string) => openDetail('task', id)
const openTest = (id: string) => openDetail('test', id)
</script>

<template>
  <AppShell>
    <div class="flex h-11 shrink-0 items-center gap-2.5 border-b border-border bg-card px-6">
      <span class="text-xs font-medium text-muted-foreground">리스크</span>
      <div
        role="tablist"
        aria-label="지금 리스크 · 저장한 분석"
        class="flex items-center gap-0.5 rounded-md border border-border bg-muted/50 p-0.5"
      >
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          role="tab"
          class="inline-flex h-6 items-center gap-1.5 rounded-sm px-3 text-xs"
          :class="
            tab === t.key
              ? 'bg-background font-medium shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          "
          :aria-selected="tab === t.key"
          :data-tab="t.key"
          @click="selectTab(t.key)"
        >
          {{ t.label }}
          <span v-if="t.count !== null" class="text-muted-foreground tabular-nums">{{
            t.count
          }}</span>
        </button>
      </div>
      <!-- 기준값(지연 · 흔들림 · 등급 점수)은 가리키면 보인다 — 본문의 '기준' 칸은 2026-11-06 걷었다 -->
      <span
        v-if="tab === 'now' && risk.report"
        class="text-xs text-muted-foreground"
        :title="riskSettingsLine(risk.report.settings)"
        data-risk-settings
      >
        {{ monthDay(risk.report.asOf) }} 기준
      </span>
      <div class="grow" />
      <template v-if="tab === 'now'">
        <Button
          variant="ghost"
          size="sm"
          class="shrink-0"
          :disabled="risk.loading"
          @click="risk.load()"
        >
          <Loader2 v-if="risk.loading" class="size-4 animate-spin" />
          <RefreshCw v-else class="size-4" />
          새로 고침
        </Button>
        <Button
          v-if="canEditSettings"
          variant="ghost"
          size="sm"
          class="shrink-0"
          :disabled="!risk.report"
          @click="settingsOpen = true"
        >
          <SlidersHorizontal class="size-4" />
          기준 바꾸기
        </Button>
        <PartScopeToggle area="work" />
      </template>
    </div>

    <div class="flex min-h-0 grow overflow-y-auto px-6 pt-6">
      <div class="flex w-full flex-col gap-4 pb-[26px]">
        <header class="flex flex-col gap-2.5">
          <h1 class="text-[22px] font-bold tracking-[-0.025em]">리스크</h1>
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            안건 · 작업 · 테스트가 오래 늦어지거나 자주 흔들리는 것을 봅니다. 신호마다 점수를 매겨
            합으로 등급을 가릅니다 — 같은 데이터면 늘 같은 결과입니다.
          </p>
        </header>

        <RiskAnalysisBoard v-if="tab === 'saved'" />

        <p
          v-if="tab === 'now' && risk.error"
          class="rounded-lg border border-destructive/40 px-[17px] py-3 text-sm text-destructive"
          role="alert"
        >
          {{ risk.error }}
        </p>

        <template v-if="tab === 'now' && risk.report">
          <RiskStatCards />

          <!-- 넓으면 좌우(신호별 | AI 리스크 분석), 좁으면 위아래 -->
          <div
            class="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
          >
            <RiskSignalBars />
            <!-- AI 리스크 분석 — 누를 때만 부른다. 보이는 세 종류의 id 를 보낸다. 답은 AI 가 낸 글이라 v-html 없이 줄바꿈만 살린다 -->
            <section
              class="flex min-w-0 flex-col gap-2.5 rounded-lg border border-border bg-card px-[17px] py-3.5 shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
              aria-label="AI 리스크 분석"
              data-risk-summary
            >
              <div class="flex flex-wrap items-center gap-2.5">
                <Sparkles class="size-4 shrink-0 text-muted-foreground" />
                <h2 class="shrink-0 text-sm font-medium">AI 리스크 분석</h2>
                <span class="grow" />
                <Button
                  v-if="risk.summarizing"
                  variant="outline"
                  class="shrink-0"
                  @click="risk.stopSummary()"
                >
                  <Square class="size-3.5 fill-current" />
                  멈춤
                </Button>
                <template v-else-if="risk.summary">
                  <Button
                    variant="outline"
                    class="shrink-0"
                    :disabled="!risk.canSummarize"
                    @click="risk.summarize()"
                  >
                    <RotateCcw class="size-4" />
                    다시 분석
                  </Button>
                  <span
                    v-if="risk.summary.savedId"
                    class="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
                    data-summary-saved
                  >
                    <Check class="size-3.5" />
                    저장됨 ·
                    <RouterLink
                      :to="`/risks/analyses/${risk.summary.savedId}`"
                      class="font-medium text-foreground underline-offset-4 hover:underline"
                      data-summary-saved-link
                      >보기</RouterLink
                    >
                  </span>
                  <Button
                    v-else-if="canSave"
                    variant="outline"
                    class="shrink-0"
                    data-summary-save
                    @click="openSave"
                  >
                    <Save class="size-4" />
                    저장
                  </Button>
                </template>
                <Button
                  v-else
                  variant="outline"
                  class="shrink-0"
                  :disabled="!risk.canSummarize"
                  @click="risk.summarize()"
                >
                  <Sparkles class="size-4" />
                  AI 리스크 분석
                </Button>
              </div>

              <!-- 좁은 칸에서도 잘리지 않게 제목 줄 아래 따로 -->
              <p class="-mt-1 text-xs text-muted-foreground" data-summary-line>
                {{ summaryLine }}
              </p>
              <p
                v-if="!risk.summary"
                class="text-sm leading-relaxed text-muted-foreground text-pretty"
              >
                누르면 보이는 줄의 신호 · 숫자로 먼저 손쓸 것과 흔들리는 일을 정리합니다. 판정(신호
                · 점수 · 등급)은 규칙이 하고, AI 는 설명만 합니다.
              </p>
              <div
                v-if="risk.summary"
                class="flex flex-col gap-1.5 transition-opacity"
                :class="risk.summaryChanged ? 'opacity-50' : ''"
                :data-summary-changed="risk.summaryChanged || undefined"
                aria-live="polite"
              >
                <ChatRefText
                  v-if="risk.summary.text"
                  :text="risk.summary.text"
                  data-summary-text
                  @open-agenda="openAgenda"
                  @open-task="openTask"
                  @open-test="openTest"
                />
                <p
                  v-if="risk.summary.status === 'streaming' && !risk.summary.text"
                  class="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <Loader2 class="size-3.5 animate-spin" />
                  분석을 준비하는 중…
                </p>
                <p
                  v-else-if="risk.summary.status === 'stopped'"
                  class="text-xs text-muted-foreground"
                >
                  멈췄습니다.
                </p>
                <p
                  v-else-if="risk.summary.status === 'error'"
                  class="text-xs text-destructive"
                  role="alert"
                  data-summary-error
                >
                  {{ risk.summary.error }}
                </p>
              </div>
            </section>
          </div>

          <RiskTable @open="openDetail" />
        </template>

        <div
          v-else-if="tab === 'now' && risk.loading"
          class="flex h-[110px] items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 class="size-4 animate-spin" />
          리스크를 받는 중입니다.
        </div>
      </div>
    </div>

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
    <RiskSettingsDialog v-model:open="settingsOpen" />
    <RiskAnalysisTitleDialog
      v-model:open="saveOpen"
      heading="분석 저장"
      description="제목을 붙여 '저장한 분석' 게시판에 남깁니다. 글과 그때의 리스크 줄은 고칠 수 없습니다."
      :initial="saveTitle"
      submit-label="저장"
      :submit="submitSave"
    />
  </AppShell>
</template>
