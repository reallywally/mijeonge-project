<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import CheckStateLabel from '@/components/app/CheckStateLabel.vue'
import CheckThreadChip from '@/components/app/CheckThreadChip.vue'
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
   보낸 것은 한 번에 보낸 묶음(결정 하나)이 한 줄이고, 펼치면 사람별이다.
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
/** 요청이 알린 결정 한 줄 */
const decisionText = (entryId: string) =>
  data.allEntries.find((e) => e.id === entryId)?.text ?? '지워진 결정'

const busyId = ref<string | null>(null)
async function confirm(checkId: string) {
  if (busyId.value) return
  busyId.value = checkId
  await checks.confirm(checkId)
  busyId.value = null
}

const expanded = ref<string[]>([])
function toggle(entryId: string) {
  expanded.value = expanded.value.includes(entryId)
    ? expanded.value.filter((id) => id !== entryId)
    : [...expanded.value, entryId]
}

/* 칩을 누르면 안건 상세 팝업. 이 화면 안에서만 여닫으므로 주소를 바꾸지 않는다 */
const threadDetailId = ref<string | null>(null)
const threadOpen = computed({
  get: () => threadDetailId.value !== null,
  set: (open: boolean) => {
    if (!open) threadDetailId.value = null
  },
})

function openThread(id: string) {
  threadDetailId.value = id
}
</script>

<template>
  <AppShell>
    <div class="flex h-11 shrink-0 items-center gap-2.5 border-b border-border bg-card px-6">
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
            <h1 class="text-[22px] font-bold tracking-[-0.025em]">확인 요청</h1>
            <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
              결정된 안건의 '이 결정 확인해 주세요' 입니다. 대기와 확인 두 상태뿐이고, 확인하면 보낸
              사람에게 시각이 남습니다.
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
          class="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
          role="tabpanel"
          aria-label="받은 것"
        >
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/60 hover:bg-muted/60">
                <TableHead class="h-10 text-xs font-medium text-muted-foreground"
                  >안건 · 결정</TableHead
                >
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
                  <div class="flex min-w-0">
                    <CheckThreadChip :thread-id="c.threadId" @open="openThread" />
                  </div>
                  <p class="mt-1.5 truncate text-sm" data-check-decision>
                    {{ decisionText(c.entryId) }}
                  </p>
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

        <!-- 보낸 것 — 최근 순, 한 번에 보낸 묶음이 한 줄 -->
        <div
          v-else
          class="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
          role="tabpanel"
          aria-label="보낸 것"
        >
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/60 hover:bg-muted/60">
                <TableHead class="h-10 text-xs font-medium text-muted-foreground"
                  >안건 · 결정</TableHead
                >
                <TableHead class="h-10 w-[112px] text-xs font-medium text-muted-foreground"
                  >보낸 날</TableHead
                >
                <TableHead
                  class="h-10 w-[136px] text-right text-xs font-medium text-muted-foreground"
                  >확인</TableHead
                >
              </TableRow>
            </TableHeader>
            <TableBody>
              <template v-for="b in checks.sent" :key="b.entryId">
                <TableRow class="hover:bg-transparent" :data-check-sent="b.entryId">
                  <TableCell class="min-w-0 py-2.5">
                    <div class="flex min-w-0">
                      <CheckThreadChip :thread-id="b.threadId" @open="openThread" />
                    </div>
                    <p class="mt-1.5 truncate text-sm" data-check-decision>
                      {{ decisionText(b.entryId) }}
                    </p>
                  </TableCell>
                  <TableCell class="text-sm text-muted-foreground">{{
                    dayTime(b.createdAt)
                  }}</TableCell>
                  <TableCell class="text-right">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-sm hover:bg-accent"
                      :aria-expanded="expanded.includes(b.entryId)"
                      data-check-expand
                      @click="toggle(b.entryId)"
                    >
                      <span data-check-progress>확인 {{ b.confirmed }} / {{ b.rows.length }}</span>
                      <ChevronDown
                        v-if="expanded.includes(b.entryId)"
                        class="size-3.5 text-muted-foreground"
                      />
                      <ChevronRight v-else class="size-3.5 text-muted-foreground" />
                    </button>
                  </TableCell>
                </TableRow>
                <TableRow
                  v-if="expanded.includes(b.entryId)"
                  class="bg-muted/50 hover:bg-muted/50"
                  :data-check-people="b.entryId"
                >
                  <TableCell colspan="3" class="py-1.5">
                    <ol class="flex flex-col">
                      <li
                        v-for="c in b.rows"
                        :key="c.id"
                        class="flex min-h-8 items-center gap-2.5 pl-6 text-sm"
                        :data-check-row="c.id"
                      >
                        <span class="min-w-0 grow truncate">{{ nameOf(c.recipientId) }}</span>
                        <CheckStateLabel :confirmed-at="c.confirmedAt" />
                      </li>
                    </ol>
                  </TableCell>
                </TableRow>
              </template>
              <TableRow v-if="checks.sent.length === 0" class="hover:bg-transparent">
                <TableCell colspan="3" class="h-20 text-center text-sm text-muted-foreground">
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
  </AppShell>
</template>
