<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { FlaskConical, Plus } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { testStatusLabel } from '@/lib/testcase'
import { useTestStore } from '@/stores/test'
import type { TestRef, TestStatus } from '@/types/domain'

/* 작업 · 안건 상세의 '이 작업(안건)을 태그한 테스트' — 읽기 전용 칩(상태 색)과 [테스트 추가].
   테스트는 여기서 고치지 않는다 — 칩을 누르면 테스트 상세로, [테스트 추가] 는 이 작업 · 안건을 태그로 건 채 연다.
   따로 부르지 않고 테스트 목록에서 거른다 (docs/api/test.md) */
const props = defineProps<{ kind: TestRef['kind']; refId: string }>()

const testStore = useTestStore()
/* 상세 팝업은 여러 화면이 띄운다 — 화면마다 이벤트를 잇지 않고 여기서 바로 테스트 화면으로 간다 */
const router = useRouter()

onMounted(() => testStore.ensure())

const rows = computed(() => testStore.testsTagging(props.kind, props.refId))
const noun = computed(() => (props.kind === 'task' ? '작업' : '안건'))

const DOT: Record<TestStatus, string> = {
  draft: 'bg-border',
  ready: 'bg-muted-foreground',
  testing: 'bg-primary',
  pass: 'bg-primary',
  fail: 'bg-destructive',
  blocked: 'bg-destructive',
}

function openTest(id: string) {
  void router?.push(`/tests/${id}`)
}

function addTest() {
  void router?.push({ path: '/tests/new', query: { [props.kind]: props.refId } })
}
</script>

<template>
  <section class="flex min-w-0 flex-col gap-2.5" data-tagged-tests>
    <div class="flex items-center gap-2">
      <span class="text-xs font-medium">이 {{ noun }}을 태그한 테스트</span>
      <span class="text-xs text-muted-foreground">{{ rows.length }}건</span>
      <span class="grow" />
      <Button variant="outline" size="sm" class="h-7 text-xs" @click="addTest">
        <Plus class="size-3.5" />
        테스트 추가
      </Button>
    </div>
    <div v-if="rows.length" class="flex flex-wrap gap-1.5">
      <button
        v-for="r in rows"
        :key="r.test.id"
        type="button"
        class="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs underline-offset-4 hover:underline"
        :class="r.status === 'fail' || r.status === 'blocked' ? 'border-destructive/40' : ''"
        :title="`${testStatusLabel(r.status)} — ${r.test.title}`"
        :data-tagged-test="r.test.id"
        @click="openTest(r.test.id)"
      >
        <span class="size-1.5 shrink-0 rounded-full" :class="DOT[r.status]" />
        <span class="shrink-0 text-muted-foreground">{{ r.test.key }}</span>
        <span class="truncate">{{ r.test.title }}</span>
        <span
          class="shrink-0"
          :class="
            r.status === 'fail' || r.status === 'blocked'
              ? 'text-destructive'
              : 'text-muted-foreground'
          "
          >{{ testStatusLabel(r.status) }}</span
        >
      </button>
    </div>
    <p v-else class="flex items-center gap-1.5 text-xs text-muted-foreground">
      <FlaskConical class="size-3.5" />
      이 {{ noun }}을 태그한 테스트가 없습니다.
    </p>
  </section>
</template>
