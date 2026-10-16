<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowRight, Check, Loader2, RefreshCw } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import CheckStateLabel from '@/components/app/CheckStateLabel.vue'
import CheckTargetChip from '@/components/app/CheckTargetChip.vue'
import TaskDetailDialog from '@/components/app/TaskDetailDialog.vue'
import ThreadDetailDialog from '@/components/app/ThreadDetailDialog.vue'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { dayTime } from '@/lib/date'
import { useCheckStore } from '@/stores/check'
import { useDataStore } from '@/stores/data'

/* 확인 요청 — 받은 것 · 보낸 것. 프로젝트의 요청 전부를 받아 여기서 거르고 줄 세운다.
   [내 파트 | 전체] 는 두지 않는다 — 나에게 온 것 · 내가 보낸 것은 파트와 상관없다 */
const data = useDataStore()
const checks = useCheckStore()

watch(
  () => data.currentProjectId,
  () => void checks.load(),
  { immediate: true },
)

type Tab = 'received' | 'sent'
const tab = ref<Tab>('received')
const tabs = computed<{ key: Tab; label: string; count: number }[]>(() => [
  { key: 'received', label: '받은 것', count: checks.receivedPending.length },
  { key: 'sent', label: '보낸 것', count: checks.sent.length },
])

const nameOf = (id: string) => data.memberName(id) ?? '알 수 없음'

const busyId = ref<string | null>(null)
async function confirm(checkId: string) {
  if (busyId.value) return
  busyId.value = checkId
  await checks.confirm(checkId)
  busyId.value = null
}

/* 칩을 누르면 기존 상세 팝업. 이 화면 안에서만 여닫으므로 주소를 바꾸지 않는다 */
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
      <span class="text-xs font-medium text-muted-foreground">확인 요청</span>
      <div class="grow" />
      <div
        role="tablist"
        aria-label="받은 것 · 보낸 것"
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
          @click="tab = t.key"
        >
          {{ t.label }}
          <span v-if="t.count > 0" class="text-muted-foreground">{{ t.count }}</span>
        </button>
      </div>
    </div>

    <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
      <div class="flex w-full max-w-[900px] flex-col gap-4 pb-[26px]">
        <header class="flex items-end gap-2.5">
          <div class="flex grow flex-col gap-2.5">
            <h1 class="text-2xl font-semibold tracking-tight">확인 요청</h1>
            <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
              작업 · 안건에 걸린 '확인해 주세요' 한 줄입니다. 대기와 확인 두 상태뿐이고, 확인하면
              보낸 사람에게 시각이 남습니다.
            </p>
          </div>
          <Button
            variant="outline"
            class="shrink-0"
            :disabled="checks.loading"
            @click="checks.load()"
          >
            <Loader2 v-if="checks.loading" class="size-4 animate-spin" />
            <RefreshCw v-else class="size-4" />
            새로 고침
          </Button>
        </header>

        <p
          v-if="checks.error"
          class="rounded-lg border border-destructive/40 px-[17px] py-3 text-sm text-destructive"
          role="alert"
        >
          {{ checks.error }}
        </p>

        <div
          v-if="!checks.loaded && checks.loading"
          class="flex h-[110px] items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 class="size-4 animate-spin" />
          확인 요청을 받는 중입니다.
        </div>

        <!-- 받은 것 — 대기 먼저(오래된 순), 그다음 확인(최근 확인 순) -->
        <div
          v-else-if="tab === 'received'"
          class="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
          role="tabpanel"
          aria-label="받은 것"
        >
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/50 hover:bg-muted/50">
                <TableHead class="h-10 text-xs font-medium text-muted-foreground">내용</TableHead>
                <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground"
                  >보낸 사람</TableHead
                >
                <TableHead class="h-10 w-[112px] text-xs font-medium text-muted-foreground"
                  >보낸 날</TableHead
                >
                <TableHead
                  class="h-10 w-[136px] text-right text-xs font-medium text-muted-foreground"
                  >상태</TableHead
                >
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="c in checks.received"
                :key="c.id"
                class="hover:bg-transparent"
                :data-check-received="c.id"
              >
                <TableCell class="min-w-0 py-2.5">
                  <p class="truncate text-sm">{{ c.text }}</p>
                  <div class="mt-1.5 flex min-w-0">
                    <CheckTargetChip
                      :target-type="c.targetType"
                      :target-id="c.targetId"
                      @open-task="openTask"
                      @open-thread="openThread"
                    />
                  </div>
                </TableCell>
                <TableCell class="text-sm">{{ nameOf(c.senderId) }}</TableCell>
                <TableCell class="text-sm text-muted-foreground">{{
                  dayTime(c.createdAt)
                }}</TableCell>
                <TableCell class="text-right">
                  <Button
                    v-if="checks.canConfirm(c)"
                    size="sm"
                    :disabled="busyId === c.id"
                    data-check-confirm
                    @click="confirm(c.id)"
                  >
                    <Check />
                    확인
                  </Button>
                  <CheckStateLabel v-else :confirmed-at="c.confirmedAt" />
                </TableCell>
              </TableRow>
              <TableRow v-if="checks.received.length === 0" class="hover:bg-transparent">
                <TableCell colspan="4" class="h-20 text-center text-sm text-muted-foreground">
                  받은 확인 요청이 없습니다.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <!-- 보낸 것 — 최근 순 -->
        <div
          v-else
          class="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
          role="tabpanel"
          aria-label="보낸 것"
        >
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/50 hover:bg-muted/50">
                <TableHead class="h-10 text-xs font-medium text-muted-foreground">내용</TableHead>
                <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground"
                  >받는 사람</TableHead
                >
                <TableHead class="h-10 w-[112px] text-xs font-medium text-muted-foreground"
                  >보낸 날</TableHead
                >
                <TableHead
                  class="h-10 w-[136px] text-right text-xs font-medium text-muted-foreground"
                  >상태</TableHead
                >
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="c in checks.sent"
                :key="c.id"
                class="hover:bg-transparent"
                :data-check-sent="c.id"
              >
                <TableCell class="min-w-0 py-2.5">
                  <p class="truncate text-sm">{{ c.text }}</p>
                  <div class="mt-1.5 flex min-w-0">
                    <CheckTargetChip
                      :target-type="c.targetType"
                      :target-id="c.targetId"
                      @open-task="openTask"
                      @open-thread="openThread"
                    />
                  </div>
                </TableCell>
                <TableCell class="text-sm">
                  <span class="inline-flex items-center gap-1">
                    <ArrowRight class="size-3 text-muted-foreground" />
                    {{ nameOf(c.recipientId) }}
                  </span>
                </TableCell>
                <TableCell class="text-sm text-muted-foreground">{{
                  dayTime(c.createdAt)
                }}</TableCell>
                <TableCell class="text-right">
                  <CheckStateLabel :confirmed-at="c.confirmedAt" />
                </TableCell>
              </TableRow>
              <TableRow v-if="checks.sent.length === 0" class="hover:bg-transparent">
                <TableCell colspan="4" class="h-20 text-center text-sm text-muted-foreground">
                  보낸 확인 요청이 없습니다.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
    </div>

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
