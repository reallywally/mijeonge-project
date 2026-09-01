<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, ChevronRight, FolderClosed } from 'lucide-vue-next'
import EntryKindBadge from '@/components/app/EntryKindBadge.vue'
import PersonChip from '@/components/app/PersonChip.vue'
import ThreadStateBadge from '@/components/app/ThreadStateBadge.vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { monthDay } from '@/lib/date'
import { useMijeongeStore } from '@/stores/mijeonge'
import type { EntryKind } from '@/types/domain'

const props = defineProps<{ threadId: string | null }>()
const open = defineModel<boolean>('open', { required: true })
/* 하위 안건을 누르면 그 안건으로 갈아탄다 — 목록을 거치지 않는다 */
const emit = defineEmits<{ (e: 'open-thread', id: string): void }>()

const store = useMijeongeStore()
const detail = computed(() => (props.threadId ? store.threadDetail(props.threadId) : null))

/* 회의 없이 처리 — 회의를 다시 잡지 않고 담당자 확인만으로 끝낸 줄을 여기서 남긴다 */
type OutKind = Extract<EntryKind, 'decide' | 'refine' | 'defer'>

const OUT_KINDS: { key: OutKind; label: string; placeholder: string }[] = [
  { key: 'decide', label: '결정', placeholder: '한 줄로 — 어떻게 정했나요' },
  { key: 'refine', label: '세부 추가', placeholder: '한 줄로 — 무엇을 더 정했나요' },
  { key: 'defer', label: '미룸', placeholder: '한 줄로 — 어디까지 갔나요' },
]

const outKind = ref<OutKind>('decide')
const outText = ref('')
const outNote = ref('')
const outOwner = ref<string | null>(null)

const outPlaceholder = computed(
  () => OUT_KINDS.find((k) => k.key === outKind.value)!.placeholder,
)

watch(
  () => props.threadId,
  () => {
    outKind.value = 'decide'
    outText.value = ''
    outNote.value = ''
    outOwner.value = null
  },
)

function submitOutside() {
  const text = outText.value.trim()
  if (!text || !props.threadId) return
  store.addOutsideEntry(props.threadId, outKind.value, text, outNote.value.trim(), outOwner.value)
  outText.value = ''
  outNote.value = ''
  outOwner.value = null
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogScrollContent v-if="detail" class="max-w-[1000px] gap-0 p-0">
      <div class="flex items-center gap-2.5 border-b border-border px-[26px] py-4 pr-[60px]">
        <FolderClosed class="size-3.5 text-muted-foreground" />
        <span class="text-xs text-muted-foreground">{{ store.currentProject.name }}</span>
        <ChevronRight class="size-3 text-muted-foreground" />
        <span class="text-xs">안건</span>
      </div>

      <div class="flex justify-center px-[26px] py-[26px]">
        <div class="flex w-full max-w-[780px] flex-col gap-6">
          <header class="flex flex-col gap-3.5">
            <div class="flex items-center gap-2.5">
              <ThreadStateBadge :state="detail.thread.state" :defer-count="detail.deferCount" />
              <DialogDescription class="text-xs text-muted-foreground">
                이력 {{ detail.events.length }}건
              </DialogDescription>
            </div>
            <DialogTitle class="text-2xl leading-snug font-semibold tracking-tight text-pretty">
              {{ detail.thread.title }}
            </DialogTitle>
          </header>

          <section class="flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-[18px] shadow-sm">
            <div class="text-xs font-medium tracking-wider text-muted-foreground">지금 합의된 내용</div>

            <div v-if="detail.settled" class="flex flex-col gap-3.5">
              <div class="flex items-start gap-3">
                <span class="mt-0.5 flex size-[19px] shrink-0 items-center justify-center rounded-full bg-primary">
                  <Check class="size-3 text-primary-foreground" />
                </span>
                <p class="min-w-0 grow text-[15px] leading-relaxed text-pretty">{{ detail.current }}</p>
              </div>

              <div v-if="detail.detail.length" class="ml-[31px] flex flex-col gap-1.5 border-l-2 border-border pl-3.5">
                <p v-for="(line, i) in detail.detail" :key="i" class="text-sm leading-relaxed text-pretty">
                  {{ line }}
                </p>
                <p class="text-xs text-muted-foreground">조건별 상세 — 이 결정 안에 함께 적힌 줄입니다</p>
              </div>

              <div v-if="detail.subThreads.length" class="ml-[31px] flex flex-col gap-2">
                <div class="text-xs font-medium tracking-wider text-muted-foreground">따로 떼어낸 하위 안건</div>
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

              <div class="flex items-center gap-2">
                <PersonChip v-if="detail.settledOwnerName" :name="detail.settledOwnerName" />
                <span class="text-xs text-muted-foreground">{{ detail.settledLabel }}</span>
              </div>
            </div>

            <div v-else class="flex flex-col gap-2.5">
              <div class="flex items-start gap-3">
                <span class="mt-0.5 flex size-[19px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-muted-foreground">
                  <span class="size-1.5 rounded-full bg-muted-foreground" />
                </span>
                <p class="min-w-0 grow text-[15px] leading-relaxed text-muted-foreground">아직 정해지지 않았습니다.</p>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ detail.deferCount }}번 미뤄졌고, 처음 나온 뒤 이력이 {{ detail.events.length }}건 쌓였습니다.
              </p>
            </div>
          </section>

          <section class="flex flex-col gap-3.5">
            <div class="flex flex-wrap items-center gap-2.5">
              <span class="text-xs font-medium tracking-wider text-muted-foreground">회의별 이력</span>
              <span class="text-xs font-medium">{{ detail.events.length }}</span>
              <span class="text-xs text-muted-foreground">
                각 줄이 그 회의의 기록이기도 합니다 — 회의록을 따로 쓰지 않습니다
              </span>
            </div>

            <div class="flex flex-col gap-3 rounded-lg border border-border bg-card px-[18px] py-4 shadow-sm">
              <div class="text-xs font-medium tracking-wider text-muted-foreground">회의 없이 처리</div>
              <p class="text-xs leading-relaxed text-muted-foreground text-pretty">
                회의를 다시 잡지 않고 담당자 확인만으로 처리한 경우입니다. 남기면 이 안건의 이력에 회의 밖 줄로
                올라가고, 어느 회의에도 붙지 않습니다.
              </p>

              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="k in OUT_KINDS"
                  :key="k.key"
                  type="button"
                  class="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors"
                  :class="
                    outKind === k.key
                      ? 'border-primary bg-primary text-primary-foreground shadow'
                      : 'border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'
                  "
                  @click="outKind = k.key"
                >
                  {{ k.label }}
                </button>
              </div>

              <Input v-model="outText" :placeholder="outPlaceholder" @keyup.enter="submitOutside" />
              <Input v-model="outNote" placeholder="근거 — 무엇을 확인했나요 (선택)" />

              <div class="flex flex-col gap-2">
                <span class="text-xs text-muted-foreground">처리한 사람</span>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="m in store.allMembers"
                    :key="m.id"
                    type="button"
                    class="inline-flex h-[34px] items-center gap-1.5 rounded-md border py-0.5 pr-3 pl-1.5 text-xs transition-colors"
                    :class="
                      outOwner === m.id
                        ? 'border-primary bg-accent font-medium text-accent-foreground'
                        : 'border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'
                    "
                    @click="outOwner = outOwner === m.id ? null : m.id"
                  >
                    <span class="flex size-[22px] items-center justify-center rounded-full bg-secondary text-[10px] text-muted-foreground">
                      {{ m.name.charAt(0) }}
                    </span>
                    {{ m.name }}
                  </button>
                </div>
              </div>

              <Button class="self-start" :disabled="!outText.trim()" @click="submitOutside">이력에 남기기</Button>
            </div>

            <div class="flex flex-col">
              <div v-for="e in detail.events" :key="e.entry.id" class="flex gap-4">
                <div class="w-[74px] shrink-0 pt-0.5 text-right text-xs font-medium">
                  {{ monthDay(e.at) }}
                </div>
                <div class="w-px shrink-0 bg-border" />
                <div class="flex min-w-0 grow flex-col gap-2.5 pb-[22px]">
                  <div class="flex flex-wrap items-center gap-2">
                    <EntryKindBadge :kind="e.entry.kind" />
                    <span
                      v-if="!e.meeting"
                      class="inline-flex h-[22px] items-center rounded-sm border border-dashed border-border px-2 text-xs text-muted-foreground"
                    >
                      회의 밖
                    </span>
                    <span class="text-xs text-muted-foreground">{{ e.meeting?.title ?? '회의 없이 처리' }}</span>
                  </div>

                  <p
                    class="text-sm leading-relaxed text-pretty"
                    :class="e.superseded ? 'text-muted-foreground line-through' : ''"
                  >
                    {{ e.entry.text }}
                  </p>

                  <div v-if="e.entry.detail.length" class="flex flex-col gap-1 border-l-2 border-border pl-3">
                    <p v-for="(line, i) in e.entry.detail" :key="i" class="text-[13px] leading-relaxed text-muted-foreground text-pretty">
                      {{ line }}
                    </p>
                  </div>

                  <p v-if="e.entry.note" class="text-xs leading-relaxed text-muted-foreground text-pretty">
                    {{ e.entry.note }}
                  </p>

                  <PersonChip v-if="e.ownerName" :name="e.ownerName" class="self-start" />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
