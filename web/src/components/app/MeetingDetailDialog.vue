<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight, FolderClosed } from 'lucide-vue-next'
import EntryKindBadge from '@/components/app/EntryKindBadge.vue'
import PersonChip from '@/components/app/PersonChip.vue'
import ThreadStateBadge from '@/components/app/ThreadStateBadge.vue'
import { Dialog, DialogDescription, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { useMijeongeStore } from '@/stores/mijeonge'

const props = defineProps<{ meetingId: string | null }>()
const open = defineModel<boolean>('open', { required: true })
/* 안건 제목을 누르면 그 안건 이력으로 갈아탄다 — 목록을 거치지 않는다 */
const emit = defineEmits<{ (e: 'open-thread', id: string): void }>()

const store = useMijeongeStore()
const detail = computed(() => (props.meetingId ? store.meetingDetail(props.meetingId) : null))
</script>

<template>
  <Dialog v-model:open="open">
    <DialogScrollContent v-if="detail" class="max-w-[1000px] gap-0 p-0">
      <div class="flex items-center gap-2.5 border-b border-border px-[26px] py-4 pr-[60px]">
        <FolderClosed class="size-3.5 text-muted-foreground" />
        <span class="text-xs text-muted-foreground">{{ store.currentProject.name }}</span>
        <ChevronRight class="size-3 text-muted-foreground" />
        <span class="text-xs">회의</span>
      </div>

      <div class="flex justify-center px-[26px] py-[26px]">
        <div class="flex w-full max-w-[780px] flex-col gap-6">
          <header class="flex flex-col gap-3.5">
            <div class="flex flex-wrap items-center gap-2.5">
              <span class="text-xs font-medium">{{ detail.dateLabel }}</span>
              <DialogDescription class="text-xs text-muted-foreground">
                안건 {{ detail.threads.length }}건 · 남긴 줄 {{ detail.entryCount }}건 · 결정 {{ detail.decidedCount }}건
              </DialogDescription>
            </div>
            <DialogTitle class="text-2xl leading-snug font-semibold tracking-tight text-pretty">
              {{ detail.meeting.title }}
            </DialogTitle>
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs text-muted-foreground">참석</span>
              <PersonChip v-for="n in detail.attendeeNames" :key="n" :name="n" />
            </div>
          </header>

          <section class="flex flex-col gap-3.5">
            <div class="flex flex-wrap items-center gap-2.5">
              <span class="text-xs font-medium tracking-wider text-muted-foreground">이 회의에서 다룬 안건</span>
              <span class="text-xs font-medium">{{ detail.threads.length }}</span>
              <span class="text-xs text-muted-foreground">
                회의록 본문은 없습니다 — 안건에 남긴 줄이 그대로 이 회의의 기록입니다
              </span>
            </div>

            <div
              v-for="g in detail.threads"
              :key="g.thread.id"
              class="flex flex-col gap-3 rounded-lg border border-border bg-card px-[18px] py-4 shadow-sm"
            >
              <div class="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  class="min-w-0 grow text-left text-[15px] leading-snug font-medium underline-offset-4 text-pretty hover:underline"
                  @click="emit('open-thread', g.thread.id)"
                >
                  {{ g.thread.title }}
                </button>
                <ThreadStateBadge :state="g.thread.state" :defer-count="g.deferCount" />
              </div>

              <div class="flex flex-col gap-3">
                <div v-for="l in g.lines" :key="l.entry.id" class="flex flex-col gap-2 border-l-2 border-border pl-3.5">
                  <div class="flex flex-wrap items-center gap-2">
                    <EntryKindBadge :kind="l.entry.kind" />
                    <PersonChip v-if="l.ownerName" :name="l.ownerName" />
                  </div>
                  <p class="text-sm leading-relaxed text-pretty">{{ l.entry.text }}</p>
                  <div v-if="l.entry.detail.length" class="flex flex-col gap-1 border-l-2 border-border pl-3">
                    <p
                      v-for="(line, i) in l.entry.detail"
                      :key="i"
                      class="text-[13px] leading-relaxed text-muted-foreground text-pretty"
                    >
                      {{ line }}
                    </p>
                  </div>
                  <p v-if="l.entry.note" class="text-xs leading-relaxed text-muted-foreground text-pretty">
                    {{ l.entry.note }}
                  </p>
                </div>
              </div>
            </div>

            <div
              v-if="detail.threads.length === 0"
              class="rounded-lg border border-dashed border-border px-[18px] py-8 text-center text-sm text-muted-foreground"
            >
              이 회의에서는 안건에 남긴 줄이 없습니다.
            </div>
          </section>

          <section v-if="detail.meeting.memos.length" class="flex flex-col gap-3.5">
            <div class="flex flex-wrap items-center gap-2.5">
              <span class="text-xs font-medium tracking-wider text-muted-foreground">회의 메모</span>
              <span class="text-xs font-medium">{{ detail.meeting.memos.length }}</span>
              <span class="text-xs text-muted-foreground">어느 안건에도 붙지 않은 줄입니다</span>
            </div>

            <div class="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-[18px] py-4 shadow-sm">
              <div v-for="m in detail.meeting.memos" :key="m.id" class="flex flex-col gap-1.5">
                <p class="text-sm leading-relaxed text-pretty">{{ m.text }}</p>
                <button
                  v-if="m.promotedThreadId"
                  type="button"
                  class="self-start text-xs font-medium underline-offset-4 hover:underline"
                  @click="emit('open-thread', m.promotedThreadId)"
                >
                  안건으로 올림 — 그 안건 보기
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
