<script setup lang="ts">
import { h } from 'vue'
import type { VNodeChild } from 'vue'
import { parseMarkdown } from '@/lib/markdown'
import type { Block, Inline, ListItem } from '@/lib/markdown'

/* 글 문서의 미리보기 — lib/markdown 으로 조각내 Vue 로 직접 그린다(v-html 없음). 챗봇과 달리 표를 풀고
   제목은 단마다 크기를 둔다. 근거 표시([[agenda:ID]])는 문서에서 쓰지 않아 적힌 글자 그대로 둔다 */
const props = defineProps<{ text: string }>()

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
        return h('code', { class: 'rounded bg-muted px-1 py-0.5 font-mono text-[12px]' }, n.text)
      case 'ref':
        return `[[${n.ref.kind}:${n.ref.id}]]`
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

const HEADING = ['text-xl font-bold', 'text-lg font-bold', 'text-base font-semibold']

function block(b: Block): VNodeChild {
  switch (b.kind) {
    case 'p':
      return h('p', { class: 'whitespace-pre-wrap' }, inline(b.inlines))
    case 'heading':
      return h(
        `h${Math.min(b.level, 6)}`,
        { class: `${HEADING[b.level - 1] ?? 'text-sm font-semibold'} mt-2`, 'data-md-heading': '' },
        inline(b.inlines),
      )
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
            'overflow-x-auto rounded-md border border-border bg-muted/50 px-2.5 py-2 font-mono text-[12px] leading-relaxed whitespace-pre',
        },
        h('code', b.text),
      )
    case 'hr':
      return h('hr', { class: 'border-border' })
    case 'table':
      return h('div', { class: 'overflow-x-auto' }, [
        h('table', { class: 'w-full border-collapse text-sm', 'data-md-table': '' }, [
          h(
            'thead',
            h(
              'tr',
              b.header.map((c) =>
                h(
                  'th',
                  {
                    class:
                      'border border-border bg-muted/60 px-2.5 py-1.5 text-left text-xs font-medium',
                  },
                  inline(c),
                ),
              ),
            ),
          ),
          h(
            'tbody',
            b.rows.map((r) =>
              h(
                'tr',
                r.map((c) =>
                  h(
                    'td',
                    { class: 'border border-border px-2.5 py-1.5 align-top whitespace-pre-wrap' },
                    inline(c),
                  ),
                ),
              ),
            ),
          ),
        ]),
      ])
  }
}

const Markdown = () => parseMarkdown(props.text, { tables: true }).map(block)
</script>

<template>
  <div class="flex flex-col gap-3 text-sm leading-relaxed break-words" data-doc-preview>
    <Markdown />
  </div>
</template>
