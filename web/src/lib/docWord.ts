import type { JSONContent } from '@tiptap/core'
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild,
} from 'docx'
import mammoth from 'mammoth/mammoth.browser'

/*
 * 글 문서 ↔ .docx — 화면이 버튼을 누를 때 이 모듈을 불러온다(docx · mammoth 가 크다).
 * 가져오기는 mammoth 가 .docx 를 HTML 로 바꾸고 편집기가 제 스키마로 읽는다 — 제목 · 굵게 · 기울임 · 밑줄 · 취소선 ·
 * 목록 · 표 · 그림 · 링크가 옮겨지고, 글꼴 · 크기 · 색 · 정렬 · 머리글 · 쪽 설정은 빠진다.
 * 내려받기는 편집기의 문서(JSON)를 docx 로 그대로 옮긴다 — 색 · 형광펜 · 정렬 · 병합 · 체크리스트까지
 */

/* ── 가져오기 ── */

/** Word 의 밑줄 · 취소선은 mammoth 가 기본으로 버린다 — 편집기가 아는 태그로 옮긴다 */
const STYLE_MAP = ['u => u', 'strike => s']

export interface DocxImport {
  html: string
  /** mammoth 가 옮기지 못했다고 알린 것 — 경고만 센다 */
  warnings: number
}

export async function htmlFromDocx(data: ArrayBuffer): Promise<DocxImport> {
  const result = await mammoth.convertToHtml({ arrayBuffer: data }, { styleMap: STYLE_MAP })
  return {
    html: result.value,
    warnings: result.messages.filter((m) => m.type === 'warning').length,
  }
}

/* ── 내려받기 ── */

export interface ImageSize {
  width: number
  height: number
}

export interface DocxOptions {
  /** 그림의 본래 크기 — 편집기가 크기를 적지 않은 그림에 쓴다. 못 재면 null */
  imageSize?: (src: string) => Promise<ImageSize | null>
}

/** 본문 폭(A4 · 여백 2.54cm)에 맞춘 그림 최대 폭(px, 96dpi) */
const IMAGE_MAX_WIDTH = 600
const FALLBACK_SIZE: ImageSize = { width: 480, height: 360 }
/** 목록 한 단의 들여쓰기(twip) */
const INDENT = 360
const MONO = 'Consolas'
const FONT = '맑은 고딕'

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const
const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
}
const IMAGE_TYPES: Record<string, 'png' | 'jpg' | 'gif' | 'bmp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
}

/** CSS 색(#rgb · #rrggbb · rgb()) → 'RRGGBB'. 못 읽으면 undefined */
export function hexColor(css: unknown): string | undefined {
  if (typeof css !== 'string') return undefined
  const s = css.trim().toLowerCase()
  let m = /^#([0-9a-f]{6})$/.exec(s)
  if (m) return m[1].toUpperCase()
  m = /^#([0-9a-f]{3})$/.exec(s)
  if (m)
    return [...m[1]]
      .map((c) => c + c)
      .join('')
      .toUpperCase()
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(s)
  if (m)
    return m
      .slice(1, 4)
      .map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  return undefined
}

interface Ctx {
  options: DocxOptions
  /** 번호 목록마다 새로 1 부터 — docx 의 numbering instance */
  nextInstance: number
}

type Mark = NonNullable<JSONContent['marks']>[number]

function runOptions(
  text: string,
  marks: Mark[] = [],
  extra: Partial<IRunOptions> = {},
): IRunOptions {
  const has = (type: string) => marks.find((m) => m.type === type)
  const style = has('textStyle')?.attrs ?? {}
  const highlight = has('highlight')
  const fill = hexColor(highlight?.attrs?.color ?? (highlight ? '#fef08a' : style.backgroundColor))
  const code = has('code')
  return {
    text,
    bold: has('bold') ? true : undefined,
    italics: has('italic') ? true : undefined,
    underline: has('underline') || has('link') ? {} : undefined,
    strike: has('strike') ? true : undefined,
    color: has('link') ? '0563C1' : hexColor(style.color),
    shading: fill
      ? { type: ShadingType.CLEAR, fill, color: 'auto' }
      : code
        ? { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' }
        : undefined,
    font: code ? MONO : undefined,
    ...extra,
  }
}

async function imageRun(node: JSONContent, ctx: Ctx): Promise<ParagraphChild> {
  const src = String(node.attrs?.src ?? '')
  const m = /^data:([^;,]+);base64,/.exec(src)
  const type = m ? IMAGE_TYPES[m[1].toLowerCase()] : undefined
  /* 바깥 주소 · svg · webp 는 담지 못한다 — 자리만 남긴다 */
  if (!type) return new TextRun({ text: `[그림${node.attrs?.alt ? `: ${node.attrs.alt}` : ''}]` })
  const set = { width: Number(node.attrs?.width) || 0, height: Number(node.attrs?.height) || 0 }
  let size: ImageSize = set
  if (!set.width || !set.height) {
    const natural = (await ctx.options.imageSize?.(src)) ?? FALLBACK_SIZE
    size = set.width
      ? { width: set.width, height: Math.round((set.width * natural.height) / natural.width) }
      : natural
  }
  const scale = Math.min(1, IMAGE_MAX_WIDTH / size.width)
  return new ImageRun({
    type,
    data: src,
    transformation: {
      width: Math.round(size.width * scale),
      height: Math.round(size.height * scale),
    },
    altText: node.attrs?.alt ? { name: node.attrs.alt, description: node.attrs.alt } : undefined,
  })
}

/** 글 줄 안의 조각 — 글 · 줄바꿈 · 링크(붙은 글은 한 링크로) · 그림 */
async function inlines(nodes: JSONContent[] = [], ctx: Ctx, extra: Partial<IRunOptions> = {}) {
  const out: ParagraphChild[] = []
  /* 같은 주소가 이어지는 글은 한 링크로 묶는다 */
  let href: string | null = null
  let runs: TextRun[] = []
  const flush = () => {
    if (href !== null) out.push(new ExternalHyperlink({ link: href, children: runs }))
    href = null
    runs = []
  }
  for (const n of nodes) {
    if (n.type === 'image') {
      flush()
      out.push(await imageRun(n, ctx))
      continue
    }
    const run =
      n.type === 'hardBreak'
        ? new TextRun({ break: 1 })
        : new TextRun(runOptions(n.text ?? '', n.marks, extra))
    const to = n.marks?.find((m) => m.type === 'link')?.attrs?.href as string | undefined
    if (!to) {
      flush()
      out.push(run)
      continue
    }
    if (href !== to) {
      flush()
      href = to
    }
    runs.push(run)
  }
  flush()
  return out
}

type Block = Paragraph | Table

interface Place {
  /** 목록 안이면 그 단 */
  list?: { reference: 'bullet' | 'ordered'; level: number; instance: number }
  /** 인용 안 */
  quote?: boolean
  /** 체크리스트 항목의 첫 문단 앞에 붙일 표시 */
  check?: string
  /** 목록 항목의 둘째 문단부터는 번호 없이 들여 쓴다 */
  indentLevel?: number
}

function paragraphOptions(node: JSONContent, place: Place): Partial<IParagraphOptions> {
  const align = ALIGN[String(node.attrs?.textAlign ?? '')]
  const opts: { -readonly [K in keyof IParagraphOptions]?: IParagraphOptions[K] } = {}
  if (align && node.attrs?.textAlign !== 'left') opts.alignment = align
  if (place.list) opts.numbering = place.list
  else if (place.indentLevel !== undefined) opts.indent = { left: INDENT * (place.indentLevel + 1) }
  if (place.quote) {
    if (!place.list && place.indentLevel === undefined) opts.indent = { left: INDENT * 2 }
    opts.border = { left: { style: BorderStyle.SINGLE, size: 18, color: 'CBD5E1', space: 8 } }
  }
  return opts
}

async function blocks(nodes: JSONContent[] = [], ctx: Ctx, place: Place = {}): Promise<Block[]> {
  const out: Block[] = []
  for (const n of nodes) out.push(...(await blockOf(n, ctx, place)))
  return out
}

async function blockOf(node: JSONContent, ctx: Ctx, place: Place): Promise<Block[]> {
  switch (node.type) {
    case 'paragraph': {
      const children = await inlines(node.content, ctx)
      if (place.check) children.unshift(new TextRun({ text: place.check }))
      return [new Paragraph({ ...paragraphOptions(node, place), children })]
    }
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 3)
      return [
        new Paragraph({
          ...paragraphOptions(node, place),
          heading: HEADINGS[level - 1],
          children: await inlines(node.content, ctx),
        }),
      ]
    }
    case 'image':
      return [
        new Paragraph({
          ...paragraphOptions(node, place),
          children: [await imageRun(node, ctx)],
        }),
      ]
    case 'blockquote':
      return blocks(node.content, ctx, { ...place, quote: true })
    case 'codeBlock': {
      const text = (node.content ?? []).map((t) => t.text ?? '').join('')
      return text.split('\n').map(
        (line) =>
          new Paragraph({
            ...paragraphOptions(node, place),
            shading: { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' },
            spacing: { before: 0, after: 0 },
            children: [new TextRun({ text: line, font: MONO })],
          }),
      )
    }
    case 'horizontalRule':
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1', space: 1 } },
          children: [],
        }),
      ]
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const level = place.list ? place.list.level + 1 : (place.indentLevel ?? -1) + 1
      const reference = node.type === 'orderedList' ? 'ordered' : 'bullet'
      const instance = node.type === 'orderedList' ? ctx.nextInstance++ : 0
      const out: Block[] = []
      for (const item of node.content ?? []) {
        const [first, ...rest] = item.content ?? []
        const isTask = node.type === 'taskList'
        const check = isTask ? (item.attrs?.checked ? '☑ ' : '☐ ') : undefined
        if (first)
          out.push(
            ...(await blockOf(first, ctx, {
              quote: place.quote,
              ...(isTask
                ? { indentLevel: level, check }
                : { list: { reference, level: Math.min(level, 8), instance } }),
            })),
          )
        for (const n of rest)
          out.push(
            ...(await blockOf(n, ctx, {
              quote: place.quote,
              indentLevel: level,
            })),
          )
      }
      return out
    }
    case 'table':
      return [await tableOf(node, ctx)]
    default:
      /* 모르는 블록은 안쪽만 옮긴다 */
      return node.content ? blocks(node.content, ctx, place) : []
  }
}

async function tableOf(node: JSONContent, ctx: Ctx): Promise<Table> {
  const rows: TableRow[] = []
  for (const row of node.content ?? []) {
    const cells: TableCell[] = []
    for (const cell of row.content ?? []) {
      const header = cell.type === 'tableHeader'
      const width = Array.isArray(cell.attrs?.colwidth)
        ? (cell.attrs.colwidth as (number | null)[]).reduce<number>((a, w) => a + (w ?? 0), 0)
        : 0
      const children = await blocks(cell.content, ctx)
      cells.push(
        new TableCell({
          columnSpan: Number(cell.attrs?.colspan) > 1 ? Number(cell.attrs?.colspan) : undefined,
          rowSpan: Number(cell.attrs?.rowspan) > 1 ? Number(cell.attrs?.rowspan) : undefined,
          /* px → twip(1px = 15twip) */
          width: width ? { size: width * 15, type: WidthType.DXA } : undefined,
          shading: header ? { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' } : undefined,
          children: children.length ? children : [new Paragraph({ children: [] })],
        }),
      )
    }
    if (cells.length) rows.push(new TableRow({ children: cells }))
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
}

const levels = (ordered: boolean) =>
  Array.from({ length: 9 }, (_, level) => ({
    level,
    format: ordered
      ? [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3]
      : LevelFormat.BULLET,
    text: ordered ? `%${level + 1}.` : ['•', '◦', '▪'][level % 3],
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: INDENT * (level + 1), hanging: INDENT } } },
  }))

/** 편집기의 문서(JSON) → docx 문서 */
export async function docxFromContent(
  doc: JSONContent,
  title: string,
  options: DocxOptions = {},
): Promise<Document> {
  const ctx: Ctx = { options, nextInstance: 1 }
  const children = await blocks(doc.content, ctx)
  return new Document({
    title,
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    numbering: {
      config: [
        { reference: 'bullet', levels: levels(false) },
        { reference: 'ordered', levels: levels(true) },
      ],
    },
    sections: [{ children: children.length ? children : [new Paragraph({ children: [] })] }],
  })
}

/** 브라우저에서 그림의 본래 크기를 잰다 — 3초 안에 못 읽으면 null */
export function naturalImageSize(src: string): Promise<ImageSize | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => resolve(null), 3000)
    img.onload = () => {
      clearTimeout(timer)
      resolve(img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : null)
    }
    img.onerror = () => {
      clearTimeout(timer)
      resolve(null)
    }
    img.src = src
  })
}

export async function docxBlob(doc: JSONContent, title: string): Promise<Blob> {
  return Packer.toBlob(await docxFromContent(doc, title, { imageSize: naturalImageSize }))
}
