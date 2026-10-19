<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Check, ChevronDown, ChevronRight, Loader2, Send } from 'lucide-vue-next'
import CheckStateLabel from '@/components/app/CheckStateLabel.vue'
import { Button } from '@/components/ui/button'
import { CHECK_BLOCK_LABEL, type CheckBatch } from '@/lib/check'
import { dayTime } from '@/lib/date'
import { useCheckStore } from '@/stores/check'
import { useDataStore } from '@/stores/data'

/* 안건 상세의 확인 요청 — 결정된 안건의 '이 결정 확인해 주세요' 버튼 하나.
   누르면 바로 보낸다(내용 · 사람 고르기 없음). 받는 사람은 서버가 정하고, 여기서는 같은 셈으로 미리 센다.
   보낸 뒤에는 버튼 자리에 이 결정의 확인 현황, 앞 결정 묶음은 접어서 아래에 둔다 */
const props = defineProps<{ threadId: string }>()

const data = useDataStore()
const checks = useCheckStore()

const state = computed(() => checks.forThread(props.threadId))
const recipientNames = computed(() =>
  (state.value?.recipientIds ?? []).map((id) => data.memberName(id) ?? '알 수 없음'),
)
const showNames = ref(false)
const showOlder = ref(false)
const sending = ref(false)
const busyId = ref<string | null>(null)

watch(
  () => props.threadId,
  () => {
    showNames.value = false
    showOlder.value = false
    void checks.load()
  },
  { immediate: true },
)

async function send() {
  if (sending.value || state.value?.block !== null) return
  sending.value = true
  const count = await checks.send(props.threadId)
  sending.value = false
  if (count !== null) toast.success(`${count}명에게 확인을 요청했습니다.`)
}

async function confirm(checkId: string) {
  if (busyId.value) return
  busyId.value = checkId
  await checks.confirm(checkId)
  busyId.value = null
}

const nameOf = (id: string) => data.memberName(id) ?? '알 수 없음'
const decisionText = (b: CheckBatch) =>
  data.allEntries.find((e) => e.id === b.entryId)?.text ?? '지워진 결정'
</script>

<template>
  <section
    v-if="state"
    class="flex min-w-0 flex-col gap-2.5"
    aria-label="확인 요청"
    data-check-section
  >
    <div class="flex items-center gap-2">
      <span class="text-xs font-medium">확인 요청</span>
      <span class="text-xs text-muted-foreground">결정을 연결 작업 담당자 · 참조에게 알립니다</span>
      <Loader2
        v-if="checks.loading"
        class="size-3 animate-spin text-muted-foreground"
        aria-label="불러오는 중"
      />
    </div>

    <p v-if="checks.error && !checks.loaded" class="text-xs text-destructive">
      {{ checks.error }}
    </p>

    <!-- 이 결정으로 보낸 뒤 — 버튼 자리에 확인 현황 -->
    <div
      v-else-if="state.current"
      class="flex flex-col rounded-md border border-border"
      data-check-current
    >
      <div class="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <span class="font-medium" data-check-progress
          >이 결정 확인 {{ state.current.confirmed }} / {{ state.current.rows.length }}</span
        >
        <span class="grow" />
        <span class="text-muted-foreground"
          >{{ nameOf(state.current.senderId) }} · {{ dayTime(state.current.createdAt) }} 보냄</span
        >
      </div>
      <ol class="flex flex-col">
        <li
          v-for="c in state.current.rows"
          :key="c.id"
          class="flex min-h-9 items-center gap-2.5 border-b border-border px-3 py-1 text-xs last:border-b-0"
          :data-check-row="c.id"
        >
          <span class="min-w-0 grow truncate text-sm">{{ nameOf(c.recipientId) }}</span>
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
    </div>

    <!-- 아직 안 보냈거나 못 보낼 때 -->
    <div v-else class="flex flex-col gap-1.5">
      <div class="flex items-center gap-2.5">
        <Button
          variant="outline"
          size="xs"
          :disabled="state.block !== null || sending"
          data-check-send
          @click="send"
        >
          <Loader2 v-if="sending" class="animate-spin" />
          <Send v-else />
          확인 요청
        </Button>
        <button
          v-if="state.recipientIds.length > 0"
          type="button"
          class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          :title="recipientNames.join(', ')"
          :aria-expanded="showNames"
          data-check-recipients
          @click="showNames = !showNames"
        >
          받는 사람 {{ state.recipientIds.length }}명
          <ChevronDown v-if="showNames" class="size-3" />
          <ChevronRight v-else class="size-3" />
        </button>
      </div>
      <p
        v-if="showNames && state.recipientIds.length > 0"
        class="text-xs text-muted-foreground"
        data-check-recipient-names
      >
        {{ recipientNames.join(' · ') }}
      </p>
      <p
        v-if="state.block && checks.loaded"
        class="text-xs text-muted-foreground"
        :data-check-block="state.block"
      >
        {{ CHECK_BLOCK_LABEL[state.block] }}
      </p>
    </div>

    <!-- 앞 결정으로 보낸 묶음 — 결정이 바뀌어도 대기 줄은 그대로 남는다 -->
    <div v-if="state.older.length > 0" class="flex flex-col gap-1.5">
      <button
        type="button"
        class="inline-flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
        :aria-expanded="showOlder"
        data-check-older-toggle
        @click="showOlder = !showOlder"
      >
        <ChevronDown v-if="showOlder" class="size-3" />
        <ChevronRight v-else class="size-3" />
        앞 결정 {{ state.older.length }}건
      </button>
      <template v-if="showOlder">
        <div
          v-for="b in state.older"
          :key="b.entryId"
          class="flex flex-col rounded-md border border-border"
          :data-check-older="b.entryId"
        >
          <div
            class="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground"
          >
            <span class="min-w-0 grow truncate line-through">{{ decisionText(b) }}</span>
            <span class="shrink-0">확인 {{ b.confirmed }} / {{ b.rows.length }}</span>
          </div>
          <ol class="flex flex-col">
            <li
              v-for="c in b.rows"
              :key="c.id"
              class="flex min-h-9 items-center gap-2.5 border-b border-border px-3 py-1 text-xs last:border-b-0"
              :data-check-row="c.id"
            >
              <span class="min-w-0 grow truncate text-sm">{{ nameOf(c.recipientId) }}</span>
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
        </div>
      </template>
    </div>
  </section>
</template>
