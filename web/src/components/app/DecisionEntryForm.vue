<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { Check, Clock } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ITEM_TITLE_MAX } from '@/lib/thread'
import { useDataStore } from '@/stores/data'

/* 결정 영역의 남기는 칸 — 결정 · 미루기 · 세부 추가가 같은 모양이다. 적은 것은 여기서 들고 있다가
   [남기기] 로 넘긴다. 저장은 부르는 쪽이 하고, 실패하면 칸이 그대로 남아 다시 남길 수 있다.
   itemTitle 을 주면 새 항목의 이름 칸이 같이 선다 — 항목이 없는 안건에서 처음 정할 때 */
export interface DecisionEntryDraft {
  itemTitle: string
  text: string
  note: string
  ownerId: string | null
  nextDue: string
}

const props = defineProps<{
  mode: 'decide' | 'defer' | 'refine'
  /** 안건의 후보 — 결정할 때 눌러 고른다 */
  options: string[]
  /** 새 항목의 이름(미리 채울 값). null 이면 이름 칸이 없다 */
  itemTitle?: string | null
  /** 다시 볼 날 칸 — 안건 전체를 미룰 때 · 안건을 고칠 수 있을 때만 */
  withNextDue?: boolean
  framed?: boolean
  saving?: boolean
}>()
const emit = defineEmits<{
  (e: 'submit', draft: DecisionEntryDraft): void
  (e: 'cancel'): void
}>()

const data = useDataStore()

const itemTitle = ref(props.itemTitle ?? '')
const text = ref('')
const note = ref('')
const ownerId = ref<string | null>(null)
/* 미룰 때 다시 볼 날 — 고르면 결정 기한도 그날로 옮긴다. 안 옮기면 미루자마자 '기한 지남' 이 된다 */
const nextDue = ref('')
const NONE = 'none'

const textInput = ref<InstanceType<typeof Input> | null>(null)
const focusText = () => (textInput.value?.$el as HTMLInputElement | undefined)?.focus()

onMounted(async () => {
  await nextTick()
  focusText()
})

const LOOK = {
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
} as const
const look = computed(() => LOOK[props.mode])

const withItemTitle = computed(() => props.itemTitle !== null && props.itemTitle !== undefined)
const ready = computed(
  () => !!text.value.trim() && (!withItemTitle.value || !!itemTitle.value.trim()) && !props.saving,
)

function submit() {
  if (!ready.value) return
  emit('submit', {
    itemTitle: itemTitle.value.trim(),
    text: text.value.trim(),
    note: note.value.trim(),
    ownerId: ownerId.value,
    nextDue: nextDue.value,
  })
}

function onKeydown(e: KeyboardEvent) {
  /* 한글 조합 중의 Enter 는 글자를 맺는 키다 — 그때 남기면 마지막 글자가 잘린다 */
  if (e.isComposing) return
  if (e.key === 'Enter') {
    e.preventDefault()
    submit()
  }
}

/* 항목 이름은 한 줄 — Enter 는 결정 칸으로 넘어간다 */
function onItemTitleKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'Enter') {
    e.preventDefault()
    focusText()
  }
}

/* 상세 설명은 여러 줄이다 — Enter 는 줄바꿈, 남기기는 ⌘/Ctrl+Enter */
function onNoteKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <div
    class="flex flex-col gap-3"
    :class="framed ? 'rounded-md border border-border bg-muted/50 p-3.5' : ''"
  >
    <div v-if="withItemTitle" class="flex flex-col gap-1.5">
      <label for="decision-item-title" class="text-xs font-medium">
        결정 항목
        <span class="font-normal text-muted-foreground">(필수 · 무엇을 정하나요)</span>
      </label>
      <Input
        id="decision-item-title"
        v-model="itemTitle"
        :maxlength="ITEM_TITLE_MAX"
        class="bg-background"
        @keydown="onItemTitleKeydown"
      />
    </div>

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
        v-if="mode === 'decide' && options.length"
        class="flex flex-wrap items-center gap-1.5 pt-0.5"
      >
        <span class="text-xs text-muted-foreground">후보에서 고르기</span>
        <button
          v-for="(option, i) in options"
          :key="i"
          type="button"
          class="inline-flex h-7 items-center rounded-md border px-2.5 text-xs transition-colors"
          :class="
            text === option
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card hover:bg-muted'
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
        상세 설명
        <span class="font-normal text-muted-foreground">(선택 · ⌘/Ctrl+Enter 로 남기기)</span>
      </label>
      <Textarea
        id="decision-note"
        v-model="note"
        rows="3"
        placeholder="무엇을 보고 · 누구에게 확인하고 정했나요. 조건 · 예외도 적어 두세요"
        class="bg-background [field-sizing:content]"
        @keydown="onNoteKeydown"
      />
    </div>

    <div v-if="withNextDue" class="flex flex-col gap-1.5">
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
          <SelectItem v-for="m in data.assignable" :key="m.id" :value="m.id">
            {{ m.name }}
          </SelectItem>
        </SelectContent>
      </Select>
      <span v-if="mode === 'decide' && ownerId" class="text-xs text-muted-foreground">
        담당자도 이 사람으로 바뀝니다
      </span>
    </div>

    <div class="flex flex-wrap items-center gap-2 pt-1">
      <Button :disabled="!ready" @click="submit">
        <Check v-if="mode === 'decide'" class="size-4" />
        <Clock v-else-if="mode === 'defer'" class="size-4" />
        {{ look.submit }}
      </Button>
      <Button variant="outline" @click="emit('cancel')">취소</Button>
    </div>
  </div>
</template>
