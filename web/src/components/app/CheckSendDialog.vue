<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CHECK_RECIPIENTS_MAX, CHECK_TEXT_MAX, checkTextProblem } from '@/lib/check'
import { useCheckStore } from '@/stores/check'
import { useDataStore } from '@/stores/data'
import type { CheckTargetType } from '@/types/domain'

/* 확인 요청 보내기 — 사람 여럿 + 한 줄. 쪽지가 아니라서 제목 · 첨부 · 기한이 없다.
   고를 수 있는 사람은 이 프로젝트의 활성 멤버, 나 빼고. 서버가 거절하면 그 message 를 그대로 띄운다 */
const props = defineProps<{ targetType: CheckTargetType; targetId: string; targetLabel: string }>()
const open = defineModel<boolean>('open', { required: true })

const data = useDataStore()
const checks = useCheckStore()

const people = computed(() => data.assignable.filter((m) => m.id !== data.currentMemberId))

const picked = ref<string[]>([])
const text = ref('')
const sending = ref(false)
const serverError = ref('')

watch(open, (isOpen) => {
  if (!isOpen) return
  picked.value = []
  text.value = ''
  serverError.value = ''
})

function toggle(memberId: string, on: boolean) {
  picked.value = on
    ? [...picked.value.filter((id) => id !== memberId), memberId]
    : picked.value.filter((id) => id !== memberId)
  serverError.value = ''
}

function edit(value: string | number) {
  text.value = String(value)
  serverError.value = ''
}

const left = computed(() => CHECK_TEXT_MAX - [...text.value].length)
const textProblem = computed(() => checkTextProblem(text.value))
const canSend = computed(
  () =>
    picked.value.length > 0 &&
    picked.value.length <= CHECK_RECIPIENTS_MAX &&
    textProblem.value === null &&
    !sending.value,
)

async function submit() {
  if (!canSend.value) return
  sending.value = true
  const result = await checks.send({
    targetType: props.targetType,
    targetId: props.targetId,
    /* 고른 순서가 아니라 멤버 목록 순서로 — 줄이 그 순서로 생긴다 */
    recipientIds: people.value.filter((m) => picked.value.includes(m.id)).map((m) => m.id),
    text: text.value,
  })
  sending.value = false
  if (result.ok) {
    toast.success(`${result.count}명에게 확인을 요청했습니다.`)
    open.value = false
  } else {
    serverError.value = result.message
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>확인 요청</DialogTitle>
        <DialogDescription class="truncate">{{ targetLabel }}</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4 py-1" data-check-send @submit.prevent="submit">
        <fieldset class="flex flex-col gap-1.5">
          <legend class="pb-1.5 text-sm font-medium">받는 사람</legend>
          <p v-if="people.length === 0" class="text-xs text-muted-foreground">
            이 프로젝트에 요청을 보낼 다른 멤버가 없습니다.
          </p>
          <div
            v-else
            class="flex max-h-48 flex-col overflow-y-auto rounded-md border border-border"
          >
            <label
              v-for="m in people"
              :key="m.id"
              class="flex min-h-9 cursor-pointer items-center gap-2.5 border-b border-border px-3 text-sm last:border-b-0 hover:bg-accent"
            >
              <Checkbox
                :model-value="picked.includes(m.id)"
                :data-recipient="m.id"
                @update:model-value="(v) => toggle(m.id, v === true)"
              />
              {{ m.name }}
            </label>
          </div>
        </fieldset>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-baseline">
            <Label for="check-text" class="grow">내용</Label>
            <span
              class="text-xs"
              :class="left <= 0 ? 'text-foreground' : 'text-muted-foreground'"
              data-check-left
              >{{ left }}자 남음</span
            >
          </div>
          <Input
            id="check-text"
            :model-value="text"
            :maxlength="CHECK_TEXT_MAX"
            autocomplete="off"
            placeholder="예: 구성 순서 봐 주세요"
            data-check-text
            @update:model-value="edit"
          />
        </div>

        <p v-if="serverError" class="text-xs text-destructive" role="alert" data-check-error>
          {{ serverError }}
        </p>
        <button type="submit" class="hidden" />
      </form>

      <DialogFooter>
        <Button variant="outline" @click="open = false">취소</Button>
        <Button :disabled="!canSend" data-check-submit @click="submit">
          <Loader2 v-if="sending" class="animate-spin" />
          보내기
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
