<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, FolderClosed, Sparkles } from 'lucide-vue-next'
import RequestSpecBadge from '@/components/app/RequestSpecBadge.vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useMijeongeStore } from '@/stores/mijeonge'
import type { RequestState } from '@/types/domain'

const props = defineProps<{ requestId: string | null }>()
const open = defineModel<boolean>('open', { required: true })
/* 댓글로 결론이 안 나 안건으로 올렸을 때, 그 안건 이력으로 갈아탄다 */
const emit = defineEmits<{ (e: 'open-thread', id: string): void }>()

const store = useMijeongeStore()
const detail = computed(() => (props.requestId ? store.requestDetail(props.requestId) : null))

const STATES: { key: RequestState; label: string }[] = [
  { key: 'todo', label: '요청됨' },
  { key: 'doing', label: '하는 중' },
  { key: 'done', label: '완료' },
]

const draft = ref('')
watch(() => props.requestId, () => { draft.value = '' })

function submitComment() {
  const text = draft.value.trim()
  if (!text || !props.requestId) return
  store.addRequestComment(props.requestId, text)
  draft.value = ''
}

function promote() {
  if (!props.requestId) return
  const threadId = store.promoteRequestToThread(props.requestId)
  if (!threadId) return
  open.value = false
  emit('open-thread', threadId)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogScrollContent v-if="detail" class="max-w-[1000px] gap-0 p-0">
      <div class="flex items-center gap-2.5 border-b border-border px-[26px] py-4 pr-[60px]">
        <FolderClosed class="size-3.5 text-muted-foreground" />
        <span class="text-xs text-muted-foreground">{{ store.currentProject.name }}</span>
        <ChevronRight class="size-3 text-muted-foreground" />
        <span class="text-xs">요청</span>
      </div>

      <div class="flex justify-center px-[26px] py-[26px]">
        <div class="flex w-full max-w-[780px] flex-col gap-6">
          <header class="flex flex-col gap-2.5">
            <DialogTitle class="text-2xl leading-snug font-semibold tracking-tight text-pretty">
              {{ detail.request.title }}
            </DialogTitle>
            <DialogDescription class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{{ detail.requesterName }} → {{ detail.assigneeName ?? '담당자 미정' }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ detail.request.dueDate ? `${detail.dueLabel}까지` : '기한 없음' }}</span>
              <span aria-hidden="true">·</span>
              <span class="inline-flex gap-1">
                <button
                  v-for="s in STATES"
                  :key="s.key"
                  type="button"
                  class="inline-flex h-[22px] items-center rounded-md border px-2 text-[11px] font-medium transition-colors"
                  :class="
                    detail.request.state === s.key
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background hover:bg-accent hover:text-accent-foreground'
                  "
                  @click="store.setRequestState(detail.request.id, s.key)"
                >
                  {{ s.label }}
                </button>
              </span>
            </DialogDescription>
            <p v-if="detail.sourceThread" class="text-xs text-muted-foreground text-pretty">
              안건
              <button type="button" class="font-medium text-foreground underline underline-offset-4" @click="emit('open-thread', detail.sourceThread.id)">
                {{ detail.sourceThread.title }}
              </button>
              의 {{ detail.sourceLabel }}
            </p>
          </header>

          <div class="h-px bg-border" />

          <p v-if="detail.request.body" class="text-[15px] leading-relaxed whitespace-pre-line text-pretty">
            {{ detail.request.body }}
          </p>
          <p v-else class="text-sm text-muted-foreground">
            상세 내용 없이 제목만 올라온 요청입니다.
          </p>

          <div class="h-px bg-border" />

          <section class="flex flex-col gap-3.5">
            <div class="flex items-center gap-2.5">
              <span class="text-xs font-medium tracking-wider text-muted-foreground">정리된 요청</span>
              <RequestSpecBadge :state="detail.specState" />
              <div class="grow" />
              <template v-if="detail.specState === 'draft'">
                <Button variant="outline" size="sm" @click="store.summarizeRequest(detail.request.id)">다시 정리</Button>
                <Button size="sm" @click="store.confirmRequestSpec(detail.request.id)">이대로 확정</Button>
              </template>
              <template v-else-if="detail.specState === 'confirmed'">
                <span class="text-xs text-muted-foreground">
                  {{ store.memberName(detail.request.spec?.confirmedById ?? null) }}이 확정
                </span>
                <Button variant="outline" size="sm" @click="store.summarizeRequest(detail.request.id)">다시 정리</Button>
              </template>
            </div>

            <div v-if="detail.specState === 'none'" class="flex items-center gap-4">
              <p class="grow text-sm leading-relaxed text-muted-foreground text-pretty">
                아직 정리되지 않았습니다. 댓글 {{ detail.comments.length }}개가 오갔습니다.
              </p>
              <Button class="shrink-0" @click="store.summarizeRequest(detail.request.id)">
                <Sparkles class="size-4" />
                오간 이야기 정리하기
              </Button>
            </div>

            <template v-else-if="detail.request.spec">
              <div v-if="detail.specState === 'stale'" class="flex items-center gap-3">
                <p class="grow text-sm leading-relaxed text-destructive text-pretty">
                  정리한 뒤로 댓글 {{ detail.staleCount }}개가 더 달렸습니다.
                </p>
                <Button variant="destructive" size="sm" class="shrink-0" @click="store.summarizeRequest(detail.request.id)">
                  다시 정리
                </Button>
              </div>

              <ul class="flex flex-col gap-2.5">
                <li v-for="(point, i) in detail.request.spec.points" :key="i" class="flex items-start gap-3">
                  <span class="mt-[9px] size-1 shrink-0 rounded-full bg-foreground" />
                  <span class="min-w-0 grow text-[15px] leading-relaxed text-pretty">{{ point }}</span>
                </li>
              </ul>
            </template>
          </section>

          <div class="h-px bg-border" />

          <section class="flex flex-col gap-4">
            <div class="flex items-center gap-2.5">
              <span class="text-xs font-medium tracking-wider text-muted-foreground">주고받은 이야기</span>
              <span class="text-xs text-muted-foreground">{{ detail.comments.length }}개</span>
            </div>

            <div v-for="c in detail.comments" :key="c.comment.id" class="flex items-start gap-3">
              <span class="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] text-muted-foreground">
                {{ c.authorName.charAt(0) }}
              </span>
              <div class="flex min-w-0 grow flex-col gap-1">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-semibold">{{ c.authorName }}</span>
                  <span class="text-xs text-muted-foreground">{{ c.atLabel }}</span>
                </div>
                <p class="text-sm leading-relaxed whitespace-pre-line text-pretty">{{ c.comment.text }}</p>
              </div>
            </div>

            <p v-if="detail.comments.length === 0" class="text-sm text-muted-foreground">
              아직 오간 이야기가 없습니다.
            </p>

            <div class="flex items-start gap-3 pt-1">
              <span class="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] text-muted-foreground">
                {{ (store.memberName(store.currentMemberId) ?? '나').charAt(0) }}
              </span>
              <div class="flex min-w-0 grow flex-col gap-2.5">
                <Textarea v-model="draft" rows="2" placeholder="댓글 쓰기" class="resize-none" />
                <div class="flex items-center gap-2">
                  <span class="grow text-xs text-muted-foreground">여기서 결론이 안 나면 안건으로 올리세요.</span>
                  <Button variant="outline" size="sm" @click="promote">안건으로 올리기</Button>
                  <Button size="sm" :disabled="draft.trim().length === 0" @click="submitComment">댓글 남기기</Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
