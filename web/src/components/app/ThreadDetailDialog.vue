<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, FolderClosed } from 'lucide-vue-next'
import EntryKindBadge from '@/components/app/EntryKindBadge.vue'
import PersonChip from '@/components/app/PersonChip.vue'
import ThreadDecisionPanel from '@/components/app/ThreadDecisionPanel.vue'
import ThreadFields from '@/components/app/ThreadFields.vue'
import ThreadPropertyPanel from '@/components/app/ThreadPropertyPanel.vue'
import ThreadStateBadge from '@/components/app/ThreadStateBadge.vue'
import { Dialog, DialogDescription, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { monthDay } from '@/lib/date'
import { useDataStore } from '@/stores/data'
import { useThreadStore } from '@/stores/thread'

/* 안건 상세 — 목록 위 팝업. 작업 상세처럼 보는 자리가 곧 고치는 자리다: 칸을 고치고 벗어나면
   그 값만 바로 들어가고 따로 저장 버튼이 없다. 칸 모양은 안건 추가와 같다(ThreadFields · ThreadPropertyPanel).
   상태만은 칸으로 못 바꾼다 — 결정 영역에서 남긴 줄로만 바뀐다. */
const props = defineProps<{ threadId: string | null }>()
const open = defineModel<boolean>('open', { required: true })
/* 하위 안건을 누르면 그 안건으로 갈아탄다 — 목록을 거치지 않는다 */
const emit = defineEmits<{ (e: 'open-thread', id: string): void }>()

const data = useDataStore()
const threadStore = useThreadStore()
const detail = computed(() => (props.threadId ? threadStore.threadDetail(props.threadId) : null))

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

/* 다른 안건으로 옮기거나 팝업을 다시 열면 칸들을 그 안건의 값으로 채운다 */
watch([() => props.threadId, open], () => fill(), { immediate: true })

/* 바뀐 것이 있을 때만 보낸다 — 칸을 지나가기만 해도 저장 요청이 나가지 않게 */
function commit(field: 'title' | 'description' | 'options') {
  const t = detail.value?.thread
  if (!t) return
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
  if (t && (value || null) !== t.dueDate) threadStore.updateThread(t.id, { dueDate: value || null })
}

function setOwner(value: string | null) {
  const t = detail.value?.thread
  if (t && value !== t.ownerId) threadStore.updateThread(t.id, { ownerId: value })
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
        <span class="text-xs text-muted-foreground">고치면 바로 저장됩니다</span>
      </div>

      <div class="flex items-stretch">
        <div class="flex min-w-0 grow flex-col gap-8 px-[22px] pt-4 pb-6">
          <ThreadFields
            v-model:title="titleDraft"
            v-model:description="descriptionDraft"
            v-model:options="optionsDraft"
            live
            @commit="commit"
            @revert="fill"
          >
            <template #under-title>
              <DialogTitle class="sr-only">{{ detail.thread.title }}</DialogTitle>
              <DialogDescription class="text-xs text-muted-foreground">
                {{ monthDay(detail.thread.createdAt) }} 등록 · 이력 {{ detail.events.length }}건
              </DialogDescription>
            </template>

            <ThreadDecisionPanel :detail="detail" @open-thread="(id) => emit('open-thread', id)" />
          </ThreadFields>

          <section class="flex flex-col gap-3.5">
            <div class="flex items-baseline gap-2">
              <span class="text-xs font-medium">이력</span>
              <span class="text-xs text-muted-foreground">{{ detail.events.length }}건</span>
              <span class="grow" />
              <span class="text-xs text-muted-foreground"
                >새 줄이 위로 · 지운 줄 없이 쌓입니다</span
              >
            </div>

            <p v-if="detail.events.length === 0" class="text-xs text-muted-foreground">
              아직 남긴 기록이 없습니다.
            </p>

            <div v-else class="flex flex-col">
              <div v-for="e in detail.events" :key="e.entry.id" class="flex gap-4">
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
                  </div>

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
                    class="text-xs leading-relaxed text-muted-foreground text-pretty"
                  >
                    {{ e.entry.note }}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>

        <ThreadPropertyPanel
          :due-date="detail.thread.dueDate ?? ''"
          :owner-id="detail.thread.ownerId"
          :overdue="detail.overdue"
          @update:due-date="setDueDate"
          @update:owner-id="setOwner"
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
              <dt class="w-[72px] shrink-0 text-muted-foreground">만든 날짜</dt>
              <dd>{{ monthDay(detail.thread.createdAt) }}</dd>
            </div>
          </dl>
        </ThreadPropertyPanel>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
