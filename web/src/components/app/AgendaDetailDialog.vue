<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, FolderClosed, Loader2, Lock, Trash2 } from 'lucide-vue-next'
import CheckRequestSection from '@/components/app/CheckRequestSection.vue'
import HistorySection from '@/components/app/HistorySection.vue'
import { isCheckRequestOn } from '@/lib/features'
import MinutesSourceChip from '@/components/app/MinutesSourceChip.vue'
import AgendaFields, { type AgendaTextField } from '@/components/app/AgendaFields.vue'
import AgendaPropertyPanel from '@/components/app/AgendaPropertyPanel.vue'
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
import { kstToday, monthDay } from '@/lib/date'
import { toastError } from '@/lib/notify'
import { READONLY_HINT } from '@/lib/task'
import { isOverdue, useAgendaStore } from '@/stores/agenda'
import { useDataStore } from '@/stores/data'
import type { AgendaState } from '@/types/domain'

/* 안건 상세 — 목록 위 팝업. 작업 상세처럼 보는 자리가 곧 고치는 자리다: 칸을 고치고 벗어나면
   그 값만 바로 들어가고 따로 저장 버튼이 없다. 왼쪽은 제목 · 설명 · 결정내용, 오른쪽은 상태 · 기한 · 담당자 · 파트.
   상태도 사람이 고른다. 고치기 · 지우기는 작성자 · 담당자 · 관리자만 — 아니면 칸을 잠그고 보기만 한다 */
const props = defineProps<{ agendaId: string | null }>()

/* 확인 요청은 화면에서 잠시 숨겼다(src/lib/features.ts) */
const checkRequestOn = isCheckRequestOn()
const open = defineModel<boolean>('open', { required: true })

const data = useDataStore()
const agendaStore = useAgendaStore()
const agenda = computed(() =>
  props.agendaId ? (data.allAgendas.find((t) => t.id === props.agendaId) ?? null) : null,
)
const overdue = computed(() => (agenda.value ? isOverdue(agenda.value, kstToday()) : false))
const canEdit = computed(() => (agenda.value ? agendaStore.canEdit(agenda.value) : false))
const canDelete = computed(() => (agenda.value ? agendaStore.canDelete(agenda.value) : false))

const confirmOpen = ref(false)
const deleting = ref(false)

/* 글 칸은 고치는 동안 여기서 들고 있다가 칸을 벗어날 때 넣는다 */
const titleDraft = ref('')
const descriptionDraft = ref('')
const decisionDraft = ref('')

function fill(field?: AgendaTextField) {
  const t = agenda.value
  if (!field || field === 'title') titleDraft.value = t?.title ?? ''
  if (!field || field === 'description') descriptionDraft.value = t?.description ?? ''
  if (!field || field === 'decision') decisionDraft.value = t?.decision ?? ''
}

/* 다른 안건으로 옮기거나 팝업을 다시 열면 칸들을 그 안건의 값으로 채운다 */
watch(
  [() => props.agendaId, open],
  () => {
    fill()
    confirmOpen.value = false
  },
  { immediate: true },
)

/* 바뀐 것이 있을 때만 보낸다 — 칸을 지나가기만 해도 저장 요청이 나가지 않게 */
function commit(field: AgendaTextField) {
  const t = agenda.value
  if (!t) return
  /* 잠긴 칸은 readonly 라 바뀔 일이 없지만, 혹시 바뀌었어도 보내지 않고 되돌린다 */
  if (!canEdit.value) {
    fill(field)
    return
  }
  if (field === 'title') {
    /* 비우면 원래 제목으로 돌아간다 — 스토어도 빈 제목은 받지 않는다 */
    if (titleDraft.value.trim() && titleDraft.value.trim() !== t.title)
      agendaStore.updateAgenda(t.id, { title: titleDraft.value })
  } else if (field === 'description') {
    if (descriptionDraft.value.trim() !== t.description)
      agendaStore.updateAgenda(t.id, { description: descriptionDraft.value })
  } else if (decisionDraft.value.trim() !== t.decision) {
    agendaStore.updateAgenda(t.id, { decision: decisionDraft.value })
  }
  /* 저장된 모양(앞뒤 공백이 빠진 것)으로 칸을 다시 채운다 */
  fill(field)
}

function setState(value: AgendaState) {
  const t = agenda.value
  if (t && canEdit.value && value !== t.state) agendaStore.updateAgenda(t.id, { state: value })
}

function setDueDate(value: string) {
  const t = agenda.value
  if (t && canEdit.value && (value || null) !== t.dueDate)
    agendaStore.updateAgenda(t.id, { dueDate: value || null })
}

function setOwner(value: string | null) {
  const t = agenda.value
  if (t && canEdit.value && value !== t.ownerId) agendaStore.updateAgenda(t.id, { ownerId: value })
}

/* 참조는 통째로 갈아끼운다 — 같은 사람 · 같은 순서면 보내지 않는다 */
function setCc(value: string[]) {
  const t = agenda.value
  if (t && canEdit.value && value.join() !== t.ccIds.join())
    agendaStore.updateAgenda(t.id, { ccIds: value })
}

function setPart(value: string | null) {
  const t = agenda.value
  if (t && canEdit.value && value !== t.partId) agendaStore.updateAgenda(t.id, { partId: value })
}

/* 지우기 — 확인을 받고 지운다 */
async function remove() {
  const t = agenda.value
  if (!t || deleting.value) return
  deleting.value = true
  try {
    await agendaStore.deleteAgenda(t.id)
    confirmOpen.value = false
    open.value = false
  } catch (e) {
    confirmOpen.value = false
    toastError(e)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <!-- 열자마자 제목 칸에 커서가 서면 고치는 중처럼 보인다 — 처음 포커스는 주지 않는다 -->
    <DialogScrollContent v-if="agenda" class="max-w-[1100px] gap-0 p-0" @open-auto-focus.prevent>
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
          data-agenda-readonly
        >
          <Lock class="size-3" />
          {{ READONLY_HINT }}
        </span>
      </div>

      <div class="flex items-stretch">
        <div class="flex min-w-0 grow flex-col gap-8 px-[22px] pt-4 pb-6">
          <AgendaFields
            v-model:title="titleDraft"
            v-model:description="descriptionDraft"
            v-model:decision="decisionDraft"
            live
            :readonly="!canEdit"
            @commit="commit"
            @revert="fill"
          >
            <template #under-title>
              <DialogTitle class="sr-only">{{ agenda.title }}</DialogTitle>
              <div class="flex flex-wrap items-center gap-2">
                <DialogDescription class="text-xs text-muted-foreground">
                  {{ monthDay(agenda.createdAt) }} 등록<template v-if="agenda.decidedAt">
                    · {{ monthDay(agenda.decidedAt) }}에 정해짐</template
                  >
                </DialogDescription>
                <MinutesSourceChip v-if="agenda.minutesId" :minutes-id="agenda.minutesId" />
              </div>
            </template>
          </AgendaFields>

          <CheckRequestSection
            v-if="checkRequestOn && agenda.state === 'decided'"
            :agenda-id="agenda.id"
          />

          <HistorySection kind="agenda" :target-id="agenda.id" />
        </div>

        <AgendaPropertyPanel
          :state="agenda.state"
          :due-date="agenda.dueDate ?? ''"
          :owner-id="agenda.ownerId"
          :cc-ids="agenda.ccIds"
          :part-id="agenda.partId"
          :overdue="overdue"
          :readonly="!canEdit"
          @update:state="setState"
          @update:due-date="setDueDate"
          @update:owner-id="setOwner"
          @update:cc-ids="setCc"
          @update:part-id="setPart"
        >
          <div class="h-px bg-border" />
          <dl class="flex flex-col gap-2 px-0.5 text-xs">
            <div class="flex gap-2">
              <dt class="w-[72px] shrink-0 text-muted-foreground">작성자</dt>
              <dd data-agenda-creator>{{ data.memberName(agenda.creatorId) ?? '—' }}</dd>
            </div>
            <div class="flex gap-2">
              <dt class="w-[72px] shrink-0 text-muted-foreground">만든 날짜</dt>
              <dd>{{ monthDay(agenda.createdAt) }}</dd>
            </div>
            <div v-if="agenda.decidedAt" class="flex gap-2">
              <dt class="w-[72px] shrink-0 text-muted-foreground">정한 날짜</dt>
              <dd data-agenda-decided-at>{{ monthDay(agenda.decidedAt) }}</dd>
            </div>
          </dl>
          <template v-if="canDelete">
            <div class="grow" />
            <Button
              variant="ghost"
              size="sm"
              class="self-start text-destructive hover:text-destructive"
              data-agenda-delete
              @click="confirmOpen = true"
            >
              <Trash2 class="size-3.5" />
              안건 지우기
            </Button>
          </template>
        </AgendaPropertyPanel>
      </div>

      <Dialog v-model:open="confirmOpen">
        <DialogContent class="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle class="text-pretty">'{{ agenda.title }}' 안건을 지울까요?</DialogTitle>
            <DialogDescription class="text-pretty"
              >작업 연결 · 확인 요청도 함께 지워지고 되돌릴 수 없습니다.</DialogDescription
            >
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" @click="confirmOpen = false">취소</Button>
            <Button variant="destructive" :disabled="deleting" data-delete-confirm @click="remove">
              <Loader2 v-if="deleting" class="animate-spin" />
              지우기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DialogScrollContent>
  </Dialog>
</template>
