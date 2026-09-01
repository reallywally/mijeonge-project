<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, Check, Info, Plus, X } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import EntryKindBadge from '@/components/app/EntryKindBadge.vue'
import PersonChip from '@/components/app/PersonChip.vue'
import ThreadStateBadge from '@/components/app/ThreadStateBadge.vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { monthDay } from '@/lib/date'
import { useMijeongeStore } from '@/stores/mijeonge'
import type { EntryKind, MeetingEntryInput, NewThreadInput, ThreadState } from '@/types/domain'

const store = useMijeongeStore()
const router = useRouter()

/* 회의가 짊어지는 것은 제목 · 날짜 · 참석자뿐이다. 회의록 본문은 쓰지 않는다. */
const title = ref('')
const date = ref(new Date().toISOString().slice(0, 10))
const attendees = ref<string[]>([])

function toggleAttendee(id: string) {
  attendees.value = attendees.value.includes(id)
    ? attendees.value.filter((x) => x !== id)
    : [...attendees.value, id]
}

/* 이번 회의에서 처음 등록한 안건 — 저장할 때 실제 id 를 받는다 */
const newThreads = ref<NewThreadInput[]>([])
let tempSeq = 0

function registerThread(title: string, ownerId: string | null, parentThreadId: string | null) {
  tempSeq += 1
  const tempId = `tmp${tempSeq}`
  newThreads.value.push({ tempId, title, ownerId, parentThreadId })
  return tempId
}

interface PickRow {
  id: string
  title: string
  state: ThreadState
  deferCount: number
  meta: string
}

const STATE_ORDER: Record<ThreadState, number> = { queued: 0, open: 1, decided: 2 }

/** 이 회의에서 등록한 안건이 위에, 그 아래로 대기 → 미결정 → 결정됨 순서다 */
const pool = computed<PickRow[]>(() => {
  const fresh = newThreads.value.map((nt) => ({
    id: nt.tempId,
    title: nt.title,
    state: 'queued' as ThreadState,
    deferCount: 0,
    meta: nt.parentThreadId
      ? `${titleOf(nt.parentThreadId)} 에서 떼어냄 · 이번 회의`
      : '이번 회의에서 등록 · 아직 다룬 적 없음',
  }))

  const registered = store.rows
    .map((r) => ({
      id: r.thread.id,
      title: r.thread.title,
      state: r.thread.state,
      deferCount: r.deferCount,
      meta:
        r.thread.state === 'queued'
          ? `${monthDay(r.thread.createdAt)} 등록 · 아직 다룬 적 없음`
          : `마지막 회의 ${r.lastMeetingLabel} · 이력 ${r.entryCount}건`,
    }))
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state])

  return [...fresh, ...registered]
})

function titleOf(id: string) {
  return (
    newThreads.value.find((nt) => nt.tempId === id)?.title ??
    store.allThreads.find((t) => t.id === id)?.title ??
    ''
  )
}

/* 담은 안건 — 담은 순서를 그대로 둔다 */
const picked = ref<string[]>([])
const pickedRows = computed(() =>
  picked.value.map((id) => pool.value.find((p) => p.id === id)).filter((p): p is PickRow => !!p),
)

function drop(id: string) {
  picked.value = picked.value.filter((x) => x !== id)
  formKind[id] = null
}

/* 안건 담기 팝업 — 고르는 동안은 staged 에만 쌓고 추가를 누를 때 옮긴다 */
const pickerOpen = ref(false)
const staged = ref<string[]>([])

function openPicker() {
  staged.value = [...picked.value]
  pickerOpen.value = true
}
function toggleStaged(id: string) {
  staged.value = staged.value.includes(id)
    ? staged.value.filter((x) => x !== id)
    : [...staged.value, id]
}
function commitPicker() {
  const kept = picked.value.filter((id) => staged.value.includes(id))
  picked.value = [...kept, ...staged.value.filter((id) => !kept.includes(id))]
  pickerOpen.value = false
}

/**
 * 한 안건에 붙는 행위 여섯 가지 가운데, 회의에서 등록하는 다섯 가지.
 * 아직 못 정한 안건은 정함 · 못 정함, 이미 정해진 안건은 세부 · 변경 · 분리다.
 */
const FORM: Record<
  EntryKind,
  { hint: string; placeholder: string; notePlaceholder: string; confirm: string }
> = {
  decide: {
    hint: '이번에 어떻게 정했나요',
    placeholder: '한 줄로 — 정해진 내용',
    notePlaceholder: '왜 그렇게 정했는지 (선택)',
    confirm: '결정으로 남기기',
  },
  defer: {
    hint: '이번에 어디까지 갔나요',
    placeholder: '한 줄로 — 예: 이번에도 결론을 내지 못했다',
    notePlaceholder: '왜 못 정했고 다음에 무엇이 필요한가요 (선택)',
    confirm: '미룸으로 남기기',
  },
  refine: {
    hint: '이미 정한 것에 무엇을 더 정했나요',
    placeholder: '한 줄로 — 더 정한 내용',
    notePlaceholder: '왜 그렇게 정했는지 (선택)',
    confirm: '세부로 붙이기',
  },
  change: {
    hint: '무엇으로 바꾸었나요',
    placeholder: '한 줄로 — 바뀐 결정',
    notePlaceholder: '무엇을 대체하는지, 왜 바꿨는지 (선택)',
    confirm: '변경으로 남기기',
  },
  split: {
    hint: '어떤 줄을 떼어낼까요',
    placeholder: '새 안건 제목',
    notePlaceholder: '왜 따로 떼어내는지 (선택)',
    confirm: '하위 안건으로 올리기',
  },
  raise: { hint: '', placeholder: '', notePlaceholder: '', confirm: '' },
}

/** 조건별 상세는 결정을 담는 줄에만 붙는다. 미룸 · 분리에는 담당자만 받는다. */
const needsDetail = (kind: EntryKind) => kind === 'decide' || kind === 'refine' || kind === 'change'
const needsOwner = (kind: EntryKind) => kind !== 'defer'

function actsOf(row: PickRow) {
  if (row.state === 'decided') {
    return [
      { kind: 'refine' as const, label: '세부 추가' },
      { kind: 'change' as const, label: '결정 변경' },
      { kind: 'split' as const, label: '하위 안건으로 분리' },
    ]
  }
  return [
    { kind: 'decide' as const, label: '이번에 정함' },
    { kind: 'defer' as const, label: row.deferCount > 0 ? '이번에도 못 정함' : '이번에 못 정함' },
  ]
}

const formKind = reactive<Record<string, EntryKind | null>>({})
const fText = reactive<Record<string, string>>({})
const fDetail = reactive<Record<string, string>>({})
const fNote = reactive<Record<string, string>>({})
const fOwner = reactive<Record<string, string | null>>({})

function pickForm(id: string, kind: EntryKind) {
  formKind[id] = formKind[id] === kind ? null : kind
}
function closeForm(id: string) {
  formKind[id] = null
}

/* 이 회의에서 안건에 남긴 줄. 이것이 그대로 회의의 기록이 된다. */
const lines = ref<MeetingEntryInput[]>([])
const linesOf = (id: string) => lines.value.filter((l) => l.threadId === id)

function undo(line: MeetingEntryInput) {
  lines.value = lines.value.filter((l) => l !== line)
}

function submitForm(row: PickRow) {
  const kind = formKind[row.id]
  if (!kind) return
  const text = (fText[row.id] ?? '').trim()
  if (!text) return

  const note = (fNote[row.id] ?? '').trim()
  const ownerId = needsOwner(kind) ? (fOwner[row.id] ?? null) : null
  const detail = needsDetail(kind)
    ? (fDetail[row.id] ?? '')
        .split('\n')
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
    : []

  if (kind === 'split') {
    /* 떼어낸 줄은 이 프로젝트의 안건으로 따로 쌓이고, 이번 회의가 그 안건의 첫 줄이 된다 */
    const tempId = registerThread(text, ownerId, row.id)
    lines.value.push({
      threadId: row.id,
      kind: 'split',
      text: `${text} — 따로 안건으로 올렸다`,
      detail: [],
      note,
      ownerId: null,
    })
    lines.value.push({ threadId: tempId, kind: 'raise', text, detail: [], note: '', ownerId })
    picked.value = [...picked.value, tempId]
  } else {
    lines.value.push({ threadId: row.id, kind, text, detail, note, ownerId })
  }

  fText[row.id] = ''
  fDetail[row.id] = ''
  fNote[row.id] = ''
  formKind[row.id] = null
}

/* 회의 중에 처음 나온 안건 — 등록하면서 이번 회의의 줄까지 같이 남긴다 */
const newOpen = ref(false)
const newKind = ref<'decide' | 'raise'>('decide')
const newTitle = ref('')

function addNewThread() {
  const text = newTitle.value.trim()
  if (!text) return
  const tempId = registerThread(text, null, null)
  lines.value.push({ threadId: tempId, kind: newKind.value, text, detail: [], note: '', ownerId: null })
  picked.value = [...picked.value, tempId]
  newTitle.value = ''
  newOpen.value = false
}

/* 회의 메모 — 안건에 붙지 않는 것만 한 줄씩. 그 자리에서 대기 안건으로 올릴 수 있다. */
const memos = ref<{ id: string; text: string; promotedTempId: string | null }[]>([])
const memoDraft = ref('')
let memoSeq = 0

function addMemo() {
  const text = memoDraft.value.trim()
  if (!text) return
  memoSeq += 1
  memos.value.push({ id: `md${memoSeq}`, text, promotedTempId: null })
  memoDraft.value = ''
}
function promoteMemo(memo: { text: string; promotedTempId: string | null }) {
  memo.promotedTempId = registerThread(memo.text, null, null)
}

const doneLabel = computed(() =>
  lines.value.length === 0
    ? '아직 남긴 줄이 없습니다'
    : `${new Set(lines.value.map((l) => l.threadId)).size}개 안건에 줄 ${lines.value.length}개를 남겼습니다`,
)

const canSave = computed(
  () => title.value.trim().length > 0 && (lines.value.length > 0 || memos.value.length > 0),
)

function save() {
  if (!canSave.value) return
  store.saveMeeting({
    title: title.value.trim(),
    date: date.value,
    attendeeIds: attendees.value,
    newThreads: newThreads.value,
    entries: lines.value,
    memos: memos.value.map((m) => ({ text: m.text, promotedTempId: m.promotedTempId })),
  })
  router.push('/threads')
}

const STRIPE: Record<ThreadState, string> = {
  queued: 'border-l-border',
  open: 'border-l-primary',
  decided: 'border-l-muted-foreground/40',
}
</script>

<template>
  <AppShell>
    <template #actions>
      <span class="text-xs text-muted-foreground">{{ doneLabel }}</span>
      <Button variant="outline" @click="router.push('/threads')">취소</Button>
      <Button :disabled="!canSave" @click="save">저장</Button>
    </template>

    <template #aside>
      <div class="h-px bg-border" />
      <div class="flex flex-col gap-3">
        <div class="text-xs font-medium text-muted-foreground">회의</div>
        <div class="flex flex-col gap-2">
          <Label class="text-xs text-muted-foreground">날짜</Label>
          <Input v-model="date" type="date" class="bg-background" />
        </div>
        <div class="flex flex-col gap-2">
          <Label class="text-xs text-muted-foreground">참석자</Label>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="m in store.allMembers"
              :key="m.id"
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded-full border py-0.5 pr-3 pl-1.5 text-xs transition-colors"
              :class="
                attendees.includes(m.id)
                  ? 'border-primary bg-accent font-medium text-accent-foreground'
                  : 'border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'
              "
              @click="toggleAttendee(m.id)"
            >
              <span class="flex size-[19px] items-center justify-center rounded-full bg-secondary text-[10px] text-muted-foreground">
                {{ m.name.charAt(0) }}
              </span>
              {{ m.name }}
            </button>
          </div>
        </div>
        <p class="text-xs leading-relaxed text-muted-foreground text-pretty">
          회의가 짊어지는 것은 날짜 · 참석자뿐입니다. 회의록 본문은 쓰지 않고, 안건에 남긴 줄이 그대로
          이 회의의 기록이 됩니다.
        </p>
      </div>
    </template>

    <div class="flex min-h-0 grow">
      <div class="flex min-w-0 grow flex-col overflow-hidden">
        <div class="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-border px-[26px]">
          <span class="text-xs font-medium text-muted-foreground">이번 회의에서 다룰 안건</span>
          <span class="text-xs font-medium">{{ picked.length }}</span>
          <div class="grow" />
          <Button size="sm" @click="openPicker">
            <Plus class="size-3.5" />
            안건 담기
          </Button>
        </div>

        <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
          <div class="flex w-full max-w-[760px] flex-col gap-5">
            <header class="flex flex-col gap-2.5">
              <Input
                v-model="title"
                placeholder="회의 이름 — 예: 3월 3주차 제품 회의"
                class="h-auto border-0 px-0 py-0 text-2xl font-semibold tracking-tight shadow-none focus-visible:ring-0 md:text-2xl"
              />
              <p class="text-xs text-muted-foreground">{{ monthDay(date) }} · {{ doneLabel }}</p>
            </header>

            <div v-if="picked.length === 0" class="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border px-6 py-[26px]">
              <p class="text-sm text-muted-foreground">아직 담은 안건이 없습니다.</p>
              <p class="text-sm text-muted-foreground">오른쪽 위 안건 담기로 등록된 안건에서 고르세요.</p>
            </div>

            <div
              v-for="row in pickedRows"
              :key="row.id"
              class="flex flex-col gap-3 rounded-lg border border-border border-l-[3px] bg-card px-[18px] py-4 shadow-sm"
              :class="STRIPE[row.state]"
            >
              <div class="flex items-start gap-3">
                <div class="flex min-w-0 grow flex-col gap-2">
                  <p class="text-[15px] leading-snug font-semibold text-pretty">{{ row.title }}</p>
                  <div class="flex flex-wrap items-center gap-2">
                    <ThreadStateBadge :state="row.state" :defer-count="row.deferCount" />
                    <span class="text-xs text-muted-foreground">{{ row.meta }}</span>
                  </div>
                </div>
                <Button variant="ghost" size="sm" class="shrink-0 text-muted-foreground" @click="drop(row.id)">
                  <X class="size-3.5" />
                  빼기
                </Button>
              </div>

              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="a in actsOf(row)"
                  :key="a.kind"
                  type="button"
                  class="inline-flex h-9 items-center rounded-md border px-3 text-xs font-medium transition-colors"
                  :class="
                    formKind[row.id] === a.kind
                      ? 'border-primary bg-primary text-primary-foreground shadow'
                      : 'border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'
                  "
                  @click="pickForm(row.id, a.kind)"
                >
                  {{ a.label }}
                </button>
              </div>

              <div
                v-if="formKind[row.id]"
                class="flex flex-col gap-2.5 rounded-md border border-border bg-muted/50 px-3.5 py-3"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <EntryKindBadge :kind="formKind[row.id]!" />
                  <span class="text-xs text-muted-foreground">{{ FORM[formKind[row.id]!].hint }}</span>
                </div>

                <Input
                  v-model="fText[row.id]"
                  :placeholder="FORM[formKind[row.id]!].placeholder"
                  class="bg-background"
                  @keyup.enter="submitForm(row)"
                />

                <div v-if="needsDetail(formKind[row.id]!)" class="flex flex-col gap-1.5">
                  <Textarea
                    v-model="fDetail[row.id]"
                    rows="3"
                    placeholder="조건별 상세 (선택) — 한 줄에 하나씩&#10;예: 5xx 응답은 4회까지&#10;예: 잔액 부족은 재시도하지 않는다"
                    class="bg-background"
                  />
                  <p class="text-xs leading-relaxed text-muted-foreground text-pretty">
                    조건마다 갈리면 한 줄에 하나씩. 따로 쫓아다녀야 하는 줄만 하위 안건으로 올리세요.
                  </p>
                </div>

                <p v-if="formKind[row.id] === 'split'" class="text-xs leading-relaxed text-muted-foreground text-pretty">
                  떼어낸 줄은 이 프로젝트의 안건으로 따로 쌓이고, 이번 회의가 그 안건의 첫 줄이 됩니다.
                </p>

                <Input
                  v-model="fNote[row.id]"
                  :placeholder="FORM[formKind[row.id]!].notePlaceholder"
                  class="bg-background"
                />

                <div v-if="needsOwner(formKind[row.id]!)" class="flex flex-col gap-2">
                  <span class="text-xs text-muted-foreground">담당자</span>
                  <div class="flex flex-wrap gap-1.5">
                    <button
                      v-for="m in store.allMembers"
                      :key="m.id"
                      type="button"
                      class="inline-flex h-8 items-center gap-1.5 rounded-full border py-0.5 pr-3 pl-1.5 text-xs transition-colors"
                      :class="
                        fOwner[row.id] === m.id
                          ? 'border-primary bg-accent font-medium text-accent-foreground'
                          : 'border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'
                      "
                      @click="fOwner[row.id] = fOwner[row.id] === m.id ? null : m.id"
                    >
                      <span class="flex size-[19px] items-center justify-center rounded-full bg-secondary text-[10px] text-muted-foreground">
                        {{ m.name.charAt(0) }}
                      </span>
                      {{ m.name }}
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-8 items-center rounded-full border px-3 text-xs transition-colors"
                      :class="
                        fOwner[row.id]
                          ? 'border-border bg-background text-muted-foreground shadow-sm hover:bg-accent hover:text-accent-foreground'
                          : 'border-primary bg-accent font-medium text-accent-foreground'
                      "
                      @click="fOwner[row.id] = null"
                    >
                      미정
                    </button>
                  </div>
                </div>

                <div class="flex gap-2">
                  <Button size="sm" :disabled="!(fText[row.id] ?? '').trim()" @click="submitForm(row)">
                    {{ FORM[formKind[row.id]!].confirm }}
                  </Button>
                  <Button variant="outline" size="sm" @click="closeForm(row.id)">닫기</Button>
                </div>
              </div>

              <div
                v-for="(line, i) in linesOf(row.id)"
                :key="i"
                class="flex flex-col gap-2 rounded-md bg-muted/50 px-3.5 py-3"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <EntryKindBadge :kind="line.kind" />
                  <span class="text-xs text-muted-foreground">이 회의의 기록이자 이 안건의 이력</span>
                  <div class="grow" />
                  <button
                    type="button"
                    class="text-xs text-muted-foreground underline-offset-4 hover:underline"
                    @click="undo(line)"
                  >
                    되돌리기
                  </button>
                </div>
                <p class="text-sm leading-relaxed text-pretty">{{ line.text }}</p>
                <div v-if="line.detail.length" class="flex flex-col gap-1 border-l-2 border-border pl-3">
                  <p v-for="(d, j) in line.detail" :key="j" class="text-[13px] leading-relaxed text-muted-foreground text-pretty">
                    {{ d }}
                  </p>
                </div>
                <p v-if="line.note" class="text-xs leading-relaxed text-muted-foreground text-pretty">
                  {{ line.note }}
                </p>
                <PersonChip
                  v-if="store.memberName(line.ownerId)"
                  :name="store.memberName(line.ownerId)!"
                  class="self-start"
                />
              </div>
            </div>

            <div class="flex flex-col gap-2 pb-[26px]">
              <Button v-if="!newOpen" variant="outline" class="h-11 border-dashed" @click="newOpen = true">
                <Plus class="size-4" />
                회의 중에 처음 나온 안건 등록
              </Button>

              <div v-else class="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-[18px] py-4 shadow-sm">
                <p class="text-xs leading-relaxed text-muted-foreground text-pretty">
                  여기서 등록하면 프로젝트의 안건으로 바로 올라가고, 이번 회의가 그 안건의 첫 줄이 됩니다.
                </p>
                <div class="flex gap-1.5">
                  <button
                    v-for="k in [{ key: 'decide' as const, label: '정해짐' }, { key: 'raise' as const, label: '못 정함' }]"
                    :key="k.key"
                    type="button"
                    class="inline-flex h-9 grow items-center justify-center rounded-md border text-xs font-medium transition-colors"
                    :class="
                      newKind === k.key
                        ? 'border-primary bg-primary text-primary-foreground shadow'
                        : 'border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'
                    "
                    @click="newKind = k.key"
                  >
                    {{ k.label }}
                  </button>
                </div>
                <Input
                  v-model="newTitle"
                  :placeholder="newKind === 'decide' ? '무엇을 정했나요' : '무엇을 못 정했나요'"
                  @keyup.enter="addNewThread"
                />
                <div class="flex gap-2">
                  <Button size="sm" :disabled="!newTitle.trim()" @click="addNewThread">등록</Button>
                  <Button variant="outline" size="sm" @click="newOpen = false">취소</Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside class="flex w-[360px] shrink-0 flex-col overflow-hidden border-l border-border bg-muted/50">
        <div class="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-border px-4">
          <span class="text-xs font-medium text-muted-foreground">회의 메모</span>
          <span class="text-xs text-muted-foreground">선택 — 안 적어도 됩니다</span>
        </div>

        <div class="flex min-h-0 grow flex-col gap-3 overflow-y-auto p-4">
          <div class="flex items-start gap-2 rounded-md bg-muted px-3 py-2.5">
            <Info class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <p class="min-w-0 grow text-xs leading-relaxed text-muted-foreground text-pretty">
              안건에 붙지 않는 것만 한 줄씩 — 공유한 숫자, 일정, 아직 이름 붙이기 이른 소식.
            </p>
          </div>

          <div
            v-for="memo in memos"
            :key="memo.id"
            class="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-3.5 py-3 shadow-sm"
          >
            <p class="text-sm leading-relaxed text-pretty">{{ memo.text }}</p>
            <Button
              v-if="!memo.promotedTempId"
              variant="outline"
              size="sm"
              class="self-start border-dashed"
              @click="promoteMemo(memo)"
            >
              <ArrowRight class="size-3.5" />
              안건으로 올리기
            </Button>
            <span v-else class="inline-flex items-center gap-1.5 self-start text-xs text-muted-foreground">
              <Check class="size-3.5" />
              안건으로 등록됨 · 대기
            </span>
          </div>

          <div class="flex flex-col gap-2">
            <Input v-model="memoDraft" placeholder="한 줄씩 적습니다" class="bg-background" @keyup.enter="addMemo" />
            <Button variant="outline" size="sm" class="self-start" :disabled="!memoDraft.trim()" @click="addMemo">
              메모 추가
            </Button>
          </div>
        </div>
      </aside>
    </div>

    <Dialog v-model:open="pickerOpen">
      <DialogContent class="flex max-h-[86vh] flex-col gap-0 p-0 sm:max-w-[720px]">
        <DialogHeader class="shrink-0 gap-2 border-b border-border px-[22px] py-[18px] pr-[52px] text-left">
          <DialogTitle>등록된 안건</DialogTitle>
          <DialogDescription class="text-pretty">
            {{ store.currentProject.name }} · {{ pool.length }}건. 이번 회의에서 다룰 것만 고르고 추가를 누르세요.
            대기 안건이 위에 있습니다.
          </DialogDescription>
        </DialogHeader>

        <div class="flex min-h-0 grow flex-col gap-0.5 overflow-y-auto px-3 py-3">
          <div
            v-for="p in pool"
            :key="p.id"
            role="checkbox"
            :aria-checked="staged.includes(p.id)"
            tabindex="0"
            class="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            :class="staged.includes(p.id) ? 'bg-accent' : ''"
            @click="toggleStaged(p.id)"
            @keydown.enter.prevent="toggleStaged(p.id)"
            @keydown.space.prevent="toggleStaged(p.id)"
          >
            <Checkbox
              :model-value="staged.includes(p.id)"
              aria-hidden="true"
              tabindex="-1"
              class="pointer-events-none shrink-0"
            />
            <div class="flex min-w-0 grow flex-col gap-1">
              <span class="text-sm leading-snug text-pretty">{{ p.title }}</span>
              <span class="text-xs text-muted-foreground">{{ p.meta }}</span>
            </div>
            <ThreadStateBadge :state="p.state" :defer-count="p.deferCount" class="shrink-0" />
          </div>
        </div>

        <DialogFooter class="shrink-0 items-center border-t border-border px-[22px] py-4 sm:justify-start">
          <span class="text-sm text-muted-foreground">{{ staged.length }}건 선택</span>
          <div class="grow" />
          <Button variant="outline" @click="pickerOpen = false">취소</Button>
          <Button @click="commitPicker">추가</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </AppShell>
</template>
