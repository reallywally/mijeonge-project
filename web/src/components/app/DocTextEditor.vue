<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { Bold, Eye, Heading2, List, ListOrdered, Pencil, Table2 } from 'lucide-vue-next'
import DocMarkdown from '@/components/app/DocMarkdown.vue'
import {
  DOC_CONTENT_MAX,
  insertBlock,
  prefixLines,
  TABLE_SNIPPET,
  wrapSelection,
  type TextEdit,
} from '@/lib/document'
import { cn } from '@/lib/utils'

/* 글 문서 — [편집 | 미리보기]. 편집은 마크다운 textarea 와 서식 버튼 몇 개(굵게 · 제목 · 목록 · 번호 목록 · 표),
   미리보기는 lib/markdown. 서식 편집기는 두지 않는다 — '간단하게' 다 (docs/api/document.md).
   [본문에 넣기] 는 마지막 커서 자리에 넣는다 — 한 번도 안 눌렀으면 끝에 */
const content = defineModel<string>({ required: true })
defineProps<{ readonly?: boolean }>()

const mode = ref<'edit' | 'preview'>('edit')
const area = ref<HTMLTextAreaElement | null>(null)
/** 마지막 커서 자리 — 칸을 벗어나도 기억한다 */
const cursor = ref<number | null>(null)

function remember() {
  if (area.value) cursor.value = area.value.selectionEnd
}

async function apply(edit: TextEdit) {
  content.value = edit.text
  cursor.value = edit.end
  await nextTick()
  area.value?.focus()
  area.value?.setSelectionRange(edit.start, edit.end)
}

function selection() {
  const el = area.value
  return el ? [el.selectionStart, el.selectionEnd] : [content.value.length, content.value.length]
}

function bold() {
  const [s, e] = selection()
  void apply(wrapSelection(content.value, s, e, '**', '굵게'))
}

function prefix(mark: string) {
  const [s, e] = selection()
  void apply(prefixLines(content.value, s, e, mark))
}

function table() {
  const [, e] = selection()
  const { content: text, cursor: at } = insertBlock(content.value, TABLE_SNIPPET, e)
  void apply({ text, start: at, end: at })
}

/** [본문에 넣기] — 마지막 커서 자리(없으면 끝)에 블록. 미리보기 중이면 편집으로 돌아오지 않는다 */
function insert(block: string) {
  const { content: text, cursor: at } = insertBlock(content.value, block, cursor.value)
  content.value = text
  cursor.value = at
}

defineExpose({ insert })

const TOOL =
  'flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground'
</script>

<template>
  <div class="flex min-h-0 flex-col gap-2">
    <div class="flex items-center gap-1">
      <div class="flex items-center rounded-md border border-border bg-muted/50 p-0.5">
        <button
          v-for="m in [
            { key: 'edit' as const, label: '편집', icon: Pencil },
            { key: 'preview' as const, label: '미리보기', icon: Eye },
          ]"
          :key="m.key"
          type="button"
          :aria-pressed="mode === m.key"
          :data-doc-mode="m.key"
          :class="
            cn(
              'flex h-6 items-center gap-1 rounded-[5px] px-2 text-xs text-muted-foreground',
              mode === m.key && 'bg-card font-medium text-foreground shadow-sm',
            )
          "
          @click="mode = m.key"
        >
          <component :is="m.icon" class="size-3.5" />
          {{ m.label }}
        </button>
      </div>
      <template v-if="mode === 'edit' && !readonly">
        <div class="mx-1.5 h-4 w-px bg-border" />
        <button type="button" :class="TOOL" title="굵게" aria-label="굵게" @click="bold">
          <Bold class="size-3.5" />
        </button>
        <button
          type="button"
          :class="TOOL"
          title="제목"
          aria-label="제목"
          data-doc-tool-heading
          @click="prefix('## ')"
        >
          <Heading2 class="size-3.5" />
        </button>
        <button type="button" :class="TOOL" title="목록" aria-label="목록" @click="prefix('- ')">
          <List class="size-3.5" />
        </button>
        <button
          type="button"
          :class="TOOL"
          title="번호 목록"
          aria-label="번호 목록"
          @click="prefix('1. ')"
        >
          <ListOrdered class="size-3.5" />
        </button>
        <button type="button" :class="TOOL" title="표" aria-label="표" @click="table">
          <Table2 class="size-3.5" />
        </button>
      </template>
      <span class="grow" />
      <span class="text-xs text-muted-foreground tabular-nums"
        >{{ content.length.toLocaleString('ko-KR') }} /
        {{ DOC_CONTENT_MAX.toLocaleString('ko-KR') }}</span
      >
    </div>

    <textarea
      v-if="mode === 'edit'"
      ref="area"
      v-model="content"
      :readonly="readonly"
      :maxlength="DOC_CONTENT_MAX"
      aria-label="본문"
      placeholder="마크다운으로 적습니다 — ## 제목, - 목록, **굵게**. 오른쪽 안건의 [본문에 넣기] 로 결정내용을 끼워 넣을 수 있습니다."
      class="min-h-[480px] w-full grow resize-y rounded-lg border border-border bg-card px-4 py-3 font-mono text-[13px] leading-relaxed shadow-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
      data-doc-content
      @select="remember"
      @click="remember"
      @keyup="remember"
      @input="remember"
    />
    <div
      v-else
      class="min-h-[480px] rounded-lg border border-border bg-card px-5 py-4 shadow-sm"
      data-doc-preview-box
    >
      <DocMarkdown v-if="content.trim()" :text="content" />
      <p v-else class="text-sm text-muted-foreground">아직 적은 글이 없습니다.</p>
    </div>
  </div>
</template>
