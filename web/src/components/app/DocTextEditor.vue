<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import type { JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { BackgroundColor, Color, TextStyle } from '@tiptap/extension-text-style'
import { Highlight } from '@tiptap/extension-highlight'
import { TextAlign } from '@tiptap/extension-text-align'
import { Image } from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Code,
  Download,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Table2,
  TriangleAlert,
  Underline,
  Undo2,
  Upload,
} from 'lucide-vue-next'
import { Button, buttonVariants } from '@/components/ui/button'
import { DOC_CONTENT_BYTES_MAX, docContentBytes, docContentProblem } from '@/lib/document'
import { docxFileName, editorHtml } from '@/lib/docHtml'
import { cn } from '@/lib/utils'

/* 글 문서 — 워드처럼 쓰는 편집기(Tiptap). 본문은 편집기가 낸 HTML 로 저장하고, 예전 마크다운 글은 열 때 HTML 로 옮긴다.
   도구 줄: 되돌리기 · 글 단(본문 · 제목 1 ~ 3) · 굵게 · 기울임 · 밑줄 · 취소선 · 코드 · 글자색 · 형광펜 · 정렬 ·
   목록 · 번호 목록 · 체크리스트 · 인용 · 구분선 · 링크 · 그림 · 표 · 서식 지우기, 표 안이면 줄 · 열 · 병합 도구가 한 줄 더.
   .docx 가져오기 · 내려받기는 lib/docWord 를 누를 때 불러온다. [본문에 넣기] 는 마지막 커서가 있던 블록 뒤에 — 한 번도
   안 눌렀으면 끝에 (docs/api/document.md '글 편집기') */
const content = defineModel<string>({ required: true })
const props = defineProps<{ readonly?: boolean; title: string }>()

/** 그림 한 장 — 본문 전체가 5MB 라 그림은 2MB 까지만 받는다 */
const IMAGE_BYTES_MAX = 2 * 1024 * 1024

/** 편집기가 마지막으로 낸 본문 — 부모가 이것과 다른 값을 내려보내면(다시 불러오기) 편집기를 그 값으로 다시 채운다 */
let emitted = content.value
/** 커서를 한 번이라도 옮겼는지 — 안 옮겼으면 [본문에 넣기] 는 끝에 */
let touched = false
const chars = ref(0)
const busy = ref(false)

const editor = useEditor({
  content: editorHtml(content.value),
  editable: !props.readonly,
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
    }),
    TextStyle,
    Color,
    BackgroundColor,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Image.configure({ allowBase64: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Placeholder.configure({
      placeholder:
        '여기에 적습니다. 오른쪽 안건의 [본문에 넣기] 로 결정내용을 끼워 넣거나, .docx 를 가져올 수 있습니다.',
    }),
  ],
  editorProps: {
    attributes: { 'aria-label': '본문', 'data-doc-content': '' },
    handlePaste: (_view, event) => pasteImages(event.clipboardData?.files),
    handleDrop: (_view, event) => pasteImages((event as DragEvent).dataTransfer?.files),
  },
  onCreate: ({ editor: ed }) => {
    chars.value = ed.state.doc.textContent.length
  },
  onUpdate: ({ editor: ed }) => {
    chars.value = ed.state.doc.textContent.length
    emitted = ed.isEmpty ? '' : ed.getHTML()
    content.value = emitted
  },
  onSelectionUpdate: () => {
    touched = true
  },
  onFocus: () => {
    touched = true
  },
})

watch(content, (value) => {
  const ed = editor.value
  if (!ed || value === emitted) return
  emitted = value
  touched = false
  ed.commands.setContent(editorHtml(value), { emitUpdate: false })
  chars.value = ed.state.doc.textContent.length
})
watch(
  () => props.readonly,
  (readonly) => editor.value?.setEditable(!readonly),
)
onBeforeUnmount(() => editor.value?.destroy())

const problem = computed(() => docContentProblem(content.value))
const sizeMb = computed(() => (docContentBytes(content.value) / 1024 / 1024).toFixed(1))
const nearLimit = computed(() => docContentBytes(content.value) > DOC_CONTENT_BYTES_MAX * 0.6)

/* ── 도구 ── */

const run = () => editor.value!.chain().focus()
const active = (name: string, attrs?: Record<string, unknown>) =>
  editor.value?.isActive(name, attrs) ?? false

type Level = 0 | 1 | 2 | 3
const level = computed<Level>(() => {
  for (const l of [1, 2, 3] as const) if (active('heading', { level: l })) return l
  return 0
})
function setLevel(e: Event) {
  const l = Number((e.target as HTMLSelectElement).value) as Level
  if (l === 0) run().setParagraph().run()
  else run().setHeading({ level: l }).run()
}

const ALIGNS = [
  { key: 'left', label: '왼쪽 맞춤', icon: AlignLeft },
  { key: 'center', label: '가운데 맞춤', icon: AlignCenter },
  { key: 'right', label: '오른쪽 맞춤', icon: AlignRight },
  { key: 'justify', label: '양쪽 맞춤', icon: AlignJustify },
] as const

function textColor(e: Event) {
  run()
    .setColor((e.target as HTMLInputElement).value)
    .run()
}
function highlight(e: Event) {
  run()
    .setHighlight({ color: (e.target as HTMLInputElement).value })
    .run()
}

function link() {
  const ed = editor.value!
  const before = (ed.getAttributes('link').href as string | undefined) ?? ''
  const href = window.prompt('링크 주소 — 비우면 링크를 뗍니다', before)
  if (href === null) return
  if (!href.trim()) run().extendMarkRange('link').unsetLink().run()
  else run().extendMarkRange('link').setLink({ href: href.trim() }).run()
}

const inTable = computed(() => active('table'))
const TABLE_TOOLS = [
  { label: '위에 줄', act: () => run().addRowBefore().run() },
  { label: '아래에 줄', act: () => run().addRowAfter().run() },
  { label: '왼쪽에 열', act: () => run().addColumnBefore().run() },
  { label: '오른쪽에 열', act: () => run().addColumnAfter().run() },
  { label: '줄 지우기', act: () => run().deleteRow().run() },
  { label: '열 지우기', act: () => run().deleteColumn().run() },
  { label: '병합', act: () => run().mergeCells().run() },
  { label: '병합 풀기', act: () => run().splitCell().run() },
  { label: '머리 줄', act: () => run().toggleHeaderRow().run() },
  { label: '표 지우기', act: () => run().deleteTable().run(), danger: true },
]

/* ── 그림 ── */

const imageInput = ref<HTMLInputElement | null>(null)

function readImage(file: File): Promise<string | null> {
  if (file.size > IMAGE_BYTES_MAX) {
    toast.error(`'${file.name}' 은 2MB 를 넘어 넣지 않았습니다 — 줄여서 넣어 주세요.`)
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

async function insertImages(files: File[]) {
  for (const file of files) {
    const src = await readImage(file)
    if (src) run().setImage({ src, alt: file.name }).run()
  }
}

/** 붙여 넣기 · 끌어 놓기에 그림 파일이 있으면 그림으로 넣는다 — 글이면 편집기에 맡긴다 */
function pasteImages(list: FileList | null | undefined): boolean {
  const files = [...(list ?? [])].filter((f) => f.type.startsWith('image/'))
  if (!files.length || props.readonly) return false
  void insertImages(files)
  return true
}

function pickImage(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  void insertImages(files)
}

/* ── .docx ── */

const fileInput = ref<HTMLInputElement | null>(null)

async function pickDocx(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const ed = editor.value
  if (!file || !ed) return
  busy.value = true
  try {
    const { htmlFromDocx } = await import('@/lib/docWord')
    const { html, warnings } = await htmlFromDocx(await file.arrayBuffer())
    if (docContentBytes(html) > DOC_CONTENT_BYTES_MAX) {
      toast.error(
        `'${file.name}' 은 본문이 5MB 를 넘어 가져오지 않았습니다 — 그림을 줄이거나 나눠 주세요.`,
      )
      return
    }
    if (
      !ed.isEmpty &&
      !window.confirm(
        `'${file.name}' 으로 지금 본문을 바꿀까요? 제목 · 글자 서식 · 목록 · 표 · 그림 · 링크를 옮기고, 글꼴 · 크기 · 정렬 · 머리글 · 쪽 설정은 빠집니다.`,
      )
    )
      return
    ed.chain().setContent(html).focus('start').run()
    if (warnings) toast(`'${file.name}' 에서 옮기지 못한 서식이 ${warnings}가지 있습니다.`)
  } catch {
    toast.error('.docx 파일을 읽지 못했습니다.')
  } finally {
    busy.value = false
  }
}

async function download() {
  const ed = editor.value
  if (!ed) return
  busy.value = true
  try {
    const { docxBlob } = await import('@/lib/docWord')
    const blob = await docxBlob(ed.getJSON(), props.title)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = docxFileName(props.title)
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    toast.error('.docx 파일을 만들지 못했습니다.')
  } finally {
    busy.value = false
  }
}

/* ── [본문에 넣기] ── */

/** 마지막 커서가 있던 맨 위 블록 뒤(없으면 끝)에 넣는다. 넣은 뒤 커서는 넣은 것 끝 — 이어 넣으면 차례로 쌓인다 */
function insert(nodes: JSONContent[]) {
  const ed = editor.value
  if (!ed || props.readonly) return
  const { doc, selection } = ed.state
  if (ed.isEmpty) {
    ed.chain().insertContentAt({ from: 0, to: doc.content.size }, nodes).run()
    return
  }
  const $to = selection.$to
  const at = !touched ? doc.content.size : $to.depth > 0 ? $to.after(1) : $to.pos
  ed.chain().insertContentAt(at, nodes).run()
}

defineExpose({ insert })

const TOOL = cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'relative')
const ON = 'bg-accent text-foreground'
</script>

<template>
  <div class="flex min-h-0 flex-col gap-2" data-doc-text>
    <div
      class="sticky top-0 z-10 flex flex-col gap-1 rounded-lg border border-border bg-card px-1.5 py-1 shadow-sm"
      data-doc-text-toolbar
    >
      <div class="flex flex-wrap items-center gap-0.5">
        <template v-if="editor && !readonly">
          <Button
            variant="ghost"
            size="icon-sm"
            title="되돌리기 (Ctrl + Z)"
            aria-label="되돌리기"
            :disabled="!editor.can().undo()"
            @click="run().undo().run()"
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="다시 (Ctrl + Y)"
            aria-label="다시"
            :disabled="!editor.can().redo()"
            @click="run().redo().run()"
          >
            <Redo2 />
          </Button>
          <div class="mx-1 h-4 w-px bg-border" />
          <select
            :value="level"
            aria-label="글 단"
            class="h-7 rounded-md border border-input bg-background px-1.5 text-xs outline-none focus-visible:border-ring"
            data-doc-text-level
            @change="setLevel"
          >
            <option :value="0">본문</option>
            <option :value="1">제목 1</option>
            <option :value="2">제목 2</option>
            <option :value="3">제목 3</option>
          </select>
          <div class="mx-1 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon-sm"
            title="굵게 (Ctrl + B)"
            aria-label="굵게"
            :class="active('bold') && ON"
            data-doc-text-bold
            @click="run().toggleBold().run()"
          >
            <Bold />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="기울임 (Ctrl + I)"
            aria-label="기울임"
            :class="active('italic') && ON"
            @click="run().toggleItalic().run()"
          >
            <Italic />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="밑줄 (Ctrl + U)"
            aria-label="밑줄"
            :class="active('underline') && ON"
            @click="run().toggleUnderline().run()"
          >
            <Underline />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="취소선"
            aria-label="취소선"
            :class="active('strike') && ON"
            @click="run().toggleStrike().run()"
          >
            <Strikethrough />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="코드"
            aria-label="코드"
            :class="active('code') && ON"
            @click="run().toggleCode().run()"
          >
            <Code />
          </Button>
          <label :class="TOOL" title="글자색">
            <Baseline />
            <input
              type="color"
              class="absolute inset-0 cursor-pointer opacity-0"
              aria-label="글자색"
              @change="textColor"
            />
          </label>
          <label :class="TOOL" title="형광펜">
            <Highlighter />
            <input
              type="color"
              value="#fef08a"
              class="absolute inset-0 cursor-pointer opacity-0"
              aria-label="형광펜"
              @change="highlight"
            />
          </label>
          <div class="mx-1 h-4 w-px bg-border" />
          <Button
            v-for="a in ALIGNS"
            :key="a.key"
            variant="ghost"
            size="icon-sm"
            :title="a.label"
            :aria-label="a.label"
            :class="a.key !== 'left' && editor.isActive({ textAlign: a.key }) && ON"
            @click="run().setTextAlign(a.key).run()"
          >
            <component :is="a.icon" />
          </Button>
          <div class="mx-1 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon-sm"
            title="목록"
            aria-label="목록"
            :class="active('bulletList') && ON"
            data-doc-text-bullet
            @click="run().toggleBulletList().run()"
          >
            <List />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="번호 목록"
            aria-label="번호 목록"
            :class="active('orderedList') && ON"
            @click="run().toggleOrderedList().run()"
          >
            <ListOrdered />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="체크리스트"
            aria-label="체크리스트"
            :class="active('taskList') && ON"
            @click="run().toggleTaskList().run()"
          >
            <ListChecks />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="인용"
            aria-label="인용"
            :class="active('blockquote') && ON"
            @click="run().toggleBlockquote().run()"
          >
            <Quote />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="구분선"
            aria-label="구분선"
            @click="run().setHorizontalRule().run()"
          >
            <Minus />
          </Button>
          <div class="mx-1 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon-sm"
            title="링크"
            aria-label="링크"
            :class="active('link') && ON"
            @click="link"
          >
            <Link2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="그림 넣기 (2MB 까지 · 붙여 넣기 · 끌어 놓기도 됩니다)"
            aria-label="그림 넣기"
            @click="imageInput?.click()"
          >
            <ImagePlus />
          </Button>
          <input
            ref="imageInput"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/bmp"
            multiple
            class="hidden"
            @change="pickImage"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            title="표 넣기"
            aria-label="표"
            data-doc-text-table
            @click="run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()"
          >
            <Table2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="서식 지우기"
            aria-label="서식 지우기"
            @click="run().unsetAllMarks().clearNodes().run()"
          >
            <RemoveFormatting />
          </Button>
        </template>
        <span class="grow" />
        <span
          class="mr-1 text-xs text-muted-foreground tabular-nums"
          :title="`본문 크기 ${sizeMb}MB / 5MB`"
          data-doc-text-count
          >{{ chars.toLocaleString('ko-KR') }}자<template v-if="nearLimit">
            · {{ sizeMb }} / 5MB</template
          ></span
        >
        <Loader2 v-if="busy" class="mr-1 size-3.5 animate-spin text-muted-foreground" />
        <template v-if="!readonly">
          <input
            ref="fileInput"
            type="file"
            accept=".docx"
            class="hidden"
            data-doc-text-file
            @change="pickDocx"
          />
          <Button
            variant="ghost"
            size="sm"
            :disabled="busy || !editor"
            data-doc-text-import
            @click="fileInput?.click()"
          >
            <Upload class="size-3.5" />
            .docx 가져오기
          </Button>
        </template>
        <Button
          variant="ghost"
          size="sm"
          :disabled="busy || !editor"
          data-doc-text-download
          @click="download"
        >
          <Download class="size-3.5" />
          .docx 내려받기
        </Button>
      </div>

      <div
        v-if="inTable && !readonly"
        class="flex flex-wrap items-center gap-0.5 border-t border-border pt-1"
        data-doc-text-table-tools
      >
        <span class="px-1.5 text-xs text-muted-foreground">표</span>
        <Button
          v-for="t in TABLE_TOOLS"
          :key="t.label"
          variant="ghost"
          size="sm"
          :class="cn('h-7 px-2 text-xs', t.danger && 'text-destructive hover:text-destructive')"
          @click="t.act"
        >
          {{ t.label }}
        </Button>
      </div>
    </div>

    <p
      v-if="problem && !readonly"
      class="flex items-center gap-1.5 text-xs text-destructive"
      role="alert"
      data-doc-text-problem
    >
      <TriangleAlert class="size-3.5" />
      {{ problem }} 본문을 저장하지 않았습니다 — 그림을 줄이거나 나눠 주세요.
    </p>

    <div
      class="doc-page rounded-lg border border-border bg-card shadow-sm"
      :data-readonly="readonly"
    >
      <EditorContent :editor="editor" />
    </div>
  </div>
</template>

<style>
/* 글 편집기의 본문 — Tailwind 가 걷어 낸 기본 꾸밈을 문서답게 다시 둔다 */
.doc-page .ProseMirror {
  min-height: 560px;
  padding: 28px 40px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--card-foreground);
  outline: none;
  overflow-wrap: break-word;
}
.doc-page .ProseMirror > * + * {
  margin-top: 0.6em;
}
.doc-page .ProseMirror h1 {
  font-size: 1.6em;
  font-weight: 700;
  line-height: 1.3;
  margin-top: 1.2em;
  letter-spacing: -0.02em;
}
.doc-page .ProseMirror h2 {
  font-size: 1.3em;
  font-weight: 700;
  line-height: 1.35;
  margin-top: 1.1em;
}
.doc-page .ProseMirror h3 {
  font-size: 1.1em;
  font-weight: 600;
  margin-top: 1em;
}
.doc-page .ProseMirror > :first-child {
  margin-top: 0;
}
.doc-page .ProseMirror ul,
.doc-page .ProseMirror ol {
  padding-left: 1.6em;
}
.doc-page .ProseMirror ul {
  list-style: disc;
}
.doc-page .ProseMirror ul ul {
  list-style: circle;
}
.doc-page .ProseMirror ol {
  list-style: decimal;
}
.doc-page .ProseMirror li > p {
  margin: 0.15em 0;
}
.doc-page .ProseMirror ul[data-type='taskList'] {
  list-style: none;
  padding-left: 0.2em;
}
.doc-page .ProseMirror ul[data-type='taskList'] li {
  display: flex;
  gap: 0.5em;
  align-items: flex-start;
}
.doc-page .ProseMirror ul[data-type='taskList'] li > label {
  margin-top: 0.3em;
  user-select: none;
}
.doc-page .ProseMirror ul[data-type='taskList'] li > div {
  flex: 1;
}
.doc-page .ProseMirror ul[data-type='taskList'] li[data-checked='true'] > div {
  color: var(--muted-foreground);
  text-decoration: line-through;
}
.doc-page .ProseMirror blockquote {
  border-left: 3px solid var(--border);
  padding-left: 1em;
  color: var(--muted-foreground);
}
.doc-page .ProseMirror code {
  border-radius: 4px;
  background: var(--muted);
  padding: 0.1em 0.3em;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
}
.doc-page .ProseMirror pre {
  border-radius: 6px;
  background: var(--muted);
  padding: 0.75em 1em;
  overflow-x: auto;
}
.doc-page .ProseMirror pre code {
  background: none;
  padding: 0;
}
.doc-page .ProseMirror hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.2em 0;
}
.doc-page .ProseMirror a {
  color: var(--primary);
  text-decoration: underline;
}
.doc-page .ProseMirror mark {
  border-radius: 2px;
  padding: 0 0.1em;
  color: inherit;
}
.doc-page .ProseMirror img {
  max-width: 100%;
  height: auto;
}
.doc-page .ProseMirror img.ProseMirror-selectednode {
  outline: 2px solid var(--primary);
}
.doc-page .ProseMirror .tableWrapper {
  overflow-x: auto;
  margin: 0.8em 0;
}
.doc-page .ProseMirror table {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
}
.doc-page .ProseMirror td,
.doc-page .ProseMirror th {
  position: relative;
  min-width: 2em;
  border: 1px solid var(--border);
  padding: 4px 8px;
  vertical-align: top;
}
.doc-page .ProseMirror th {
  background: var(--muted);
  font-weight: 600;
  text-align: left;
}
.doc-page .ProseMirror td > p,
.doc-page .ProseMirror th > p {
  margin: 0;
}
.doc-page .ProseMirror .selectedCell::after {
  position: absolute;
  inset: 0;
  background: color-mix(in oklab, var(--primary) 12%, transparent);
  content: '';
  pointer-events: none;
}
.doc-page .ProseMirror .column-resize-handle {
  position: absolute;
  top: 0;
  right: -2px;
  bottom: -2px;
  width: 4px;
  background: var(--primary);
  pointer-events: none;
}
.doc-page .ProseMirror.resize-cursor {
  cursor: col-resize;
}
.doc-page .ProseMirror p.is-editor-empty:first-child::before {
  float: left;
  height: 0;
  color: var(--muted-foreground);
  content: attr(data-placeholder);
  pointer-events: none;
}
.doc-page[data-readonly='true'] .ProseMirror p.is-editor-empty:first-child::before {
  content: '아직 적은 글이 없습니다.';
}
</style>
