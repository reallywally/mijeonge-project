<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Check, ChevronRight, Clock, Loader2, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import DecisionEntryForm, { type DecisionEntryDraft } from '@/components/app/DecisionEntryForm.vue'
import PersonChip from '@/components/app/PersonChip.vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toastError } from '@/lib/notify'
import { ITEM_TITLE_MAX } from '@/lib/thread'
import { useThreadStore } from '@/stores/thread'
import type { DecisionItem, ThreadDetail } from '@/types/domain'

/* 안건 상세의 '결정' 영역 — 이 앱이 하려는 일이 여기 모인다. 안건 안에서 따로 정할 것(결정 항목)마다
   결정 · 미룸 · 세부 추가를 남기고, 항목이 전부 정해져야 안건이 결정됨이 된다.
   상태는 손으로 바꾸지 않고 여기서 남긴 줄로만 바뀐다. 결정을 바꾸면 그 항목 안에서만 앞의 것을 대체한다.
   항목이 없는 안건은 예전처럼 결정인지 미루기인지 먼저 고르고, 결정이면 항목 이름(안건 제목)도 같이 받는다.
   줄 남기기 · 항목 더하기는 프로젝트 멤버 누구나다. 항목 이름 바꾸기 · 지우기는 줄 고치기와 같은 경계,
   '다시 볼 날' 은 안건 기한을 고치는 일이라 고칠 권한이 있을 때만 보인다 */
const props = defineProps<{ detail: ThreadDetail; canEditThread?: boolean }>()
const emit = defineEmits<{ (e: 'open-thread', id: string): void }>()

const threadStore = useThreadStore()

type Mode = 'decide' | 'defer' | 'refine'
/**
 * 지금 열린 남기는 칸. place 'item' 은 그 항목 줄 아래, 'free' 는 항목 목록 아래 한 자리 —
 * 안건 전체 미루기와 항목 없는 안건의 첫 결정이 쓴다. 새 항목을 만드는 중에 목록 모양이 바뀌어도
 * 칸이 같은 자리에 남아 적은 것을 잃지 않게 자리를 열 때 정해 둔다
 */
interface OpenForm {
  place: 'item' | 'free'
  mode: Mode
  /** null 이면 새 항목(결정 · 세부) 또는 안건 전체(미룸) */
  itemId: string | null
  /** 항목 없는 안건의 '결정 / 미루기' 갈림길에서 열었나 */
  fromChoice: boolean
}
const form = ref<OpenForm | null>(null)
const saving = ref(false)

/* 항목 더하기 · 이름 바꾸기 */
const adding = ref(false)
const newTitle = ref('')
const addInput = ref<InstanceType<typeof Input> | null>(null)
const renamingId = ref<string | null>(null)
const renameDraft = ref('')
const renameInput = ref<InstanceType<typeof Input>[] | null>(null)

const items = computed(() => props.detail.items)
const hasItems = computed(() => items.value.length > 0)
/* 항목 없는 안건의 첫 갈림길 — 아무것도 안 열었거나 거기서 열었을 때 선다 */
const showChoice = computed(() =>
  form.value ? form.value.fromChoice : !hasItems.value && !adding.value,
)

/* 지우기 확인 */
const deleteTarget = ref<DecisionItem | null>(null)
const confirmOpen = computed({
  get: () => deleteTarget.value !== null,
  set: (v: boolean) => {
    if (!v) deleteTarget.value = null
  },
})
const deleting = ref(false)

function reset() {
  form.value = null
  adding.value = false
  newTitle.value = ''
  renamingId.value = null
  deleteTarget.value = null
}

/* 다른 안건으로 옮기면 칸을 처음 모양으로 */
watch(() => props.detail.thread.id, reset, { immediate: true })

function open(next: OpenForm) {
  adding.value = false
  form.value = next
}

/* 항목 없는 안건의 첫 갈림길 — 둘 중 하나를 고르면 그쪽 칸이 열린다 */
const CHOICES = [
  { mode: 'decide', label: '결정', hint: '무엇으로 정했는지 남깁니다', icon: Check },
  { mode: 'defer', label: '미루기', hint: '못 정한 사유를 남깁니다', icon: Clock },
] as const

function choose(mode: Mode) {
  open({ place: 'free', mode, itemId: null, fromChoice: true })
}

const openFor = (itemId: string, mode: Mode) =>
  open({ place: 'item', mode, itemId, fromChoice: false })
const isOpenOn = (itemId: string) => form.value?.place === 'item' && form.value.itemId === itemId

/** 새 항목의 이름 칸에 미리 채울 값 — 항목을 만들 때만 */
const newItemTitle = computed(() =>
  form.value && form.value.itemId === null && form.value.mode !== 'defer'
    ? props.detail.thread.title
    : null,
)

async function submit(draft: DecisionEntryDraft) {
  const f = form.value
  if (!f || saving.value) return
  const threadId = props.detail.thread.id
  saving.value = true
  try {
    /* 항목이 없으면 먼저 만든다. 줄 남기기가 실패해도 다시 누르면 만든 항목에 남는다 */
    if (f.itemId === null && f.mode !== 'defer') {
      const made = await threadStore.addItem(threadId, draft.itemTitle)
      if (!made) return
      f.itemId = made
    }
    const saved = await threadStore.addEntry(
      threadId,
      f.mode,
      draft.text,
      draft.note,
      draft.ownerId,
      f.itemId,
    )
    /* 실패는 스토어가 알렸다 — 적은 것을 그대로 두어 다시 남길 수 있게 한다 */
    if (!saved) return
    /* 다시 볼 날은 줄이 남은 뒤에 안건 기한으로 옮긴다 — 줄 없이 기한만 바뀌면 왜 바뀌었는지가 사라진다 */
    if (f.mode === 'defer' && f.itemId === null && draft.nextDue && props.canEditThread)
      threadStore.updateThread(threadId, { dueDate: draft.nextDue })
    form.value = null
  } finally {
    saving.value = false
  }
}

async function startAdding() {
  form.value = null
  adding.value = true
  newTitle.value = ''
  await nextTick()
  ;(addInput.value?.$el as HTMLInputElement | undefined)?.focus()
}

async function addItem() {
  const title = newTitle.value.trim()
  if (!title || saving.value) return
  saving.value = true
  const made = await threadStore.addItem(props.detail.thread.id, title)
  saving.value = false
  if (!made) return
  adding.value = false
  newTitle.value = ''
}

function onAddKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'Enter') {
    e.preventDefault()
    addItem()
  } else if (e.key === 'Escape') {
    /* 팝업까지 닫히지 않게 여기서 멈춘다 */
    e.stopPropagation()
    e.preventDefault()
    adding.value = false
  }
}

async function startRename(item: DecisionItem) {
  renamingId.value = item.id
  renameDraft.value = item.title
  await nextTick()
  ;(renameInput.value?.[0]?.$el as HTMLInputElement | undefined)?.focus()
}

/* 비우면 원래 이름으로 돌아간다 — 스토어도 빈 이름은 받지 않는다 */
function commitRename() {
  const id = renamingId.value
  if (!id) return
  renamingId.value = null
  if (renameDraft.value.trim()) threadStore.renameItem(id, renameDraft.value)
}

function onRenameKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'Enter') {
    e.preventDefault()
    commitRename()
  } else if (e.key === 'Escape') {
    e.stopPropagation()
    e.preventDefault()
    renamingId.value = null
  }
}

async function removeItem() {
  const target = deleteTarget.value
  if (!target || deleting.value) return
  deleting.value = true
  try {
    await threadStore.deleteItem(target.id)
    if (form.value?.itemId === target.id) form.value = null
    deleteTarget.value = null
  } catch (e) {
    deleteTarget.value = null
    toastError(e)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <section
    class="flex flex-col gap-4 rounded-lg border bg-card px-5 py-[18px] shadow-sm"
    :class="detail.settled ? 'border-border' : 'border-primary/40'"
    aria-label="결정"
  >
    <div class="flex items-center gap-2">
      <span class="text-xs font-medium tracking-wider text-muted-foreground">결정</span>
      <span v-if="hasItems" class="text-xs text-muted-foreground" data-decision-progress>
        {{ detail.settledCount }}/{{ items.length }} 정함
      </span>
      <span class="grow" />
      <span v-if="!detail.settled && detail.deferCount > 0" class="text-xs text-muted-foreground">
        지금까지 {{ detail.deferCount }}번 미뤄졌습니다
      </span>
    </div>

    <!-- 항목마다 — 정한 것은 무엇을 · 왜 · 언제가 크게, 아직인 것은 결정 · 미루기 -->
    <ul v-if="hasItems" class="flex flex-col gap-4" aria-label="결정 항목">
      <li
        v-for="v in items"
        :key="v.item.id"
        class="group flex flex-col gap-2.5"
        :data-decision-item="v.item.id"
      >
        <div class="flex items-start gap-3">
          <span
            v-if="v.settled"
            class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary"
            aria-label="정함"
          >
            <Check class="size-3 text-primary-foreground" />
          </span>
          <span
            v-else
            class="mt-0.5 size-5 shrink-0 rounded-full border-2 border-muted-foreground/40"
            aria-label="아직"
          />

          <div class="flex min-w-0 grow flex-col gap-0.5">
            <div class="flex min-h-6 flex-wrap items-center gap-2">
              <Input
                v-if="renamingId === v.item.id"
                ref="renameInput"
                v-model="renameDraft"
                aria-label="항목 이름"
                :maxlength="ITEM_TITLE_MAX"
                class="h-7 max-w-[360px] text-sm"
                @keydown="onRenameKeydown"
                @blur="commitRename"
              />
              <span
                v-else
                class="min-w-0 text-pretty"
                :class="
                  v.settled ? 'text-xs text-muted-foreground' : 'text-sm leading-snug font-medium'
                "
                data-item-title
                >{{ v.item.title }}</span
              >
              <span v-if="v.deferCount > 0" class="text-xs text-muted-foreground">
                — 미룸 {{ v.deferCount }}회
              </span>
              <span class="grow" />
              <template v-if="threadStore.canEditItem(v.item) && renamingId !== v.item.id">
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 gap-1 px-1.5 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label="항목 이름 바꾸기"
                  @click="startRename(v.item)"
                >
                  <Pencil class="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 gap-1 px-1.5 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                  aria-label="항목 지우기"
                  @click="deleteTarget = v.item"
                >
                  <Trash2 class="size-3" />
                </Button>
              </template>
              <template v-if="!v.settled && !isOpenOn(v.item.id)">
                <Button variant="outline" size="sm" @click="openFor(v.item.id, 'decide')">
                  <Check class="size-3.5" />
                  결정
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-muted-foreground"
                  @click="openFor(v.item.id, 'defer')"
                >
                  <Clock class="size-3.5" />
                  미루기
                </Button>
              </template>
            </div>
            <p
              v-if="v.settled"
              class="leading-relaxed font-semibold text-pretty"
              :class="items.length === 1 ? 'text-lg' : 'text-base'"
            >
              {{ v.current }}
            </p>
          </div>
        </div>

        <template v-if="v.settled">
          <div
            v-if="v.detail.length"
            class="ml-8 flex flex-col gap-1.5 border-l-2 border-border pl-3.5"
          >
            <p v-for="(line, i) in v.detail" :key="i" class="text-sm leading-relaxed text-pretty">
              {{ line }}
            </p>
          </div>

          <p
            v-if="v.settledNote"
            class="ml-8 text-sm leading-relaxed whitespace-pre-line text-muted-foreground"
          >
            <span class="font-medium text-foreground">상세 설명</span> — {{ v.settledNote }}
          </p>

          <div class="ml-8 flex flex-wrap items-center gap-2">
            <PersonChip v-if="v.settledOwnerName" :name="v.settledOwnerName" />
            <span class="text-xs text-muted-foreground">{{ v.settledLabel }}</span>
            <template v-if="!isOpenOn(v.item.id)">
              <span class="grow" />
              <Button variant="outline" size="sm" @click="openFor(v.item.id, 'decide')">
                바꾸기
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="text-muted-foreground"
                @click="openFor(v.item.id, 'refine')"
              >
                <Plus class="size-3.5" />
                세부 추가
              </Button>
            </template>
          </div>
        </template>

        <DecisionEntryForm
          v-if="form && isOpenOn(v.item.id)"
          :key="form.mode"
          class="ml-8"
          :mode="form.mode"
          :options="detail.thread.options"
          framed
          :saving="saving"
          @submit="submit"
          @cancel="form = null"
        />
      </li>
    </ul>

    <!-- 항목 없는 안건 — 결정인지 미루기인지 먼저 고른다 -->
    <template v-if="showChoice">
      <p v-if="!form" class="text-sm leading-relaxed text-muted-foreground">
        아직 정해지지 않았습니다. 오늘 무엇을 남길지 고르세요.
      </p>
      <div
        v-if="form?.mode !== 'refine'"
        class="grid grid-cols-2 gap-2.5"
        role="radiogroup"
        aria-label="남길 것"
      >
        <button
          v-for="c in CHOICES"
          :key="c.mode"
          type="button"
          role="radio"
          :aria-checked="form?.mode === c.mode"
          class="flex items-start gap-3 rounded-md border px-3.5 py-3 text-left transition-colors"
          :class="
            form?.mode === c.mode
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card hover:bg-muted'
          "
          @click="form?.mode !== c.mode && choose(c.mode)"
        >
          <component :is="c.icon" class="mt-0.5 size-4 shrink-0" />
          <span class="flex flex-col gap-0.5">
            <span class="text-sm font-medium">{{ c.label }}</span>
            <span
              class="text-xs"
              :class="
                form?.mode === c.mode ? 'text-primary-foreground/80' : 'text-muted-foreground'
              "
            >
              {{ c.hint }}
            </span>
          </span>
        </button>
      </div>
      <button
        v-if="!form"
        type="button"
        class="self-end text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        @click="choose('refine')"
      >
        결정 없이 세부만 덧붙이기
      </button>
    </template>

    <!-- 목록 아래 한 자리 — 안건 전체 미루기 · 항목 없는 안건의 첫 결정 -->
    <DecisionEntryForm
      v-if="form && form.place === 'free'"
      :key="form.mode"
      :mode="form.mode"
      :options="detail.thread.options"
      :item-title="newItemTitle"
      :with-next-due="form.mode === 'defer' && form.itemId === null && canEditThread"
      :framed="!form.fromChoice"
      :saving="saving"
      @submit="submit"
      @cancel="form = null"
    />

    <div v-if="adding" class="flex flex-wrap items-center gap-2">
      <Input
        id="decision-item-new"
        ref="addInput"
        v-model="newTitle"
        aria-label="새 결정 항목"
        placeholder="무엇을 따로 정하나요 — 한 줄로"
        :maxlength="ITEM_TITLE_MAX"
        class="max-w-[360px] grow bg-background"
        @keydown="onAddKeydown"
      />
      <Button size="sm" :disabled="!newTitle.trim() || saving" @click="addItem">추가</Button>
      <Button variant="outline" size="sm" @click="adding = false">취소</Button>
    </div>
    <div v-else-if="form?.place !== 'free'" class="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" class="text-muted-foreground" @click="startAdding">
        <Plus class="size-3.5" />
        결정 항목 추가
      </Button>
      <span class="grow" />
      <template v-if="hasItems">
        <span v-if="detail.threadDeferCount > 0" class="text-xs text-muted-foreground">
          안건 전체 미룸 {{ detail.threadDeferCount }}회
        </span>
        <Button
          variant="ghost"
          size="sm"
          class="text-muted-foreground"
          @click="open({ place: 'free', mode: 'defer', itemId: null, fromChoice: false })"
        >
          <Clock class="size-3.5" />
          안건 전체 미루기
        </Button>
      </template>
    </div>

    <div v-if="detail.subThreads.length" class="flex flex-col gap-2">
      <div class="text-xs font-medium tracking-wider text-muted-foreground">
        따로 떼어낸 하위 안건
      </div>
      <button
        v-for="sub in detail.subThreads"
        :key="sub.thread.id"
        type="button"
        class="flex min-h-11 items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground"
        @click="emit('open-thread', sub.thread.id)"
      >
        <span
          class="size-1.5 shrink-0 rounded-full"
          :class="sub.thread.state === 'decided' ? 'bg-primary' : 'bg-muted-foreground'"
        />
        <span class="min-w-0 grow text-sm leading-snug text-pretty">{{ sub.thread.title }}</span>
        <span class="shrink-0 text-xs text-muted-foreground">{{ sub.splitAtLabel }}</span>
        <ChevronRight class="size-3 shrink-0 text-muted-foreground" />
      </button>
    </div>

    <Dialog v-model:open="confirmOpen">
      <DialogContent class="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle class="text-pretty">
            '{{ deleteTarget?.title ?? '' }}' 항목을 지울까요?
          </DialogTitle>
          <DialogDescription class="text-pretty">
            이 항목에 남긴 줄은 이력에 남지만 안건 상태를 셀 때는 빠집니다. 되돌릴 수 없습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="confirmOpen = false">취소</Button>
          <Button
            variant="destructive"
            :disabled="deleting"
            data-item-delete-confirm
            @click="removeItem"
          >
            <Loader2 v-if="deleting" class="animate-spin" />
            지우기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
</template>
