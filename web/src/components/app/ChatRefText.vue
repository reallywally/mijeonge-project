<script setup lang="ts">
import { h } from 'vue'
import type { VNodeChild } from 'vue'
import ThreadStateBadge from '@/components/app/ThreadStateBadge.vue'
import { splitRefs } from '@/lib/chat'
import { parseMarkdown } from '@/lib/markdown'
import type { Block, Inline, ListItem } from '@/lib/markdown'
import { useTaskStore } from '@/stores/task'
import { useThreadStore } from '@/stores/thread'
import type { ChatRef } from '@/types/domain'

/* AI 가 낸 답 본문. v-html 로 그리지 않는다 — 근거 표시는 칩으로 바꾼다.
   markdown 이면(챗봇) 굵게 · 목록 · 제목 · 코드 몇 가지를 lib/markdown 으로 조각내 Vue 로 직접 그린다.
   아니면(리포트 · 리스크 요약 — 프롬프트가 마크다운을 쓰지 말라고 한다) 줄바꿈만 살린다.
   스냅샷(지금 프로젝트)에 없는 id 는 그리지 않는다 — 지어낸 id 를 보이지 않는다 (docs/api/chat.md) */
const props = defineProps<{ text: string; markdown?: boolean }>()
const emit = defineEmits<{ 'open-thread': [id: string]; 'open-task': [id: string] }>()

const threadStore = useThreadStore()
const taskStore = useTaskStore()

const CHIP =
  'mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 align-middle text-xs hover:bg-accent'

function chip(ref: ChatRef): VNodeChild {
  if (ref.kind === 'thread') {
    const row = threadStore.rows.find((r) => r.thread.id === ref.id)
    if (!row) return null
    return h(
      'button',
      {
        type: 'button',
        class: CHIP,
        'data-ref-thread': row.thread.id,
        onClick: () => emit('open-thread', row.thread.id),
      },
      [
        h('span', { class: 'truncate' }, row.thread.title),
        h(ThreadStateBadge, { state: row.thread.state, deferCount: row.deferCount }),
      ],
    )
  }
  const task = taskStore.tasks.find((t) => t.id === ref.id)
  if (!task) return null
  return h(
    'button',
    {
      type: 'button',
      class: CHIP,
      'data-ref-task': task.id,
      onClick: () => emit('open-task', task.id),
    },
    [
      h('span', { class: 'shrink-0 font-mono text-muted-foreground' }, task.key),
      h('span', { class: 'truncate' }, task.title),
    ],
  )
}

function inline(nodes: Inline[]): VNodeChild[] {
  return nodes.map((n) => {
    switch (n.kind) {
      case 'text':
        return n.text
      case 'strong':
        return h('strong', { class: 'font-semibold' }, inline(n.children))
      case 'em':
        return h('em', inline(n.children))
      case 'code':
        return h(
          'code',
          { class: 'rounded bg-background px-1 py-0.5 font-mono text-[12px]' },
          n.text,
        )
      case 'ref':
        return chip(n.ref)
    }
  })
}

function listItems(items: ListItem[]): VNodeChild[] {
  return items.map((item) =>
    h(
      'li',
      {
        class: 'whitespace-pre-wrap',
        style: item.level ? { marginLeft: `${item.level * 1.25}rem` } : undefined,
      },
      inline(item.inlines),
    ),
  )
}

function block(b: Block): VNodeChild {
  switch (b.kind) {
    case 'p':
      return h('p', { class: 'whitespace-pre-wrap' }, inline(b.inlines))
    case 'heading':
      /* 채팅창 안의 제목은 크기를 키우지 않고 굵은 한 줄로 */
      return h('p', { class: 'font-semibold', 'data-md-heading': '' }, inline(b.inlines))
    case 'ul':
      return h('ul', { class: 'flex list-disc flex-col gap-0.5 pl-5' }, listItems(b.items))
    case 'ol':
      return h(
        'ol',
        { class: 'flex list-decimal flex-col gap-0.5 pl-5', start: b.start },
        listItems(b.items),
      )
    case 'code':
      return h(
        'pre',
        {
          class:
            'overflow-x-auto rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[12px] leading-relaxed whitespace-pre',
        },
        h('code', b.text),
      )
    case 'hr':
      return h('hr', { class: 'border-border' })
  }
}

const Markdown = () => parseMarkdown(props.text).map(block)
const Plain = () => splitRefs(props.text).map((seg) => ('ref' in seg ? chip(seg.ref) : seg.text))
</script>

<template>
  <div v-if="markdown" class="flex flex-col gap-2 text-sm leading-relaxed break-words" data-md>
    <Markdown />
  </div>
  <p v-else class="text-sm leading-relaxed break-words whitespace-pre-wrap"><Plain /></p>
</template>
