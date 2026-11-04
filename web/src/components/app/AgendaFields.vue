<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fitTextarea } from '@/lib/utils'

/* 안건의 글 칸 — 제목 · 설명 · 결정내용. 안건 추가와 안건 상세가 같이 쓴다.
   값은 부모가 들고 있고, 여기는 칸이 끝났을 때(벗어남 · Enter) 'commit' 을 올린다.
   상세는 그때 바로 저장하고, 추가는 무시했다가 만들 때 한꺼번에 넣는다.
   결정내용은 여러 줄 글 — 정한 것을 적고, 바뀌면 고쳐 쓴다(바뀐 기록은 변경 이력이 남긴다).
   live 면 Esc 로 고치던 것을 되돌린다(revert) — 추가 팝업에서는 Esc 가 팝업을 닫는 키로 남는다.
   readonly 면 글처럼만 보인다 — 고칠 권한이 없는 안건 */
export type AgendaTextField = 'title' | 'description' | 'decision'

const props = defineProps<{ live?: boolean; placeholder?: string; readonly?: boolean }>()
const title = defineModel<string>('title', { required: true })
const description = defineModel<string>('description', { required: true })
const decision = defineModel<string>('decision', { required: true })
const emit = defineEmits<{
  (e: 'commit' | 'revert', field: AgendaTextField): void
}>()

const titleField = ref<HTMLTextAreaElement | null>(null)
const descriptionField = ref<HTMLTextAreaElement | null>(null)
const fitTitle = () => fitTextarea(titleField.value)

/* 부모가 값을 갈아 끼우면(다른 안건 · 되돌리기) 제목 높이를 다시 맞춘다 */
watch([titleField, title], fitTitle, { flush: 'post' })

function onTitleKeydown(e: KeyboardEvent) {
  /* 한글 조합 중의 Enter 는 글자를 맺는 키다 */
  if (e.isComposing) return
  if (e.key === 'Enter') {
    /* 제목은 한 줄이다. 상세에서는 Enter 가 저장, 추가에서는 설명으로 넘어간다 */
    e.preventDefault()
    if (props.live) (e.target as HTMLTextAreaElement).blur()
    else descriptionField.value?.focus()
  } else if (e.key === 'Escape' && props.live) {
    revert(e, 'title')
  }
}

function onAreaKeydown(e: KeyboardEvent, field: 'description' | 'decision') {
  if (e.isComposing || e.key !== 'Escape' || !props.live) return
  revert(e, field)
}

function revert(e: KeyboardEvent, field: AgendaTextField) {
  /* 팝업까지 닫히지 않게 여기서 멈춘다 */
  e.stopPropagation()
  e.preventDefault()
  emit('revert', field)
  ;(e.target as HTMLTextAreaElement).blur()
}

defineExpose({ focusTitle: () => titleField.value?.focus() })

/* 평소엔 글처럼 보이고, 가리키면 고칠 수 있는 칸임이 드러난다 */
const editable = computed(() => (props.readonly ? '' : 'hover:border-border focus:border-input'))
const area = computed(() => [
  '-mx-2 resize-none [field-sizing:content] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60',
  editable.value,
])
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-1">
      <textarea
        ref="titleField"
        v-model="title"
        rows="1"
        aria-label="제목"
        :readonly="readonly"
        :placeholder="placeholder ?? '무엇을 정해야 하나요? 예) 서버 OS를 무엇으로 할지'"
        class="-mx-2 resize-none overflow-hidden [field-sizing:content] rounded-md border border-transparent bg-transparent px-2 py-1 text-xl leading-snug font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60"
        :class="editable"
        @input="fitTitle"
        @keydown="onTitleKeydown"
        @blur="emit('commit', 'title')"
      />
      <slot name="under-title" />
    </header>

    <section class="flex flex-col gap-1.5">
      <span class="text-xs font-medium">설명</span>
      <textarea
        ref="descriptionField"
        v-model="description"
        rows="2"
        aria-label="설명"
        :readonly="readonly"
        :placeholder="readonly ? '' : '왜 정해야 하나요? 무엇이 막혀 있고, 지금까지 알려진 사실은?'"
        :class="area"
        @keydown="onAreaKeydown($event, 'description')"
        @blur="emit('commit', 'description')"
      />
    </section>

    <section
      class="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-4 py-3 shadow-sm"
      data-agenda-decision
    >
      <span class="flex items-baseline gap-2">
        <span class="text-xs font-medium">결정내용</span>
        <span class="text-xs text-muted-foreground">정한 것과 조건 · 세부를 여러 줄로</span>
      </span>
      <textarea
        v-model="decision"
        rows="3"
        aria-label="결정내용"
        :readonly="readonly"
        :placeholder="
          readonly
            ? '아직 적힌 결정이 없습니다.'
            : '예) 우분투 최신 버전으로 한다\n- 록키는 사내 지원 경험이 없어 뺀다'
        "
        :class="area"
        @keydown="onAreaKeydown($event, 'decision')"
        @blur="emit('commit', 'decision')"
      />
    </section>

    <slot />
  </div>
</template>
