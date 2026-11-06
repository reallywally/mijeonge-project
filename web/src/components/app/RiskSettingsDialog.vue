<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
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
import {
  DEFAULT_RISK_SETTINGS,
  RISK_SETTING_FIELDS,
  RISK_SETTING_GROUPS,
  riskSettingsProblems,
  type RiskSettingKey,
} from '@/lib/risk'
import { useRiskStore } from '@/stores/risk'
import type { RiskSettings } from '@/types/domain'

/* 기준 바꾸기 — 문턱값 일곱(지연 · 흔들림 · 등급)을 한 묶음으로 보낸다(부분 수정은 없다). 신호 점수는 못 바꾼다.
   화면이 먼저 막고, 그래도 서버가 422 를 내면 detail 을 그 칸에 붙인다 */
const open = defineModel<boolean>('open', { required: true })

const risk = useRiskStore()

function toDraft(s: RiskSettings): Record<RiskSettingKey, string> {
  return Object.fromEntries(RISK_SETTING_FIELDS.map((f) => [f.key, String(s[f.key])])) as Record<
    RiskSettingKey,
    string
  >
}

const draft = ref<Record<RiskSettingKey, string>>(toDraft(DEFAULT_RISK_SETTINGS))
const serverProblems = ref<Record<string, string>>({})
const saving = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) return
  draft.value = toDraft(risk.report?.settings ?? DEFAULT_RISK_SETTINGS)
  serverProblems.value = {}
})

/* 빈 칸은 0 이 아니라 '정수가 아님' 으로 본다 */
const parse = (raw: string) => (raw.trim() === '' ? Number.NaN : Number(raw))

const parsed = computed<RiskSettings>(
  () =>
    Object.fromEntries(
      RISK_SETTING_FIELDS.map((f) => [f.key, parse(draft.value[f.key])]),
    ) as unknown as RiskSettings,
)

const problems = computed(() => riskSettingsProblems(parsed.value))
const problemOf = (key: RiskSettingKey) => serverProblems.value[key] ?? problems.value[key] ?? null

function edit(key: RiskSettingKey, value: string | number) {
  draft.value = { ...draft.value, [key]: String(value) }
  /* 고친 칸의 서버 까닭은 뗀다. 대소 어긋남은 두 칸이 같이 걸려 있다 */
  const next = { ...serverProblems.value }
  delete next[key]
  if (key === 'mediumScore') delete next.highScore
  serverProblems.value = next
}

const canSubmit = computed(() => Object.keys(problems.value).length === 0 && !saving.value)

async function submit() {
  if (!canSubmit.value) return
  saving.value = true
  const result = await risk.saveSettings(parsed.value)
  saving.value = false
  if (result.ok) {
    toast.success('리스크 기준을 바꿨습니다.')
    open.value = false
  } else {
    serverProblems.value = result.detail
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-[460px]">
      <DialogHeader>
        <DialogTitle>기준 바꾸기</DialogTitle>
        <DialogDescription class="text-pretty">
          이 프로젝트의 안건 · 작업 · 테스트 리스크를 가르는 기준입니다. 팀의 회의 주기에 맞춰
          바꿉니다 — 신호마다 붙는 점수는 그대로입니다.
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4 py-1" @submit.prevent="submit">
        <fieldset
          v-for="g in RISK_SETTING_GROUPS"
          :key="g.label"
          class="flex flex-col gap-2.5"
          :data-setting-group="g.label"
        >
          <legend class="mb-2.5 text-xs font-medium text-muted-foreground">{{ g.label }}</legend>
          <div v-for="f in g.fields" :key="f.key" class="flex flex-col gap-1.5">
            <div class="flex items-center gap-2.5">
              <Label :for="`risk-${f.key}`" class="w-[96px] shrink-0">{{ f.label }}</Label>
              <Input
                :id="`risk-${f.key}`"
                :model-value="draft[f.key]"
                type="number"
                inputmode="numeric"
                :min="f.min"
                :max="f.max"
                class="w-[96px]"
                :aria-invalid="problemOf(f.key) !== null"
                :data-field="f.key"
                @update:model-value="(v) => edit(f.key, v)"
              />
              <span class="text-sm text-muted-foreground">{{ f.unit }}</span>
              <span class="grow text-right text-xs text-muted-foreground"
                >{{ f.min }} ~ {{ f.max }}</span
              >
            </div>
            <p
              v-if="problemOf(f.key)"
              class="pl-[106px] text-xs text-destructive"
              :data-problem="f.key"
            >
              {{ problemOf(f.key) }}
            </p>
          </div>
        </fieldset>
        <p class="text-xs leading-relaxed text-muted-foreground text-pretty">
          흔들림 — 세는 기간 안에 제목 · 본문이 '내용 변경' 번 이상 바뀌면 '내용 자주 바뀜', 기한을
          '기한 미룸' 번 이상 뒤로 미루면 '기한 거듭 미룸' 입니다. 담당자 2번 · 결과 뒤집힘 2번은
          고정입니다.
        </p>
        <button type="submit" class="hidden" />
      </form>

      <DialogFooter>
        <Button variant="outline" @click="open = false">취소</Button>
        <Button :disabled="!canSubmit" @click="submit">
          <Loader2 v-if="saving" class="animate-spin" />
          저장
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
