<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Clock, ThumbsUp, X } from 'lucide-vue-next'
import TestSignalChips from '@/components/app/TestSignalChips.vue'
import TestStatusBadge from '@/components/app/TestStatusBadge.vue'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { dayTime } from '@/lib/date'
import { testSinceLabel, testStatusLabel, testStatusProblem } from '@/lib/testcase'
import { useDataStore } from '@/stores/data'
import { useTestStore } from '@/stores/test'
import type { TestRow, TestStatus, TestStatusInput } from '@/types/domain'

/* 상태 바꾸기 — 결과 버튼은 [성공] · [실패] 둘이다. 작성 중 · 준비됨 · 테스트 중 · 막힘은 상세 위쪽 상태 칸에서 고르고,
   그 칸이 pick 을 부른다. 실패 · 막힘은 여기서 메모를 받은 뒤 보낸다.
   이력은 없다 — 지금 상태 · N일째 · 누가 바꿨는지만 보이고 다시 돌리면 덮어쓴다 (Q54).
   묶음은 직접 돌리지 않는다 — 버튼 대신 하위 요약을 보인다 */
const props = defineProps<{ row: TestRow }>()
const emit = defineEmits<{
  (e: 'set', input: TestStatusInput): void
  (e: 'open-test', id: string): void
}>()

const data = useDataStore()
const testStore = useTestStore()

const test = computed(() => props.row.test)
const changedBy = computed(() => data.memberName(test.value.statusChangedBy))

/* 실패 · 막힘의 메모 칸 — 누르면 열리고 [남기기] 로 보낸다 */
const asking = ref<'fail' | 'blocked' | null>(null)
const note = ref('')
const problem = ref('')

watch(
  () => test.value.id,
  () => {
    asking.value = null
    problem.value = ''
  },
)

function ask(status: 'fail' | 'blocked') {
  asking.value = status
  note.value = test.value.status === status ? test.value.resultNote : ''
  problem.value = ''
}

const form = ref<HTMLElement | null>(null)

/** 상태 칸 · 버튼이 고른 상태 — 실패 · 막힘은 메모 칸을 열고, 그 밖은 바로 보낸다 */
async function pick(status: TestStatus) {
  if (status === 'fail' || status === 'blocked') {
    ask(status)
    await nextTick()
    form.value?.scrollIntoView?.({ block: 'nearest' })
    form.value?.querySelector('textarea')?.focus()
    return
  }
  asking.value = null
  emit('set', { status })
}

defineExpose({ pick })

function submit() {
  const status = asking.value
  if (!status) return
  const p = testStatusProblem(status, note.value)
  const first = Object.values(p)[0]
  if (first) {
    problem.value = first
    return
  }
  emit('set', { status, note: note.value.trim() })
  asking.value = null
}

/* 묶음의 하위 요약 — 상태별 수와 하위 줄 */
const children = computed(() => (testStore.childrenOf[test.value.id] ?? []).map(testStore.toRow))
const childCounts = computed(() => {
  const counts: Partial<Record<TestStatus, number>> = {}
  for (const c of children.value) counts[c.status] = (counts[c.status] ?? 0) + 1
  return (['fail', 'blocked', 'testing', 'draft', 'ready', 'pass'] as TestStatus[])
    .filter((s) => counts[s])
    .map((s) => ({ status: s, n: counts[s]! }))
})
</script>

<template>
  <section class="flex flex-col gap-3" data-test-status-section>
    <div class="flex items-baseline gap-2">
      <span class="text-xs font-medium">{{ row.isGroup ? '하위 테스트' : '상태' }}</span>
      <span class="grow" />
      <span class="text-xs text-muted-foreground">{{
        row.isGroup ? '묶음은 하위 상태 중 가장 나쁜 것을 보입니다' : '다시 돌리면 덮어씁니다'
      }}</span>
    </div>

    <template v-if="row.isGroup">
      <div class="flex flex-wrap items-center gap-2" data-test-group-summary>
        <TestStatusBadge :status="row.status" />
        <span v-for="c in childCounts" :key="c.status" class="text-xs text-muted-foreground"
          >{{ testStatusLabel(c.status) }} {{ c.n }}</span
        >
        <TestSignalChips :signals="row.signals" />
      </div>
      <div class="flex flex-col overflow-hidden rounded-md border border-border">
        <div
          v-for="c in children"
          :key="c.test.id"
          class="flex min-h-[38px] items-center gap-3 border-b border-border px-3 py-1 last:border-b-0"
          :data-test-child="c.test.id"
        >
          <span class="shrink-0 text-xs text-muted-foreground">{{ c.test.key }}</span>
          <button
            type="button"
            class="min-w-0 grow truncate text-left text-[13px] underline-offset-4 hover:underline"
            @click="emit('open-test', c.test.id)"
          >
            {{ c.test.title }}
          </button>
          <TestSignalChips :signals="c.signals" />
          <TestStatusBadge :status="c.status" />
          <span class="w-[64px] shrink-0 text-right text-xs text-muted-foreground">{{
            c.isGroup ? '묶음' : c.test.statusDays === 0 ? '오늘부터' : `${c.test.statusDays}일째`
          }}</span>
        </div>
      </div>
    </template>

    <template v-else>
      <div
        class="flex flex-col gap-2 rounded-md border border-border px-3 py-2.5"
        :class="
          test.status === 'fail' || test.status === 'blocked'
            ? 'border-l-[3px] border-l-destructive'
            : ''
        "
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="flex items-center gap-1.5 text-sm font-medium" data-test-since>
            <Clock class="size-3 text-muted-foreground" />
            {{ testSinceLabel(test) }}
          </span>
          <span class="text-xs text-muted-foreground"
            >{{ changedBy ?? '알 수 없음' }} · {{ dayTime(test.statusChangedAt) }}</span
          >
          <TestSignalChips :signals="test.signals" />
        </div>
        <p v-if="test.resultNote" class="text-sm leading-relaxed text-pretty" data-test-result-note>
          {{ test.resultNote }}
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" @click="pick('pass')">
          <ThumbsUp class="size-3.5" />
          성공
        </Button>
        <Button variant="outline" size="sm" @click="pick('fail')">
          <X class="size-3.5" />
          실패
        </Button>
        <span class="text-xs text-muted-foreground"
          >작성 중 · 준비됨 · 테스트 중 · 막힘은 위 상태 칸에서 고릅니다</span
        >
      </div>

      <div
        v-if="asking"
        ref="form"
        class="flex flex-col gap-2 rounded-md border border-border bg-muted/50 p-3"
        data-test-status-form
      >
        <Textarea
          v-model="note"
          :placeholder="asking === 'fail' ? '무엇이 기대와 달랐나' : '무엇에 막혔나'"
          :aria-label="asking === 'fail' ? '실패 메모' : '막힘 메모'"
          class="min-h-[64px] bg-background text-sm"
        />
        <p v-if="problem" class="text-xs text-destructive">{{ problem }}</p>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="sm" @click="asking = null">취소</Button>
          <Button size="sm" @click="submit">
            {{ asking === 'fail' ? '실패로 남기기' : '막힘으로 남기기' }}
          </Button>
        </div>
      </div>
    </template>
  </section>
</template>
