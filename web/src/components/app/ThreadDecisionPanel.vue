<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Check, ChevronRight, Clock, Plus } from 'lucide-vue-next'
import PersonChip from '@/components/app/PersonChip.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDataStore } from '@/stores/data'
import { useThreadStore } from '@/stores/thread'
import type { ThreadDetail } from '@/types/domain'

/* 안건 상세의 '결정' 영역 — 이 앱이 하려는 일이 여기 모인다. 정하면 결정으로, 못 정하면 사유를 달아
   미룸으로 남긴다. 결정인지 미루기인지 먼저 고르고, 고른 쪽에 맞는 칸만 보여 준다.
   상태는 손으로 바꾸지 않고 여기서 남긴 줄로만 바뀐다.
   결정된 안건은 결정 내용을 크게 보여 주고, 바꾸면 새 결정 줄이 앞의 것을 대체한다(앞의 것은 이력에 남는다). */
const props = defineProps<{ detail: ThreadDetail }>()
const emit = defineEmits<{ (e: 'open-thread', id: string): void }>()

const data = useDataStore()
const threadStore = useThreadStore()

/* 'view' 는 결정된 안건을 보기만 하는 때, 'choose' 는 결정 전 안건에서 아직 무엇을 남길지 안 고른 때다 */
type Mode = 'view' | 'choose' | 'decide' | 'defer' | 'refine'
const mode = ref<Mode>('choose')
const text = ref('')
const note = ref('')
const ownerId = ref<string | null>(null)
/* 미룰 때 다시 볼 날 — 고르면 결정 기한도 그날로 옮긴다. 안 옮기면 미루자마자 '기한 지남' 이 된다 */
const nextDue = ref('')
const NONE = 'none'

const textInput = ref<InstanceType<typeof Input> | null>(null)

function reset() {
  mode.value = props.detail.settled ? 'view' : 'choose'
  text.value = ''
  note.value = ''
  ownerId.value = null
  nextDue.value = ''
}

/* 다른 안건으로 옮기거나 결정이 서면(결정 전 → 결정됨) 칸을 처음 모양으로 */
watch(() => [props.detail.thread.id, props.detail.settled] as const, reset, { immediate: true })

async function switchTo(next: Mode) {
  mode.value = next
  text.value = ''
  note.value = ''
  await nextTick()
  ;(textInput.value?.$el as HTMLInputElement | undefined)?.focus()
}

function cancel() {
  reset()
}

/* 결정 전 안건의 첫 갈림길 — 둘 중 하나를 고르면 그쪽 칸이 열린다 */
const CHOICES = [
  { mode: 'decide', label: '결정', hint: '무엇으로 정했는지 남깁니다', icon: Check },
  { mode: 'defer', label: '미루기', hint: '못 정한 사유를 남깁니다', icon: Clock },
] as const

const LOOK: Record<
  Exclude<Mode, 'view' | 'choose'>,
  { label: string; placeholder: string; submit: string }
> = {
  decide: {
    label: '결정한 내용',
    placeholder: '한 줄로 — 어떻게 정했나요',
    submit: '결정으로 남기기',
  },
  defer: {
    label: '미루는 사유',
    placeholder: '한 줄로 — 왜 지금 못 정하나요, 무엇을 기다리나요',
    submit: '미루기로 남기기',
  },
  refine: {
    label: '덧붙일 세부',
    placeholder: '한 줄로 — 무엇을 더 정했나요',
    submit: '세부로 남기기',
  },
}
const look = computed(() =>
  mode.value === 'view' || mode.value === 'choose' ? null : LOOK[mode.value],
)

function submit() {
  const line = text.value.trim()
  if (!line || mode.value === 'view' || mode.value === 'choose') return
  const id = props.detail.thread.id
  threadStore.addEntry(id, mode.value, line, note.value.trim(), ownerId.value)
  if (mode.value === 'defer' && nextDue.value)
    threadStore.updateThread(id, { dueDate: nextDue.value })
  reset()
}

function onKeydown(e: KeyboardEvent) {
  /* 한글 조합 중의 Enter 는 글자를 맺는 키다 — 그때 남기면 마지막 글자가 잘린다 */
  if (e.isComposing) return
  if (e.key === 'Enter') {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <section
    class="flex flex-col gap-4 rounded-lg border bg-card px-5 py-[18px] shadow-sm"
    :class="detail.settled ? 'border-border' : 'border-primary/40'"
    aria-label="결정"
  >
    <div class="flex items-center gap-2">
      <span class="text-xs font-medium tracking-wider text-muted-foreground">결정</span>
      <span class="grow" />
      <span v-if="!detail.settled && detail.deferCount > 0" class="text-xs text-muted-foreground">
        지금까지 {{ detail.deferCount }}번 미뤄졌습니다
      </span>
    </div>

    <!-- 결정됨 — 무엇을 · 왜 · 언제가 맨 위에 크게 -->
    <div v-if="detail.settled" class="flex flex-col gap-3.5">
      <div class="flex items-start gap-3">
        <span class="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary">
          <Check class="size-3 text-primary-foreground" />
        </span>
        <p class="min-w-0 grow text-lg leading-relaxed font-semibold text-pretty">
          {{ detail.current }}
        </p>
      </div>

      <div
        v-if="detail.detail.length"
        class="ml-8 flex flex-col gap-1.5 border-l-2 border-border pl-3.5"
      >
        <p v-for="(line, i) in detail.detail" :key="i" class="text-sm leading-relaxed text-pretty">
          {{ line }}
        </p>
      </div>

      <p v-if="detail.settledNote" class="ml-8 text-sm leading-relaxed text-muted-foreground">
        <span class="font-medium text-foreground">근거</span> — {{ detail.settledNote }}
      </p>

      <div class="ml-8 flex items-center gap-2">
        <PersonChip v-if="detail.settledOwnerName" :name="detail.settledOwnerName" />
        <span class="text-xs text-muted-foreground">{{ detail.settledLabel }}</span>
      </div>

      <div v-if="detail.subThreads.length" class="ml-8 flex flex-col gap-2">
        <div class="text-xs font-medium tracking-wider text-muted-foreground">
          따로 떼어낸 하위 안건
        </div>
        <button
          v-for="sub in detail.subThreads"
          :key="sub.thread.id"
          type="button"
          class="flex min-h-11 items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground"
          @click="emit('open-thread', sub.thread.id)"
        >
          <span
            class="size-1.5 shrink-0 rounded-full"
            :class="sub.thread.state === 'decided' ? 'bg-primary' : 'bg-muted-foreground'"
          />
          <span class="min-w-0 grow text-sm leading-snug text-pretty">{{ sub.thread.title }}</span>
          <span class="shrink-0 text-xs text-muted-foreground">{{ sub.splitAtLabel }}</span>
          <ChevronRight class="size-3 shrink-0 text-muted-foreground" />
        </button>
      </div>

      <div v-if="mode === 'view'" class="ml-8 flex items-center gap-2">
        <Button variant="outline" size="sm" @click="switchTo('decide')">결정 바꾸기</Button>
        <Button variant="ghost" size="sm" class="text-muted-foreground" @click="switchTo('refine')">
          <Plus class="size-3.5" />
          세부 추가
        </Button>
      </div>
    </div>

    <!-- 결정 전 — 결정인지 미루기인지 먼저 고른다 -->
    <template v-else-if="mode !== 'refine'">
      <p v-if="mode === 'choose'" class="text-sm leading-relaxed text-muted-foreground">
        아직 정해지지 않았습니다. 오늘 무엇을 남길지 고르세요.
      </p>
      <div class="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="남길 것">
        <button
          v-for="c in CHOICES"
          :key="c.mode"
          type="button"
          role="radio"
          :aria-checked="mode === c.mode"
          class="flex items-start gap-3 rounded-md border px-3.5 py-3 text-left transition-colors"
          :class="
            mode === c.mode
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'
          "
          @click="mode !== c.mode && switchTo(c.mode)"
        >
          <component :is="c.icon" class="mt-0.5 size-4 shrink-0" />
          <span class="flex flex-col gap-0.5">
            <span class="text-sm font-medium">{{ c.label }}</span>
            <span
              class="text-xs"
              :class="mode === c.mode ? 'text-primary-foreground/80' : 'text-muted-foreground'"
            >
              {{ c.hint }}
            </span>
          </span>
        </button>
      </div>
      <button
        v-if="mode === 'choose'"
        type="button"
        class="self-end text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        @click="switchTo('refine')"
      >
        결정 없이 세부만 덧붙이기
      </button>
    </template>

    <!-- 남기는 칸 — 결정 · 미루기 · 세부 추가가 같은 모양이다 -->
    <div
      v-if="look"
      class="flex flex-col gap-3"
      :class="detail.settled ? 'rounded-md border border-border bg-muted/50 p-3.5' : ''"
    >
      <div class="flex flex-col gap-1.5">
        <label for="decision-text" class="text-xs font-medium">
          {{ look.label }}
          <span class="font-normal text-muted-foreground">(필수)</span>
        </label>
        <Input
          id="decision-text"
          ref="textInput"
          v-model="text"
          :placeholder="look.placeholder"
          class="bg-background"
          @keydown="onKeydown"
        />
        <div
          v-if="mode === 'decide' && detail.thread.options.length"
          class="flex flex-wrap items-center gap-1.5 pt-0.5"
        >
          <span class="text-xs text-muted-foreground">후보에서 고르기</span>
          <button
            v-for="(option, i) in detail.thread.options"
            :key="i"
            type="button"
            class="inline-flex h-7 items-center rounded-md border px-2.5 text-xs transition-colors"
            :class="
              text === option
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'
            "
            :aria-pressed="text === option"
            @click="text = option"
          >
            {{ option }}
          </button>
        </div>
      </div>

      <div v-if="mode !== 'defer'" class="flex flex-col gap-1.5">
        <label for="decision-note" class="text-xs font-medium">
          근거 <span class="font-normal text-muted-foreground">(선택)</span>
        </label>
        <Input
          id="decision-note"
          v-model="note"
          placeholder="무엇을 보고 · 누구에게 확인하고 정했나요"
          class="bg-background"
          @keydown="onKeydown"
        />
      </div>

      <div v-if="mode === 'defer'" class="flex flex-col gap-1.5">
        <label for="decision-next-due" class="text-xs font-medium">
          다시 볼 날 <span class="font-normal text-muted-foreground">(선택)</span>
        </label>
        <div class="flex flex-wrap items-center gap-2">
          <Input
            id="decision-next-due"
            :model-value="nextDue"
            type="date"
            class="w-[180px] bg-background"
            @change="(e: Event) => (nextDue = (e.target as HTMLInputElement).value)"
          />
          <span class="text-xs text-muted-foreground"> 고르면 결정 기한도 이날로 옮깁니다 </span>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-medium">처리한 사람</span>
        <Select
          :model-value="ownerId ?? NONE"
          @update:model-value="(v) => (ownerId = v === NONE ? null : String(v))"
        >
          <SelectTrigger class="h-8 w-[140px] bg-background text-xs" aria-label="처리한 사람">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="NONE">선택 안 함</SelectItem>
            <SelectItem v-for="m in data.allMembers" :key="m.id" :value="m.id">
              {{ m.name }}
            </SelectItem>
          </SelectContent>
        </Select>
        <span v-if="mode === 'decide' && ownerId" class="text-xs text-muted-foreground">
          담당자도 이 사람으로 바뀝니다
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-2 pt-1">
        <Button :disabled="!text.trim()" @click="submit">
          <Check v-if="mode === 'decide'" class="size-4" />
          <Clock v-else-if="mode === 'defer'" class="size-4" />
          {{ look.submit }}
        </Button>
        <Button variant="outline" @click="cancel">취소</Button>
      </div>
    </div>
  </section>
</template>
