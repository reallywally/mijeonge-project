<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
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
import { RISK_ANALYSIS_TITLE_MAX } from '@/lib/risk'

/* 분석 제목 창 — [저장](제목 붙여 올리기)과 상세의 [제목 고치기] 가 같이 쓴다.
   submit 이 못 했다는 한 줄을 돌려주면 창을 닫지 않고 그 줄을 띄운다 */
const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{
  heading: string
  description: string
  initial: string
  submitLabel: string
  submit: (title: string) => Promise<string | null>
}>()

const title = ref('')
const problem = ref('')
const saving = ref(false)

watch(open, (now) => {
  if (!now) return
  title.value = props.initial
  problem.value = ''
})

const trimmed = computed(() => title.value.trim())
const canSubmit = computed(
  () =>
    !saving.value && trimmed.value.length > 0 && trimmed.value.length <= RISK_ANALYSIS_TITLE_MAX,
)

async function onSubmit() {
  if (!canSubmit.value) return
  saving.value = true
  problem.value = ''
  const failed = await props.submit(trimmed.value)
  saving.value = false
  if (failed) problem.value = failed
  else open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[460px]">
      <DialogHeader>
        <DialogTitle>{{ heading }}</DialogTitle>
        <DialogDescription class="text-pretty">{{ description }}</DialogDescription>
      </DialogHeader>

      <form
        class="flex flex-col gap-1.5 py-1"
        data-analysis-title-dialog
        @submit.prevent="onSubmit"
      >
        <Label for="risk-analysis-title">제목</Label>
        <Input
          id="risk-analysis-title"
          v-model="title"
          :maxlength="RISK_ANALYSIS_TITLE_MAX"
          :aria-invalid="problem !== ''"
          data-analysis-title-input
        />
        <div class="flex items-start gap-2.5">
          <p class="grow text-xs text-destructive" role="alert" data-analysis-title-problem>
            {{ problem }}
          </p>
          <span class="shrink-0 text-xs text-muted-foreground tabular-nums"
            >{{ title.length }}/{{ RISK_ANALYSIS_TITLE_MAX }}</span
          >
        </div>
        <button type="submit" class="hidden" />
      </form>

      <DialogFooter>
        <Button variant="outline" @click="open = false">취소</Button>
        <Button :disabled="!canSubmit" data-analysis-title-submit @click="onSubmit">
          <Loader2 v-if="saving" class="animate-spin" />
          {{ submitLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
