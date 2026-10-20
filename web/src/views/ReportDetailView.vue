<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { ChevronLeft, Loader2, Trash2 } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import ChatRefText from '@/components/app/ChatRefText.vue'
import ReportAttentionTable from '@/components/app/ReportAttentionTable.vue'
import ReportFactsCards from '@/components/app/ReportFactsCards.vue'
import TaskDetailDialog from '@/components/app/TaskDetailDialog.vue'
import ThreadDetailDialog from '@/components/app/ThreadDetailDialog.vue'
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
import { dayTime } from '@/lib/date'
import { periodLabel } from '@/lib/progress'
import { riskSettingsLine } from '@/lib/risk'
import { useDataStore } from '@/stores/data'
import { useReportStore } from '@/stores/report'

/* 리포트 상세 — 저장된 facts 와 글을 그대로 그린다. 다시 계산하지 않는다(만든 때의 기록이다).
   근거 칩 · 손쓸 작업 칩을 누르면 작업 · 안건 상세 팝업 (docs/api/report.md '화면') */
const route = useRoute()
const router = useRouter()
const data = useDataStore()
const report = useReportStore()

const reportId = computed(() => String(route.params.reportId ?? ''))
const loadState = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
const loadError = ref('')
const r = computed(() => (loadState.value === 'ready' ? report.byId[reportId.value] : undefined))

async function load(id: string) {
  /* 방금 만든 리포트는 스토어가 이미 들고 있다 — 다시 받지 않는다 */
  const held = report.byId[id]
  if (held) {
    if (held.projectId !== data.currentProjectId) data.setProject(held.projectId)
    loadState.value = 'ready'
    return
  }
  loadState.value = 'loading'
  try {
    const got = await report.fetchOne(id)
    if (reportId.value !== id) return
    /* 다른 프로젝트의 리포트 주소로 들어왔으면 그 프로젝트로 옮긴다 — 칩은 그 프로젝트의 스냅샷에서 찾는다 */
    if (got.projectId !== data.currentProjectId) data.setProject(got.projectId)
    loadState.value = 'ready'
  } catch (e) {
    if (reportId.value !== id) return
    loadState.value = e instanceof ApiError && e.status === 404 ? 'missing' : 'error'
    loadError.value = messageOf(e)
  }
}
watch(reportId, (id) => void load(id), { immediate: true })

/* 보는 중에 위에서 프로젝트를 바꾸면 이 리포트는 그 프로젝트의 것이 아니다 — 목록으로 */
watch(
  () => data.currentProjectId,
  (projectId) => {
    if (r.value && r.value.projectId !== projectId) void router.replace('/reports')
  },
)

const peopleName = (memberId: string | null) =>
  memberId ? (data.memberName(memberId) ?? '알 수 없음') : '담당자 없음'

const removeOpen = ref(false)
const removing = ref(false)
async function remove() {
  if (!r.value || removing.value) return
  removing.value = true
  const ok = await report.remove(reportId.value)
  removing.value = false
  if (!ok) return
  removeOpen.value = false
  toast.success('리포트를 지웠습니다.')
  await router.replace('/reports')
}

const threadDetailId = ref<string | null>(null)
const taskDetailId = ref<string | null>(null)
const threadOpen = computed({
  get: () => threadDetailId.value !== null,
  set: (open: boolean) => {
    if (!open) threadDetailId.value = null
  },
})
const taskOpen = computed({
  get: () => taskDetailId.value !== null,
  set: (open: boolean) => {
    if (!open) taskDetailId.value = null
  },
})
function openThread(id: string) {
  taskDetailId.value = null
  threadDetailId.value = id
}
function openTask(id: string) {
  threadDetailId.value = null
  taskDetailId.value = id
}
</script>

<template>
  <AppShell>
    <div class="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-border px-[26px]">
      <RouterLink
        to="/reports"
        class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        data-report-back
      >
        <ChevronLeft class="size-3.5" />
        리포트
      </RouterLink>
    </div>

    <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
      <div class="flex w-full max-w-[900px] flex-col gap-4 pb-[26px]">
        <div
          v-if="loadState === 'loading'"
          class="flex h-[110px] items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 class="size-4 animate-spin" />
          리포트를 받는 중입니다.
        </div>
        <p
          v-else-if="!r"
          class="rounded-lg border border-border px-[17px] py-3 text-sm text-muted-foreground"
          role="alert"
          data-report-load-error
        >
          {{
            loadState === 'missing'
              ? '리포트를 찾을 수 없습니다. 지워졌거나 볼 수 없는 리포트입니다.'
              : loadError
          }}
        </p>

        <template v-else>
          <header class="flex items-start gap-4">
            <div class="flex min-w-0 grow flex-col gap-2">
              <h1 class="text-2xl font-semibold tracking-tight" data-report-heading>
                {{ periodLabel(r) }} 진행 리포트
              </h1>
              <p
                class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
                data-report-meta
              >
                <span>{{ data.memberName(r.createdBy) ?? '알 수 없음' }}</span>
                <span>·</span>
                <span>{{ dayTime(r.createdAt) }} 만듦</span>
                <span>·</span>
                <span>기준 {{ riskSettingsLine(r.facts.settings) }}</span>
              </p>
            </div>
            <Button
              v-if="report.canRemove(r)"
              variant="outline"
              class="shrink-0"
              data-report-remove
              @click="removeOpen = true"
            >
              <Trash2 class="size-4" />
              지우기
            </Button>
          </header>

          <ReportFactsCards :facts="r.facts" />

          <!-- AI 가 낸 글 — v-html 없이 줄바꿈만 살리고 근거만 칩으로 -->
          <section
            class="rounded-lg border border-border bg-card px-[17px] py-[15px] shadow-sm"
            aria-label="AI 리포트"
          >
            <ChatRefText
              :text="r.body"
              data-report-body
              @open-thread="openThread"
              @open-task="openTask"
            />
          </section>

          <section class="flex flex-col gap-2.5" aria-label="손쓸 작업">
            <div class="flex items-baseline gap-2">
              <h2 class="text-base font-semibold">손쓸 작업</h2>
              <span class="text-xs text-muted-foreground">{{ r.facts.attention.length }}건</span>
            </div>
            <ReportAttentionTable :attention="r.facts.attention" @open-task="openTask" />
          </section>

          <section class="flex flex-col gap-2.5" aria-label="사람별">
            <div class="flex items-baseline gap-2">
              <h2 class="text-base font-semibold">사람별</h2>
              <span class="text-xs text-muted-foreground">손쓸 작업이 많은 순</span>
            </div>
            <div class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/50 hover:bg-muted/50">
                    <TableHead class="h-10 text-xs font-medium text-muted-foreground"
                      >담당자</TableHead
                    >
                    <TableHead
                      class="h-10 w-[84px] text-right text-xs font-medium text-muted-foreground"
                      >진행 중</TableHead
                    >
                    <TableHead
                      class="h-10 w-[84px] text-right text-xs font-medium text-muted-foreground"
                      >막힘</TableHead
                    >
                    <TableHead
                      class="h-10 w-[84px] text-right text-xs font-medium text-muted-foreground"
                      >기한 지남</TableHead
                    >
                    <TableHead
                      class="h-10 w-[84px] text-right text-xs font-medium text-muted-foreground"
                      >끝낸 작업</TableHead
                    >
                    <TableHead
                      class="h-10 w-[84px] text-right text-xs font-medium text-muted-foreground"
                      >손쓸 작업</TableHead
                    >
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow
                    v-for="p in r.facts.people"
                    :key="p.memberId ?? 'none'"
                    class="hover:bg-transparent"
                    :data-report-person="p.memberId ?? 'none'"
                  >
                    <TableCell class="text-sm" :class="p.memberId ? '' : 'text-muted-foreground'">{{
                      peopleName(p.memberId)
                    }}</TableCell>
                    <TableCell class="text-right text-sm">{{ p.doing }}</TableCell>
                    <TableCell
                      class="text-right text-sm"
                      :class="p.blocked > 0 ? '' : 'text-muted-foreground'"
                      >{{ p.blocked }}</TableCell
                    >
                    <TableCell
                      class="text-right text-sm"
                      :class="
                        p.overdue > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'
                      "
                      >{{ p.overdue }}</TableCell
                    >
                    <TableCell class="text-right text-sm">{{ p.completed }}</TableCell>
                    <TableCell
                      class="text-right text-sm"
                      :class="
                        p.attentionTaskIds.length > 0 ? 'font-medium' : 'text-muted-foreground'
                      "
                      >{{ p.attentionTaskIds.length }}</TableCell
                    >
                  </TableRow>
                  <TableRow v-if="r.facts.people.length === 0" class="hover:bg-transparent">
                    <TableCell colspan="6" class="h-20 text-center text-sm text-muted-foreground">
                      맡은 작업이 있는 사람이 없습니다.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>
        </template>
      </div>
    </div>

    <Dialog v-model:open="removeOpen">
      <DialogContent class="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>리포트를 지울까요?</DialogTitle>
          <DialogDescription class="text-pretty">
            지운 리포트는 되돌릴 수 없고, 다음 리포트가 지난번과 견줄 때도 빠집니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="removeOpen = false">취소</Button>
          <Button
            variant="destructive"
            :disabled="removing"
            data-report-remove-confirm
            @click="remove"
          >
            <Loader2 v-if="removing" class="animate-spin" />
            지우기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <ThreadDetailDialog
      v-model:open="threadOpen"
      :thread-id="threadDetailId"
      @open-thread="openThread"
    />
    <TaskDetailDialog
      v-model:open="taskOpen"
      :task-id="taskDetailId"
      @open-task="openTask"
      @open-thread="openThread"
    />
  </AppShell>
</template>
