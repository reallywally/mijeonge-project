<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, Loader2, RotateCcw } from 'lucide-vue-next'
import HistoryTimeline from '@/components/app/HistoryTimeline.vue'
import { Button } from '@/components/ui/button'
import { historyView, type HistoryKind, type HistoryNames } from '@/lib/history'
import { useDataStore } from '@/stores/data'
import { useHistoryStore } from '@/stores/history'
import { usePartStore } from '@/stores/part'
import { useTestStore } from '@/stores/test'

/* 작업 · 테스트 상세 아래의 '변경 이력'. 기본은 접어 두고 펼칠 때 부른다 — 상세를 열 때마다 부르지 않게.
   펼친 채로 그 작업 · 테스트를 바꾸면(스토어가 쓰기를 마치면) 다시 부른다 */
const props = defineProps<{ kind: HistoryKind; targetId: string }>()

const data = useDataStore()
const partStore = usePartStore()
const testStore = useTestStore()
const history = useHistoryStore()

const expanded = ref(false)

/* 다른 작업 · 테스트로 옮기면 다시 접는다 */
watch(
  () => [props.kind, props.targetId],
  () => {
    expanded.value = false
  },
)

watch(
  () => [expanded.value, history.revisionOf(props.kind, props.targetId)] as const,
  ([open]) => {
    if (open) void history.load(props.kind, props.targetId)
  },
)

const status = computed(() => history.statusOf(props.kind, props.targetId))

/* 이름은 지금의 것으로 찾는다 — 이력에는 id 만 남는다 */
const names: HistoryNames = {
  member: (id) => data.memberName(id),
  part: (id) => partStore.partName(id),
  task: (id) => data.allTasks.find((t) => t.id === id)?.key ?? null,
  thread: (id) => data.allThreads.find((t) => t.id === id)?.title ?? null,
  test: (id) => testStore.byId[id]?.key ?? null,
}

const entries = computed(() =>
  historyView(props.kind, history.entriesOf(props.kind, props.targetId), names),
)
</script>

<template>
  <section class="flex min-w-0 flex-col gap-2.5" aria-label="변경 이력" data-history>
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="inline-flex items-center gap-1 text-xs font-medium hover:text-foreground"
        :aria-expanded="expanded"
        data-history-toggle
        @click="expanded = !expanded"
      >
        <ChevronDown v-if="expanded" class="size-3.5" />
        <ChevronRight v-else class="size-3.5" />
        변경 이력
      </button>
      <span v-if="expanded && status === 'ready'" class="text-xs text-muted-foreground">
        {{ entries.length }}건
      </span>
      <Loader2
        v-if="expanded && status === 'loading' && entries.length > 0"
        class="size-3 animate-spin text-muted-foreground"
        aria-label="불러오는 중"
      />
    </div>

    <template v-if="expanded">
      <p
        v-if="status === 'loading' && entries.length === 0"
        class="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Loader2 class="size-3.5 animate-spin" />
        변경 이력을 불러오는 중입니다.
      </p>
      <div
        v-else-if="status === 'error' && entries.length === 0"
        class="flex items-center gap-2 text-xs text-destructive"
      >
        <span>{{ history.errorOf(kind, targetId) }}</span>
        <Button variant="outline" size="xs" @click="history.load(kind, targetId)">
          <RotateCcw />
          다시 불러오기
        </Button>
      </div>
      <p
        v-else-if="status === 'ready' && entries.length === 0"
        class="text-xs text-muted-foreground"
      >
        남은 변경 이력이 없습니다.
      </p>
      <HistoryTimeline v-if="entries.length > 0" :entries="entries" />
    </template>
  </section>
</template>
