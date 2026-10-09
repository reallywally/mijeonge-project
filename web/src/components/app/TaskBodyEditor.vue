<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { Check } from 'lucide-vue-next'
import { fitTextarea } from '@/lib/utils'
import type { TaskLine } from '@/types/domain'

/* 작업 본문 — 보는 모양 그대로 줄마다 고친다.
   Enter 새 줄 · Tab / Shift+Tab 들여쓰기 · 빈 줄에서 Backspace 로 지우기 ·
   줄 첫머리에 `[] ` 를 치면 체크박스, `- ` 를 치면 불릿으로 바뀐다.

   줄은 이 컴포넌트가 들고 있다가 바뀔 때마다 통째로 올린다. 빈 줄은 적는 중일 수 있어 그대로
   두고, 편집기를 벗어날 때 걷어서 올린다. 부모는 작업이 바뀌면 key 로 새로 띄운다. */
const props = defineProps<{ lines: TaskLine[] }>()
const emit = defineEmits<{ (e: 'change', lines: TaskLine[]): void }>()

const MAX_LEVEL = 3
let seq = 0
const newId = () => `e${Date.now().toString(36)}${(seq += 1)}`
const blank = (from?: TaskLine): TaskLine => ({
  id: newId(),
  kind: from?.kind ?? 'bullet',
  text: '',
  done: false,
  level: from?.level ?? 0,
})

/* 비어 있으면 적을 자리 한 줄을 깔아 둔다 — 올릴 때는 빈 줄이라 걷힌다 */
const rows = ref<TaskLine[]>(props.lines.length ? props.lines.map((l) => ({ ...l })) : [blank()])
const fields = ref<HTMLTextAreaElement[]>([])

const filled = () => rows.value.filter((l) => l.text.trim() !== '')
const commit = () =>
  emit(
    'change',
    filled().map((l) => ({ ...l })),
  )

function onFocusOut(e: FocusEvent) {
  const root = e.currentTarget as HTMLElement
  if (root.contains(e.relatedTarget as Node | null)) return
  rows.value = rows.value.length && filled().length ? filled() : [blank()]
  commit()
}

async function focusAt(index: number, caret: number | 'end' = 'end') {
  await nextTick()
  const el = fields.value[index]
  if (!el) return
  el.focus()
  const at = caret === 'end' ? el.value.length : caret
  el.setSelectionRange(at, at)
}

function onInput(index: number, e: Event) {
  const el = e.target as HTMLTextAreaElement
  const line = rows.value[index]
  /* 첫머리 표시로 줄 모양을 바꾼다 */
  const toCheck = /^\[([ xX]?)\] /.exec(el.value)
  const toBullet = /^[-*] /.exec(el.value)
  if (toCheck) {
    line.kind = 'check'
    line.done = toCheck[1].toLowerCase() === 'x'
    line.text = el.value.slice(toCheck[0].length)
  } else if (toBullet && line.kind === 'check') {
    line.kind = 'bullet'
    line.done = false
    line.text = el.value.slice(toBullet[0].length)
  } else {
    line.text = el.value
  }
  if (line.text !== el.value) el.value = line.text
  fitTextarea(el)
  commit()
}

function onKeydown(index: number, e: KeyboardEvent) {
  /* 한글 조합 중의 키는 글자를 맺는 데 쓰인다 */
  if (e.isComposing) return
  const el = e.target as HTMLTextAreaElement
  const line = rows.value[index]
  const atStart = el.selectionStart === 0 && el.selectionEnd === 0
  const atEnd = el.selectionStart === el.value.length

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    /* 빈 줄의 Enter 는 한 단계 밖으로 — 목록을 끝낼 때의 손버릇이다 */
    if (line.text === '' && line.level > 0) {
      line.level -= 1
      commit()
      return
    }
    const caret = el.selectionStart
    const tail = line.text.slice(caret)
    line.text = line.text.slice(0, caret)
    rows.value.splice(index + 1, 0, { ...blank(line), text: tail })
    commit()
    void focusAt(index + 1, 0)
    return
  }

  if (e.key === 'Tab') {
    e.preventDefault()
    const prevLevel = rows.value[index - 1]?.level ?? -1
    const next = e.shiftKey ? line.level - 1 : line.level + 1
    /* 윗줄보다 두 단계 이상 깊어지지 않는다 */
    line.level = Math.max(0, Math.min(next, MAX_LEVEL, prevLevel + 1))
    commit()
    return
  }

  if (e.key === 'Backspace' && atStart) {
    if (line.level > 0) {
      e.preventDefault()
      line.level -= 1
      commit()
      return
    }
    if (line.kind === 'check') {
      e.preventDefault()
      line.kind = 'bullet'
      line.done = false
      commit()
      return
    }
    if (index > 0) {
      /* 윗줄 끝에 이어 붙인다 */
      e.preventDefault()
      const prev = rows.value[index - 1]
      const join = prev.text.length
      prev.text += line.text
      rows.value.splice(index, 1)
      commit()
      void focusAt(index - 1, join).then(() => fitTextarea(fields.value[index - 1]))
    }
    return
  }

  if (e.key === 'ArrowUp' && atStart && index > 0) {
    e.preventDefault()
    void focusAt(index - 1)
  } else if (e.key === 'ArrowDown' && atEnd && index < rows.value.length - 1) {
    e.preventDefault()
    void focusAt(index + 1, 0)
  }
}

function toggle(line: TaskLine) {
  line.done = !line.done
  commit()
}

function setField(index: number, el: unknown) {
  if (el instanceof HTMLTextAreaElement) {
    fields.value[index] = el
    fitTextarea(el)
  }
}
</script>

<template>
  <div
    class="flex flex-col rounded-md border border-transparent px-1.5 py-1 transition-colors hover:border-border focus-within:border-input focus-within:hover:border-input"
    @focusout="onFocusOut"
  >
    <div
      v-for="(line, i) in rows"
      :key="line.id"
      class="group flex items-start gap-2.5"
      :style="{ paddingLeft: `${line.level * 26}px` }"
    >
      <button
        v-if="line.kind === 'check'"
        type="button"
        class="mt-[7px] flex size-[17px] shrink-0 items-center justify-center rounded-sm border"
        :class="line.done ? 'border-primary bg-primary' : 'border-input hover:border-primary'"
        :aria-label="line.done ? '완료 해제' : '완료'"
        @click="toggle(line)"
      >
        <Check v-if="line.done" class="size-3 text-primary-foreground" />
      </button>
      <span v-else class="mt-[13px] ml-[5px] size-1.5 shrink-0 rounded-full bg-muted-foreground" />
      <textarea
        :ref="(el) => setField(i, el)"
        :value="line.text"
        rows="1"
        :placeholder="
          rows.length === 1 && i === 0 ? '내용을 적으세요 — [] 를 치면 체크박스가 됩니다' : ''
        "
        class="min-w-0 grow resize-none overflow-hidden [field-sizing:content] bg-transparent py-[5px] text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground"
        :class="line.done ? 'text-muted-foreground line-through' : ''"
        @input="onInput(i, $event)"
        @keydown="onKeydown(i, $event)"
      />
    </div>
  </div>
</template>
