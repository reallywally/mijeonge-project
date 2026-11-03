<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, FolderClosed, Loader2, Lock, Pencil, Trash2 } from 'lucide-vue-next'
import { ApiError } from '@/api'
import CheckRequestSection from '@/components/app/CheckRequestSection.vue'
import EntryKindBadge from '@/components/app/EntryKindBadge.vue'
import HistorySection from '@/components/app/HistorySection.vue'
import MinutesSourceChip from '@/components/app/MinutesSourceChip.vue'
import PersonChip from '@/components/app/PersonChip.vue'
import ThreadDecisionPanel from '@/components/app/ThreadDecisionPanel.vue'
import ThreadFields from '@/components/app/ThreadFields.vue'
import ThreadPropertyPanel from '@/components/app/ThreadPropertyPanel.vue'
import ThreadStateBadge from '@/components/app/ThreadStateBadge.vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { monthDay } from '@/lib/date'
import { ENTRY_KIND_LABEL } from '@/lib/history'
import { toastError } from '@/lib/notify'
import { READONLY_HINT } from '@/lib/task'
import { useDataStore } from '@/stores/data'
import { useThreadStore } from '@/stores/thread'
import type { Entry } from '@/types/domain'

/* 안건 상세 — 목록 위 팝업. 작업 상세처럼 보는 자리가 곧 고치는 자리다: 칸을 고치고 벗어나면
   그 값만 바로 들어가고 따로 저장 버튼이 없다. 칸 모양은 안건 추가와 같다(ThreadFields · ThreadPropertyPanel).
   상태만은 칸으로 못 바꾼다 — 결정 영역에서 남긴 줄로만 바뀐다.
   고치기 · 지우기는 작성자 · 담당자 · 관리자만 — 아니면 칸을 잠그고 보기만 한다(결정 · 미루기는 누구나 남긴다).
   이력 줄 고치기 · 지우기는 그 줄을 남긴 사람까지 */
const props = defineProps<{ threadId: string | null }>()
const open = defineModel<boolean>('open', { required: true })
/* 하위 안건을 누르면 그 안건으로 갈아탄다 — 목록을 거치지 않는다 */
const emit = defineEmits<{ (e: 'open-thread', id: string): void }>()

const data = useDataStore()
const threadStore = useThreadStore()
const detail = computed(() => (props.threadId ? threadStore.threadDetail(props.threadId) : null))
const canEdit = computed(() => (detail.value ? threadStore.canEdit(detail.value.thread) : false))
const canDelete = computed(() =>
  detail.value ? threadStore.canDelete(detail.value.thread) : false,
)
/* 지우기 확인 다이얼로그 — 안건 하나 · 이력 줄 하나를 같은 자리에서 묻는다 */
type DeleteTarget = { kind: 'thread' } | { kind: 'entry'; entry: Entry }
const deleteTarget = ref<DeleteTarget | null>(null)
const confirmOpen = computed({
  get: () => deleteTarget.value !== null,
  set: (v: boolean) => {
    if (!v) deleteTarget.value = null
  },
})
const deleting = ref(false)
const deleteError = ref('')

/* 글 칸은 고치는 동안 여기서 들고 있다가 칸을 벗어날 때 넣는다 */
const titleDraft = ref('')
const descriptionDraft = ref('')
const optionsDraft = ref('')

const optionsText = (options: string[]) => options.join('\n')

function fill(field?: 'title' | 'description' | 'options') {
  const t = detail.value?.thread
  if (!field || field === 'title') titleDraft.value = t?.title ?? ''
  if (!field || field === 'description') descriptionDraft.value = t?.description ?? ''
  if (!field || field === 'options') optionsDraft.value = optionsText(t?.options ?? [])
}

/* 이력 한 줄 고치기 — 실수로 Enter 를 눌러 남긴 결정 · 메모를 바로잡는다.
   글(요약 · 메모)만 고친다. 종류는 못 바꾼다 — 줄이 이미 안건 상태를 바꿨으니 바꾸려면 새 줄을 남긴다.
   칸을 벗어나도 저장하지 않는다 — [저장] 을 눌러야 들어간다(실수로 또 저장되지 않게) */
const editingEntryId = ref<string | null>(null)
const entryTextDraft = ref('')
const entryNoteDraft = ref('')
/* v-for 안이라 문자열 ref 는 배열이 된다 — 열린 편집 칸 하나만 잡는다 */
let entryNoteField: HTMLTextAreaElement | null = null
const setEntryNoteField = (el: unknown) => {
  entryNoteField = ((el as { $el?: HTMLTextAreaElement } | null)?.$el ??
    null) as HTMLTextAreaElement | null
}

function editEntry(entry: Entry) {
  editingEntryId.value = entry.id
  entryTextDraft.value = entry.text
  entryNoteDraft.value = entry.note
}

function cancelEntry() {
  editingEntryId.value = null
}

function saveEntry(entry: Entry) {
  const text = entryTextDraft.value.trim()
  if (!text) return
  const patch: { text?: string; note?: string } = {}
  if (text !== entry.text) patch.text = text
  if (entryNoteDraft.value.trim() !== entry.note) patch.note = entryNoteDraft.value
  if (
    (patch.text === undefined && patch.note === undefined) ||
    threadStore.updateEntry(entry.id, patch)
  )
    editingEntryId.value = null
}

function onEntryTextKeydown(e: KeyboardEvent, entry: Entry) {
  /* 한글 조합 중의 Enter 는 글자를 맺는 키다 */
  if (e.isComposing) return
  if (e.key === 'Enter') {
    /* 요약은 한 줄이다 — Enter 는 저장이 아니라 메모로 넘어간다. 저장은 ⌘/Ctrl+Enter */
    e.preventDefault()
    if (e.metaKey || e.ctrlKey) saveEntry(entry)
    else entryNoteField?.focus()
  } else if (e.key === 'Escape') {
    /* 팝업까지 닫히지 않게 여기서 멈춘다 */
    e.stopPropagation()
    e.preventDefault()
    cancelEntry()
  }
}

function onEntryNoteKeydown(e: KeyboardEvent, entry: Entry) {
  if (e.isComposing) return
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    saveEntry(entry)
  } else if (e.key === 'Escape') {
    e.stopPropagation()
    e.preventDefault()
    cancelEntry()
  }
}

/* 다른 안건으로 옮기거나 팝업을 다시 열면 칸들을 그 안건의 값으로 채운다 */
watch(
  [() => props.threadId, open],
  () => {
    fill()
    cancelEntry()
    deleteTarget.value = null
  },
  { immediate: true },
)

/* 바뀐 것이 있을 때만 보낸다 — 칸을 지나가기만 해도 저장 요청이 나가지 않게 */
function commit(field: 'title' | 'description' | 'options') {
  const t = detail.value?.thread
  if (!t) return
  /* 잠긴 칸은 readonly 라 바뀔 일이 없지만, 혹시 바뀌었어도 보내지 않고 되돌린다 */
  if (!canEdit.value) {
    fill(field)
    return
  }
  if (field === 'title') {
    /* 비우면 원래 제목으로 돌아간다 — 스토어도 빈 제목은 받지 않는다 */
    if (titleDraft.value.trim() && titleDraft.value.trim() !== t.title)
      threadStore.updateThread(t.id, { title: titleDraft.value })
  } else if (field === 'description') {
    if (descriptionDraft.value.trim() !== t.description)
      threadStore.updateThread(t.id, { description: descriptionDraft.value })
  } else {
    const next = optionsDraft.value.split('\n')
    const clean = next.map((o) => o.trim()).filter(Boolean)
    if (clean.join('\n') !== t.options.join('\n')) threadStore.updateThread(t.id, { options: next })
  }
  /* 저장된 모양(앞뒤 공백 · 빈 줄이 빠진 것)으로 칸을 다시 채운다 */
  fill(field)
}

function setDueDate(value: string) {
  const t = detail.value?.thread
  if (t && canEdit.value && (value || null) !== t.dueDate)
    threadStore.updateThread(t.id, { dueDate: value || null })
}

function setOwner(value: string | null) {
  const t = detail.value?.thread
  if (t && canEdit.value && value !== t.ownerId) threadStore.updateThread(t.id, { ownerId: value })
}

/* 참조는 통째로 바꾼다 — 칩 하나를 더하거나 빼도 목록 전체를 보낸다 */
function setCc(value: string[]) {
  const t = detail.value?.thread
  if (t && canEdit.value && value.join() !== t.ccIds.join())
    threadStore.updateThread(t.id, { ccIds: value })
}

function setPart(value: string | null) {
  const t = detail.value?.thread
  if (t && canEdit.value && value !== t.partId) threadStore.updateThread(t.id, { partId: value })
}

/* 지우기 — 확인을 받고 지운다. 떼어낸 하위 안건이 있으면 못 지운다(서버 409 THREAD_HAS_CHILDREN).
   그사이 다른 사람이 하위를 떼어 409 가 오면 이유를 띄우고 스냅샷을 다시 받아 하위를 보인다 */
const hasChildren = computed(() => (detail.value?.subThreads.length ?? 0) > 0)

function askDelete(target: DeleteTarget) {
  deleteError.value = ''
  deleteTarget.value = target
}

const confirmTitle = computed(() => {
  const target = deleteTarget.value
  if (!target) return ''
  return target.kind === 'thread'
    ? `'${detail.value?.thread.title ?? ''}' 안건을 지울까요?`
    : `이 ${ENTRY_KIND_LABEL[target.entry.kind]} 줄을 지울까요?`
})

const confirmDescription = computed(() =>
  deleteTarget.value?.kind === 'entry'
    ? '남은 줄로 안건 상태를 다시 잽니다. 되돌릴 수 없습니다.'
    : '이력 · 작업 연결 · 확인 요청도 함께 지워지고 되돌릴 수 없습니다.',
)

async function removeTarget() {
  const target = deleteTarget.value
  const thread = detail.value?.thread
  if (!target || !thread || deleting.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    if (target.kind === 'thread') {
      await threadStore.deleteThread(thread.id)
      deleteTarget.value = null
      open.value = false
    } else {
      await threadStore.deleteEntry(target.entry.id)
      if (editingEntryId.value === target.entry.id) cancelEntry()
      deleteTarget.value = null
    }
  } catch (e) {
    if (e instanceof ApiError && e.code === 'THREAD_HAS_CHILDREN') {
      deleteError.value = e.message
      void data.reloadSnapshot()
    } else {
      deleteTarget.value = null
      toastError(e)
    }
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <!-- 열자마자 제목 칸에 커서가 서면 고치는 중처럼 보인다 — 처음 포커스는 주지 않는다 -->
    <DialogScrollContent v-if="detail" class="max-w-[1100px] gap-0 p-0" @open-auto-focus.prevent>
      <div class="flex items-center gap-2 border-b border-border px-[22px] py-3.5 pr-[60px]">
        <FolderClosed class="size-3.5 text-muted-foreground" />
        <span class="text-xs text-muted-foreground">{{ data.currentProject?.name }}</span>
        <ChevronRight class="size-3 text-muted-foreground" />
        <span class="text-xs">안건</span>
        <span class="grow" />
        <span v-if="canEdit" class="text-xs text-muted-foreground">고치면 바로 저장됩니다</span>
        <span
          v-else
          class="flex items-center gap-1.5 text-xs text-muted-foreground"
          data-thread-readonly
        >
          <Lock class="size-3" />
          {{ READONLY_HINT }}
        </span>
      </div>

      <div class="flex items-stretch">
        <div class="flex min-w-0 grow flex-col gap-8 px-[22px] pt-4 pb-6">
          <ThreadFields
            v-model:title="titleDraft"
            v-model:description="descriptionDraft"
            v-model:options="optionsDraft"
            live
            :readonly="!canEdit"
            @commit="commit"
            @revert="fill"
          >
            <template #under-title>
              <DialogTitle class="sr-only">{{ detail.thread.title }}</DialogTitle>
              <div class="flex flex-wrap items-center gap-2">
                <DialogDescription class="text-xs text-muted-foreground">
                  {{ monthDay(detail.thread.createdAt) }} 등록 · 이력 {{ detail.events.length }}건
                </DialogDescription>
                <MinutesSourceChip
                  v-if="detail.thread.minutesId"
                  :minutes-id="detail.thread.minutesId"
                />
              </div>
            </template>

            <ThreadDecisionPanel
              :detail="detail"
              :can-edit-thread="canEdit"
              @open-thread="(id) => emit('open-thread', id)"
            />
          </ThreadFields>

          <CheckRequestSection :thread-id="detail.thread.id" />

          <section class="flex flex-col gap-3.5">
            <div class="flex items-baseline gap-2">
              <span class="text-xs font-medium">이력</span>
              <span class="text-xs text-muted-foreground">{{ detail.events.length }}건</span>
              <span class="grow" />
              <span class="text-xs text-muted-foreground"
                >새 줄이 위로 · 남긴 사람 · 작성자 · 담당자 · 관리자가 고치거나 지울 수
                있습니다</span
              >
            </div>

            <p v-if="detail.events.length === 0" class="text-xs text-muted-foreground">
              아직 남긴 기록이 없습니다.
            </p>

            <div v-else class="flex flex-col">
              <div v-for="e in detail.events" :key="e.entry.id" class="group flex gap-4">
                <div class="w-[74px] shrink-0 pt-0.5 text-right text-xs font-medium">
                  {{ monthDay(e.at) }}
                </div>
                <div class="w-px shrink-0 bg-border" />
                <div class="flex min-w-0 grow flex-col gap-2 pb-[22px]">
                  <div class="flex flex-wrap items-center gap-2">
                    <EntryKindBadge :kind="e.entry.kind" />
                    <PersonChip v-if="e.ownerName" :name="e.ownerName" />
                    <span v-if="e.superseded" class="text-xs text-muted-foreground"
                      >뒤의 결정으로 바뀜</span
                    >
                    <MinutesSourceChip v-if="e.entry.minutesId" :minutes-id="e.entry.minutesId" />
                    <span class="grow" />
                    <template
                      v-if="editingEntryId !== e.entry.id && threadStore.canEditEntry(e.entry)"
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        class="h-6 gap-1 px-1.5 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label="이력 고치기"
                        @click="editEntry(e.entry)"
                      >
                        <Pencil class="size-3" />
                        고치기
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        class="h-6 gap-1 px-1.5 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                        aria-label="이력 지우기"
                        @click="askDelete({ kind: 'entry', entry: e.entry })"
                      >
                        <Trash2 class="size-3" />
                        지우기
                      </Button>
                    </template>
                  </div>

                  <div
                    v-if="editingEntryId === e.entry.id"
                    class="flex flex-col gap-2"
                    data-entry-editor
                  >
                    <Input
                      v-model="entryTextDraft"
                      aria-label="이력 요약"
                      class="text-sm"
                      @keydown="onEntryTextKeydown($event, e.entry)"
                    />
                    <Textarea
                      :ref="setEntryNoteField"
                      v-model="entryNoteDraft"
                      aria-label="이력 메모"
                      placeholder="왜 그렇게 됐는지 (비워도 됩니다)"
                      class="[field-sizing:content]"
                      @keydown="onEntryNoteKeydown($event, e.entry)"
                    />
                    <div class="flex items-center gap-2">
                      <span class="grow text-xs text-muted-foreground"
                        >⌘/Ctrl+Enter 저장 · Esc 취소 · 종류는 바뀌지 않습니다</span
                      >
                      <Button variant="outline" size="sm" @click="cancelEntry">취소</Button>
                      <Button
                        size="sm"
                        :disabled="!entryTextDraft.trim()"
                        @click="saveEntry(e.entry)"
                        >저장</Button
                      >
                    </div>
                  </div>

                  <template v-else>
                    <p
                      class="text-sm leading-relaxed text-pretty"
                      :class="e.superseded ? 'text-muted-foreground line-through' : ''"
                    >
                      {{ e.entry.text }}
                    </p>

                    <div
                      v-if="e.entry.detail.length"
                      class="flex flex-col gap-1 border-l-2 border-border pl-3"
                    >
                      <p
                        v-for="(line, i) in e.entry.detail"
                        :key="i"
                        class="text-[13px] leading-relaxed text-muted-foreground text-pretty"
                      >
                        {{ line }}
                      </p>
                    </div>

                    <p
                      v-if="e.entry.note"
                      class="text-xs leading-relaxed whitespace-pre-line text-muted-foreground text-pretty"
                    >
                      {{ e.entry.note }}
                    </p>
                  </template>
                </div>
              </div>
            </div>
          </section>

          <HistorySection kind="thread" :target-id="detail.thread.id" />
        </div>

        <ThreadPropertyPanel
          :due-date="detail.thread.dueDate ?? ''"
          :owner-id="detail.thread.ownerId"
          :part-id="detail.thread.partId"
          :cc-ids="detail.thread.ccIds"
          :overdue="detail.overdue"
          :readonly="!canEdit"
          @update:due-date="setDueDate"
          @update:owner-id="setOwner"
          @update:part-id="setPart"
          @update:cc-ids="setCc"
        >
          <template #top>
            <div class="flex items-center gap-2">
              <ThreadStateBadge :state="detail.thread.state" :defer-count="detail.deferCount" />
              <span class="text-xs text-muted-foreground">상태는 결정 · 미루기로 바뀝니다</span>
            </div>
          </template>

          <div class="h-px bg-border" />
          <dl class="flex flex-col gap-2 px-0.5 text-xs">
            <div class="flex gap-2">
              <dt class="w-[72px] shrink-0 text-muted-foreground">미룬 횟수</dt>
              <dd :class="detail.deferCount >= 3 ? 'font-medium text-destructive' : ''">
                {{ detail.deferCount }}번
              </dd>
            </div>
            <div class="flex gap-2">
              <dt class="w-[72px] shrink-0 text-muted-foreground">작성자</dt>
              <dd data-thread-creator>{{ data.memberName(detail.thread.creatorId) ?? '—' }}</dd>
            </div>
            <div class="flex gap-2">
              <dt class="w-[72px] shrink-0 text-muted-foreground">만든 날짜</dt>
              <dd>{{ monthDay(detail.thread.createdAt) }}</dd>
            </div>
          </dl>
          <template v-if="canDelete">
            <div class="grow" />
            <div class="flex flex-col gap-1">
              <Button
                variant="ghost"
                size="sm"
                class="self-start text-destructive hover:text-destructive"
                :disabled="hasChildren"
                data-thread-delete
                @click="askDelete({ kind: 'thread' })"
              >
                <Trash2 class="size-3.5" />
                안건 지우기
              </Button>
              <p v-if="hasChildren" class="px-0.5 text-xs text-muted-foreground" data-delete-reason>
                하위 안건이 있어 지울 수 없습니다. 하위 안건을 먼저 지워 주세요.
              </p>
            </div>
          </template>
        </ThreadPropertyPanel>
      </div>

      <Dialog v-model:open="confirmOpen">
        <DialogContent class="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle class="text-pretty">{{ confirmTitle }}</DialogTitle>
            <DialogDescription class="text-pretty">{{ confirmDescription }}</DialogDescription>
          </DialogHeader>
          <p v-if="deleteError" class="text-sm text-destructive" data-delete-error>
            {{ deleteError }}
          </p>
          <DialogFooter>
            <Button variant="outline" @click="confirmOpen = false">취소</Button>
            <Button
              variant="destructive"
              :disabled="deleting"
              data-delete-confirm
              @click="removeTarget"
            >
              <Loader2 v-if="deleting" class="animate-spin" />
              지우기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DialogScrollContent>
  </Dialog>
</template>
