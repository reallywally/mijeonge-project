import { parseMarkdown } from '@/lib/markdown'
import type { Block, Inline, ListItem } from '@/lib/markdown'

/*
 * 글 문서의 본문은 글 편집기(Tiptap)가 낸 HTML 이다. 편집기로 바꾸기 전에 쓴 글은 마크다운이라
 * 열 때 HTML 로 옮겨 편집기에 싣는다 — 고치면 그때 HTML 로 저장된다(서버는 본문을 해석하지 않는다).
 * 편집기는 HTML 을 제 스키마로만 읽어 모르는 태그 · 속성(script · on*)은 버린다 — 여기서 만드는 HTML 도 글자는 모두 이스케이프한다
 */

/** 저장된 본문이 HTML 인지 — 편집기는 늘 태그로 시작하는 글을 낸다. 빈 글은 HTML 로 본다 */
export const isHtmlContent = (content: string) => !content.trim() || /^\s*</.test(content)

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case 'text':
          return escape(n.text).replace(/\n/g, '<br>')
        case 'strong':
          return `<strong>${inline(n.children)}</strong>`
        case 'em':
          return `<em>${inline(n.children)}</em>`
        case 'code':
          return `<code>${escape(n.text)}</code>`
        case 'ref':
          return escape(`[[${n.ref.kind}:${n.ref.id}]]`)
      }
    })
    .join('')
}

/** 들여쓰기 단으로 적힌 목록 항목 → 겹친 목록 */
function list(tag: 'ul' | 'ol', items: ListItem[], start = 1): string {
  const open = tag === 'ol' && start !== 1 ? `<ol start="${start}">` : `<${tag}>`
  let html = open
  let i = 0
  while (i < items.length) {
    const base = items[i].level
    html += `<li><p>${inline(items[i].inlines)}</p>`
    const children: ListItem[] = []
    i += 1
    while (i < items.length && items[i].level > base) children.push(items[i++])
    if (children.length)
      html += list(
        tag,
        children.map((c) => ({ ...c, level: c.level - 1 })),
      )
    html += '</li>'
  }
  return `${html}</${tag}>`
}

function block(b: Block): string {
  switch (b.kind) {
    case 'p':
      return `<p>${inline(b.inlines)}</p>`
    case 'heading':
      /* 편집기는 제목 1 ~ 3단 — 4단 아래는 3단으로 */
      return `<h${Math.min(b.level, 3)}>${inline(b.inlines)}</h${Math.min(b.level, 3)}>`
    case 'ul':
      return list('ul', b.items)
    case 'ol':
      return list('ol', b.items, b.start)
    case 'code':
      return `<pre><code>${escape(b.text)}</code></pre>`
    case 'hr':
      return '<hr>'
    case 'table': {
      const head = b.header.map((c) => `<th><p>${inline(c)}</p></th>`).join('')
      const rows = b.rows
        .map((r) => `<tr>${r.map((c) => `<td><p>${inline(c)}</p></td>`).join('')}</tr>`)
        .join('')
      return `<table><tbody><tr>${head}</tr>${rows}</tbody></table>`
    }
  }
}

/** 예전 마크다운 글 → HTML — 문서 미리보기가 풀던 만큼(제목 · 목록 · 표 · 굵게 · 기울임 · 코드 · 구분선) */
export const markdownToHtml = (markdown: string) =>
  parseMarkdown(markdown, { tables: true }).map(block).join('')

/** 편집기에 실을 HTML — 이미 HTML 이면 그대로, 마크다운이면 옮긴다 */
export const editorHtml = (content: string) =>
  isHtmlContent(content) ? content : markdownToHtml(content)

/** 내려받는 파일 이름 — 쓸 수 없는 글자는 _ 로 */
export const docxFileName = (title: string) =>
  `${title.replace(/[\\/:*?"<>|]/g, '_').trim() || '글 문서'}.docx`
