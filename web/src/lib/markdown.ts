import { splitRefs } from '@/lib/chat'
import type { ChatRef } from '@/types/domain'

/*
 * 챗봇 답의 마크다운 — 채팅창에 맞는 몇 가지만 푼다. HTML 로 바꾸지 않고 조각(블록 · 인라인)으로만 나눈다 —
 * 그리는 쪽이 Vue 로 직접 그려 v-html 이 없다(AI 가 낸 글이 HTML 로 끼어들 길이 없다).
 *
 * 블록: 문단 · 제목(#) · 목록(- * • · 1.) · 코드 블록(```) · 구분선(---)
 * 인라인: **굵게** · *기울임* · `코드` · 근거 [[agenda:ID]] · [[task:ID]]
 * 표(| 칸 | 칸 | + | --- |)는 tables 를 켰을 때만 푼다 — 문서 미리보기. 챗봇은 글자 그대로 둔다.
 * 그 밖(링크 · 이미지 · HTML)은 글자 그대로 둔다. 받는 중이라 덜 닫힌 ** 는 잠깐 글자로 비치고,
 * 닫는 ``` 가 아직 안 온 코드 블록은 끝까지 코드로 본다 — 조각이 올 때마다 다시 푼다.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong' | 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'ref'; ref: ChatRef }

export interface ListItem {
  /** 들여쓰기 단 — 0 부터 */
  level: number
  inlines: Inline[]
}

export type Block =
  | { kind: 'p'; inlines: Inline[] }
  | { kind: 'heading'; level: number; inlines: Inline[] }
  | { kind: 'ul'; items: ListItem[] }
  | { kind: 'ol'; start: number; items: ListItem[] }
  | { kind: 'code'; text: string }
  | { kind: 'hr' }
  /** tables 를 켰을 때만. 줄마다 칸 수는 머리 줄에 맞춘다 */
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }

const FENCE_RE = /^\s*```/
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*)$/
const UL_RE = /^(\s*)[-*•]\s+(.*)$/
const OL_RE = /^(\s*)(\d{1,3})[.)]\s+(.*)$/
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/

/* 들여쓰기 두 칸(탭은 네 칸)을 한 단으로 */
const levelOf = (indent: string) => Math.floor(indent.replace(/\t/g, '    ').length / 2)

const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

/** '| a | b |' → ['a', 'b']. 앞뒤 | 는 있어도 없어도 된다 */
function tableCells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

export interface MarkdownOptions {
  /** 표를 푼다 — 문서 미리보기 */
  tables?: boolean
}

export function parseMarkdown(text: string, options: MarkdownOptions = {}): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []

  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', inlines: parseInline(para.join('\n')) })
    para = []
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]

    if (FENCE_RE.test(line)) {
      flush()
      const body: string[] = []
      /* 닫는 ``` 가 아직 안 왔으면(받는 중) 끝까지 코드로 본다. 닫는 줄은 for 의 i += 1 이 넘긴다 */
      while (i + 1 < lines.length && !FENCE_RE.test(lines[i + 1])) {
        i += 1
        body.push(lines[i])
      }
      i += 1
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    if (HR_RE.test(line)) {
      flush()
      blocks.push({ kind: 'hr' })
      continue
    }
    const heading = HEADING_RE.exec(line)
    if (heading) {
      flush()
      blocks.push({
        kind: 'heading',
        level: heading[1].length,
        inlines: parseInline(heading[2].replace(/\s+#+\s*$/, '')),
      })
      continue
    }

    if (
      options.tables &&
      line.includes('|') &&
      i + 1 < lines.length &&
      TABLE_SEP_RE.test(lines[i + 1]) &&
      lines[i + 1].includes('|')
    ) {
      flush()
      const header = tableCells(line)
      const rows: Inline[][][] = []
      i += 1
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim()) {
        i += 1
        const cells = tableCells(lines[i])
        rows.push(header.map((_, c) => parseInline(cells[c] ?? '')))
      }
      blocks.push({ kind: 'table', header: header.map((c) => parseInline(c)), rows })
      continue
    }

    const ul = UL_RE.exec(line)
    const ol = ul ? null : OL_RE.exec(line)
    if (ul || ol) {
      flush()
      const kind = ul ? 'ul' : 'ol'
      const item: ListItem = {
        level: levelOf((ul ?? ol)![1]),
        inlines: parseInline(ul ? ul[2] : ol![3]),
      }
      const last = blocks.at(-1)
      if (last && last.kind === kind) last.items.push(item)
      else if (kind === 'ul') blocks.push({ kind: 'ul', items: [item] })
      else blocks.push({ kind: 'ol', start: Number(ol![2]), items: [item] })
      continue
    }

    /* 목록 바로 밑의 들여쓴 줄은 그 항목에 잇는다 */
    const last = blocks.at(-1)
    if (!para.length && last && (last.kind === 'ul' || last.kind === 'ol') && /^\s+\S/.test(line)) {
      const item = last.items.at(-1)!
      item.inlines = merge([
        ...item.inlines,
        { kind: 'text', text: '\n' },
        ...parseInline(line.trim()),
      ])
      continue
    }
    para.push(line)
  }
  flush()
  return blocks
}

/** 인라인 — 코드 → 굵게 → 기울임 순으로 찾고, 남은 글에서 근거 표시를 칩으로 뗀다 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let rest = text
  while (rest) {
    const at = nextMark(rest)
    if (!at) {
      out.push(...plain(rest))
      break
    }
    if (at.index > 0) out.push(...plain(rest.slice(0, at.index)))
    out.push(at.node)
    rest = rest.slice(at.index + at.length)
  }
  return merge(out)
}

type Mark = { index: number; length: number; node: Inline }

function nextMark(s: string): Mark | null {
  const found: Mark[] = []
  const code = /`([^`\n]+)`/.exec(s)
  if (code)
    found.push({ index: code.index, length: code[0].length, node: { kind: 'code', text: code[1] } })
  /* 굵게 — 안쪽이 공백으로 시작 · 끝나지 않는 것만(곱하기 '2 ** 3' 은 글자로) */
  const strong = /\*\*(?=\S)([\s\S]*?\S)\*\*/.exec(s)
  if (strong)
    found.push({
      index: strong.index,
      length: strong[0].length,
      node: { kind: 'strong', children: parseInline(strong[1]) },
    })
  /* 기울임 — 별 하나. 굵게의 별과 겹치지 않게 앞뒤가 별이 아닌 것만. 밑줄(_)은 snake_case 가 깨져 안 푼다 */
  const em = /(?<![*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/.exec(s)
  if (em)
    found.push({
      index: em.index,
      length: em[0].length,
      node: { kind: 'em', children: parseInline(em[1]) },
    })
  if (!found.length) return null
  /* 가장 앞의 것, 같은 자리면 긴 것(굵게가 기울임보다 먼저) */
  return found.sort((a, b) => a.index - b.index || b.length - a.length)[0]
}

function plain(text: string): Inline[] {
  return splitRefs(text).map((seg) =>
    'ref' in seg ? { kind: 'ref', ref: seg.ref } : { kind: 'text', text: seg.text },
  )
}

/** 붙은 글 조각을 하나로 */
function merge(nodes: Inline[]): Inline[] {
  const out: Inline[] = []
  for (const n of nodes) {
    const last = out.at(-1)
    if (n.kind === 'text' && last?.kind === 'text') last.text += n.text
    else out.push(n)
  }
  return out
}
