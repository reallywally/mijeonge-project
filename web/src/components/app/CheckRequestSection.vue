<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowRight, Check, Loader2, Send } from 'lucide-vue-next'
import CheckSendDialog from '@/components/app/CheckSendDialog.vue'
import CheckStateLabel from '@/components/app/CheckStateLabel.vue'
import { Button } from '@/components/ui/button'
import { dayTime } from '@/lib/date'
import { useCheckStore } from '@/stores/check'
import { useDataStore } from '@/stores/data'
import type { CheckTargetType } from '@/types/domain'

/* 작업 · 안건 상세에 붙는 확인 요청 — [확인 요청] 버튼과 여기에 걸린 요청 한 줄씩.
   상세를 열 때 프로젝트의 요청을 다시 받는다. 내가 받은 대기면 [확인] */
const props = defineProps<{ targetType: CheckTargetType; targetId: string; targetLabel: string }>()

const data = useDataStore()
const checks = useCheckStore()

const rows = computed(() => checks.forTarget(props.targetType, props.targetId))
const sendOpen = ref(false)
const busyId = ref<string | null>(null)

watch(
  () => [props.targetType, props.targetId],
  () => void checks.load(),
  { immediate: true },
)

async function confirm(checkId: string) {
  if (busyId.value) return
  busyId.value = checkId
  await checks.confirm(checkId)
  busyId.value = null
}

const nameOf = (id: string) => data.memberName(id) ?? '알 수 없음'
</script>

<template>
  <section class="flex min-w-0 flex-col gap-2.5" aria-label="확인 요청" data-check-section>
    <div class="flex items-center gap-2">
      <span class="text-xs font-medium">확인 요청</span>
      <span class="text-xs text-muted-foreground">{{ rows.length }}건</span>
      <Loader2
        v-if="checks.loading"
        class="size-3 animate-spin text-muted-foreground"
        aria-label="불러오는 중"
      />
      <span class="grow" />
      <Button
        variant="outline"
        size="xs"
        :disabled="!data.currentMemberId"
        data-check-open
        @click="sendOpen = true"
      >
        <Send />
        확인 요청
      </Button>
    </div>

    <p v-if="checks.error && rows.length === 0" class="text-xs text-destructive">
      {{ checks.error }}
    </p>
    <p v-else-if="rows.length === 0" class="text-xs text-muted-foreground">걸린 요청이 없습니다.</p>

    <ol v-else class="flex flex-col rounded-md border border-border">
      <li
        v-for="c in rows"
        :key="c.id"
        class="flex min-h-10 items-center gap-2.5 border-b border-border px-3 py-1.5 text-xs last:border-b-0"
        :data-check-row="c.id"
      >
        <span class="flex shrink-0 items-center gap-1 text-muted-foreground">
          {{ nameOf(c.senderId) }}
          <ArrowRight class="size-3" />
          <span class="text-foreground">{{ nameOf(c.recipientId) }}</span>
        </span>
        <span class="min-w-0 grow truncate text-sm" :title="c.text">{{ c.text }}</span>
        <time class="shrink-0 text-muted-foreground" :datetime="c.createdAt">{{
          dayTime(c.createdAt)
        }}</time>
        <Button
          v-if="checks.canConfirm(c)"
          size="xs"
          :disabled="busyId === c.id"
          data-check-confirm
          @click="confirm(c.id)"
        >
          <Check />
          확인
        </Button>
        <CheckStateLabel v-else :confirmed-at="c.confirmedAt" />
      </li>
    </ol>

    <CheckSendDialog
      v-model:open="sendOpen"
      :target-type="targetType"
      :target-id="targetId"
      :target-label="targetLabel"
    />
  </section>
</template>
