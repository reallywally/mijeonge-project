<script setup lang="ts">
import { ref, watch } from 'vue'
import { GripVertical, Plus, X } from 'lucide-vue-next'
import { TEST_STEPS_MAX } from '@/lib/testcase'
import type { TestStep } from '@/types/domain'

/* 단계 표 — # · 행동 · 기대 결과. 줄 추가 · 끌어 순서 바꾸기 · 지우기.
   글은 칸을 벗어날 때, 순서 · 지우기는 그 자리에서 올린다(change). 부모가 저장할지 정한다 —
   행동이 빈 줄이 있으면 서버가 받지 않으므로 부모는 그동안 보내지 않는다 */
const props = defineProps<{
  steps: TestStep[]
  /** 실패한 단계(1부터) — 그 줄에 표를 한다 */
  failedStep?: number | null
}>()
const emit = defineEmits<{ (e: 'change', steps: TestStep[]): void }>()

/* 칸마다 고유 키 — 순서를 바꿔도 칸이 제 글을 들고 간다 */
let seq = 0
type Line = TestStep & { key: number }
const lines = ref<Line[]>([])

const plain = (): TestStep[] => lines.value.map((l) => ({ action: l.action, expected: l.expected }))

const sameAs = (a: TestStep[], b: TestStep[]) =>
  a.length === b.length &&
  a.every((s, i) => s.action.trim() === b[i].action.trim() && s.expected === b[i].expected)

/* 저장된 값이 내려와도 들고 있는 것과 같으면 칸을 다시 세우지 않는다 — 다음 칸으로 옮긴 커서가 날아가지 않게 */
watch(
  () => props.steps,
  (next) => {
    if (sameAs(next, plain())) return
    lines.value = next.map((s) => ({ ...s, key: ++seq }))
  },
  { immediate: true, deep: true },
)

/** 바뀐 것이 있을 때만 올린다 — 칸을 지나가기만 해도 저장 요청이 나가지 않게 */
function commit() {
  if (!sameAs(plain(), props.steps)) emit('change', plain())
}

function addLine() {
  if (lines.value.length >= TEST_STEPS_MAX) return
  lines.value.push({ action: '', expected: '', key: ++seq })
}

function removeLine(i: number) {
  lines.value.splice(i, 1)
  commit()
}

/* 끌어 순서 바꾸기 — 손잡이를 잡고 다른 줄 위에 놓는다 */
const dragFrom = ref<number | null>(null)
const dragOver = ref<number | null>(null)

function onDragStart(i: number, e: DragEvent) {
  dragFrom.value = i
  e.dataTransfer?.setData('text/plain', String(i))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDrop(i: number) {
  const from = dragFrom.value
  dragFrom.value = null
  dragOver.value = null
  if (from === null || from === i) return
  const [moved] = lines.value.splice(from, 1)
  lines.value.splice(i, 0, moved)
  commit()
}

/** 키보드로도 옮긴다 — Alt + ↑ ↓ */
function onKeydown(i: number, e: KeyboardEvent) {
  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
  const to = e.key === 'ArrowUp' ? i - 1 : i + 1
  if (to < 0 || to >= lines.value.length) return
  e.preventDefault()
  const [moved] = lines.value.splice(i, 1)
  lines.value.splice(to, 0, moved)
  commit()
}

const cell =
  'w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] outline-none hover:border-border focus:border-input focus:bg-background placeholder:text-muted-foreground'
</script>

<template>
  <div class="flex flex-col overflow-hidden rounded-md border border-border" data-test-steps>
    <div
      class="flex h-8 items-center gap-2 border-b border-border bg-muted/50 px-2 text-xs font-medium text-muted-foreground"
    >
      <span class="w-[46px] shrink-0 pl-1">#</span>
      <span class="min-w-0 basis-1/2">행동</span>
      <span class="min-w-0 basis-1/2">기대 결과</span>
      <span class="w-7 shrink-0" />
    </div>

    <div
      v-for="(line, i) in lines"
      :key="line.key"
      class="flex items-start gap-2 border-b border-border px-2 py-1"
      :class="[
        dragOver === i && dragFrom !== i ? 'bg-accent' : '',
        failedStep === i + 1 ? 'bg-destructive/5' : '',
      ]"
      :data-test-step="i + 1"
      @dragover.prevent="dragOver = i"
      @dragleave="dragOver = dragOver === i ? null : dragOver"
      @drop.prevent="onDrop(i)"
    >
      <span
        class="flex h-8 w-[46px] shrink-0 cursor-grab items-center gap-1 text-xs text-muted-foreground"
        draggable="true"
        :title="'끌어 순서 바꾸기 (Alt + ↑ ↓)'"
        @dragstart="onDragStart(i, $event)"
        @dragend="dragFrom = null"
      >
        <GripVertical class="size-3.5 shrink-0" />
        <span :class="failedStep === i + 1 ? 'font-medium text-destructive' : ''">{{ i + 1 }}</span>
      </span>
      <textarea
        v-model="line.action"
        rows="1"
        :aria-label="`${i + 1}단계 행동`"
        placeholder="무엇을 하나"
        class="min-w-0 basis-1/2 resize-none [field-sizing:content]"
        :class="[cell, line.action.trim() ? '' : 'border-dashed border-border']"
        @blur="commit"
        @keydown="onKeydown(i, $event)"
      />
      <textarea
        v-model="line.expected"
        rows="1"
        :aria-label="`${i + 1}단계 기대 결과`"
        placeholder="무엇이 보여야 하나 (비워도 됩니다)"
        class="min-w-0 basis-1/2 resize-none [field-sizing:content]"
        :class="cell"
        @blur="commit"
        @keydown="onKeydown(i, $event)"
      />
      <button
        type="button"
        class="mt-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        :aria-label="`${i + 1}단계 지우기`"
        title="이 단계 지우기"
        @click="removeLine(i)"
      >
        <X class="size-3.5" />
      </button>
    </div>

    <p v-if="lines.length === 0" class="px-3 py-2.5 text-xs text-muted-foreground">
      단계가 없습니다. 행동과 기대 결과를 짝으로 적습니다.
    </p>

    <button
      type="button"
      class="flex min-h-[34px] items-center gap-1.5 px-3 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
      :disabled="lines.length >= TEST_STEPS_MAX"
      @click="addLine"
    >
      <Plus class="size-3.5" />
      단계 추가
    </button>
  </div>
</template>
