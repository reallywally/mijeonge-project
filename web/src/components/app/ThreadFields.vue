<script setup lang="ts">
import { ref, watch } from 'vue'
import { fitTextarea } from '@/lib/utils'

/* 안건의 글 칸 — 제목 · 배경 · 후보. 안건 추가와 안건 상세가 같이 쓴다.
   값은 부모가 들고 있고, 여기는 칸이 끝났을 때(벗어남 · Enter) 'commit' 을 올린다.
   상세는 그때 바로 저장하고, 추가는 무시했다가 만들 때 한꺼번에 넣는다.
   후보는 한 줄에 하나인 글로 다룬다 — 줄로 나누는 건 저장하는 쪽의 일이다.
   live 면 Esc 로 고치던 것을 되돌린다(revert) — 추가 팝업에서는 Esc 가 팝업을 닫는 키로 남는다. */
const props = defineProps<{ live?: boolean; placeholder?: string }>()
const title = defineModel<string>('title', { required: true })
const description = defineModel<string>('description', { required: true })
const options = defineModel<string>('options', { required: true })
const emit = defineEmits<{
  (e: 'commit' | 'revert', field: 'title' | 'description' | 'options'): void
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
    /* 제목은 한 줄이다. 상세에서는 Enter 가 저장, 추가에서는 배경으로 넘어간다 */
    e.preventDefault()
    if (props.live) (e.target as HTMLTextAreaElement).blur()
    else descriptionField.value?.focus()
  } else if (e.key === 'Escape' && props.live) {
    revert(e, 'title')
  }
}

function onAreaKeydown(e: KeyboardEvent, field: 'description' | 'options') {
  if (e.isComposing || e.key !== 'Escape' || !props.live) return
  revert(e, field)
}

function revert(e: KeyboardEvent, field: 'title' | 'description' | 'options') {
  /* 팝업까지 닫히지 않게 여기서 멈춘다 */
  e.stopPropagation()
  e.preventDefault()
  emit('revert', field)
  ;(e.target as HTMLTextAreaElement).blur()
}

defineExpose({ focusTitle: () => titleField.value?.focus() })

/* 평소엔 글처럼 보이고, 가리키면 고칠 수 있는 칸임이 드러난다 */
const area =
  '-mx-2 resize-none [field-sizing:content] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60 hover:border-border focus:border-input'
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-1">
      <textarea
        ref="titleField"
        v-model="title"
        rows="1"
        aria-label="제목"
        :placeholder="placeholder ?? '무엇을 정해야 하나요? 예) 서버 OS를 무엇으로 할지'"
        class="-mx-2 resize-none overflow-hidden [field-sizing:content] rounded-md border border-transparent bg-transparent px-2 py-1 text-xl leading-snug font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60 hover:border-border focus:border-input"
        @input="fitTitle"
        @keydown="onTitleKeydown"
        @blur="emit('commit', 'title')"
      />
      <slot name="under-title" />
    </header>

    <slot />

    <section class="flex flex-col gap-1.5">
      <span class="text-xs font-medium">배경</span>
      <textarea
        ref="descriptionField"
        v-model="description"
        rows="2"
        aria-label="배경"
        placeholder="무엇이 막혀 있고, 지금까지 알려진 사실은 무엇인가요?"
        :class="area"
        @keydown="onAreaKeydown($event, 'description')"
        @blur="emit('commit', 'description')"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <span class="flex items-baseline gap-2">
        <span class="text-xs font-medium">후보</span>
        <span class="text-xs text-muted-foreground"
          >한 줄에 하나 · 정답이 열려 있으면 비워 둡니다</span
        >
      </span>
      <textarea
        v-model="options"
        rows="2"
        aria-label="후보"
        placeholder="예) 우분투&#10;예) 록키"
        :class="area"
        @keydown="onAreaKeydown($event, 'options')"
        @blur="emit('commit', 'options')"
      />
    </section>
  </div>
</template>
