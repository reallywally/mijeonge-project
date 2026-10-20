<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  CalendarDays,
  ChevronLeft,
  CircleCheck,
  ListPlus,
  ListTree,
  Loader2,
  Pencil,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import EntryKindBadge from '@/components/app/EntryKindBadge.vue'
import MinutesReview from '@/components/app/MinutesReview.vue'
import TaskDetailDialog from '@/components/app/TaskDetailDialog.vue'
import ThreadDetailDialog from '@/components/app/ThreadDetailDialog.vue'
import ThreadStateBadge from '@/components/app/ThreadStateBadge.vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ApiError, messageOf } from '@/api'
import { dayTime, monthDay } from '@/lib/date'
import { outcomeCount } from '@/lib/minutes'
import { useDataStore } from '@/stores/data'
import { useMinutesStore } from '@/stores/minutes'
import { useMinutesDraftStore } from '@/stores/minutesDraft'
import { useThreadStore } from '@/stores/thread'

/* 회의록 상세 — 글 그대로 읽고, [AI 정리] 를 누르면 검토가 이 안에서 펼쳐진다.
   [등록] 하면 검토를 닫고 '이 회의록에서 나온 것' 이 는다. 초안은 서버가 들고 있지 않아 떠나면 잃는다 — 묻고, 떠나면 비운다 */
const route = useRoute()
const router = useRouter()
const data = useDataStore()
const minutes = useMinutesStore()
const draft = useMinutesDraftStore()
const threadStore = useThreadStore()

const minutesId = computed(() => String(route.params.minutesId ?? ''))
const loadState = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
const loadError = ref('')
const m = computed(() => (loadState.value === 'ready' ? minutes.byId[minutesId.value] : undefined))

async function load(id: string) {
  loadState.value = 'loading'
  try {
    const got = await minutes.fetchOne(id)
    if (minutesId.value !== id) return
    /* 다른 프로젝트의 회의록 주소로 들어왔으면 그 프로젝트로 옮긴다 — '나온 것' 은 그 프로젝트의 스냅샷에서 센다 */
    if (got.projectId !== data.currentProjectId) data.setProject(got.projectId)
    loadState.value = 'ready'
  } catch (e) {
    if (minutesId.value !== id) return
    loadState.value = e instanceof ApiError && e.status === 404 ? 'missing' : 'error'
    loadError.value = messageOf(e)
  }
}
watch(minutesId, (id) => void load(id), { immediate: true })

/* 보는 중에 위에서 프로젝트를 바꾸면 이 회의록은 그 프로젝트의 것이 아니다 — 목록으로 */
watch(
  () => data.currentProjectId,
  (projectId) => {
    if (m.value && m.value.projectId !== projectId) {
      draft.reset()
      void router.replace('/minutes')
    }
  },
)

const outcome = computed(() => minutes.outcomeOf(minutesId.value))
const madeCount = computed(() => outcomeCount(outcome.value))
const threadRow = (id: string) => threadStore.rows.find((r) => r.thread.id === id)
const threadTitle = (id: string) =>
  data.allThreads.find((t) => t.id === id)?.title ?? '찾을 수 없는 안건'

/* 정리 — 검토 · 정리 중은 이 회의록의 것만 그린다 */
const mine = computed(() => draft.minutesId === minutesId.value)
const drafting = computed(() => mine.value && draft.phase === 'drafting')
const reviewing = computed(() => mine.value && draft.phase === 'review' && draft.form !== null)
const runLabel = computed(() => (madeCount.value > 0 || reviewing.value ? '다시 정리' : 'AI 정리'))

function runDraft() {
  if (reviewing.value && !window.confirm('검토 중인 초안을 버리고 다시 정리할까요?')) return
  void draft.run(minutesId.value)
}

function discardDraft() {
  if (!window.confirm('검토 중인 초안을 버릴까요? 등록하지 않은 것은 남지 않습니다.')) return
  draft.discard()
}

const resultLine = computed(() => {
  const r = mine.value ? draft.lastResult : null
  if (!r) return ''
  const appended = r.entries.filter((e) => !r.threads.some((t) => t.id === e.threadId)).length
  return `새 안건 ${r.threads.length} · 이력 ${appended} · 작업 ${r.tasks.length}건을 등록했습니다`
})

/* 떠날 때 — 받는 중 · 검토 중이면 묻는다. 다른 회의록으로 옮길 때도 같다 */
const LEAVE_MESSAGE = '정리한 초안은 남지 않습니다. 이 화면을 떠날까요?'
let leaving = false

function guard() {
  if (leaving || !(mine.value && draft.dirty)) return true
  if (!window.confirm(LEAVE_MESSAGE)) return false
  draft.reset()
  return true
}
onBeforeRouteLeave(() => {
  if (!guard()) return false
  draft.reset()
  return true
})
onBeforeRouteUpdate((to, from) => {
  if (to.params.minutesId === from.params.minutesId) return true
  if (!guard()) return false
  draft.reset()
  closeDetails()
  return true
})

/* 새로고침 · 탭 닫기 — 브라우저가 띄우는 기본 확인 창이다 */
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!(mine.value && draft.dirty)) return
  e.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

/* 지우기 — 나온 것은 남고 출처만 빈다 */
const removeOpen = ref(false)
const removing = ref(false)
async function remove() {
  if (!m.value || removing.value) return
  removing.value = true
  const title = m.value.title
  const ok = await minutes.remove(minutesId.value)
  removing.value = false
  if (!ok) return
  removeOpen.value = false
  draft.reset()
  leaving = true
  toast.success(`'${title}' 회의록을 지웠습니다.`)
  await router.replace('/minutes')
}

/* 칩을 누르면 상세 팝업. 이 화면 안에서만 여닫으므로 주소를 바꾸지 않는다 — 떠나는 확인이 뜨지 않게 */
const threadDetailId = ref<string | null>(null)
const taskDetailId = ref<string | null>(null)
const threadOpen = computed({
  get: () => threadDetailId.value !== null,
  set: (open: boolean) => {
    if (!open) threadDetailId.value = null
  },
})
const taskOpen = computed({
  get: () => taskDetailId.value !== null,
  set: (open: boolean) => {
    if (!open) taskDetailId.value = null
  },
})
function openThread(id: string) {
  taskDetailId.value = null
  threadDetailId.value = id
}
function openTask(id: string) {
  threadDetailId.value = null
  taskDetailId.value = id
}
function closeDetails() {
  threadDetailId.value = null
  taskDetailId.value = null
}
</script>

<template>
  <AppShell>
    <div class="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-border px-[26px]">
      <RouterLink
        to="/minutes"
        class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        data-minutes-back
      >
        <ChevronLeft class="size-3.5" />
        회의록
      </RouterLink>
    </div>

    <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
      <div class="flex w-full max-w-[900px] flex-col gap-4 pb-[26px]">
        <div
          v-if="loadState === 'loading'"
          class="flex h-[110px] items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 class="size-4 animate-spin" />
          회의록을 받는 중입니다.
        </div>
        <p
          v-else-if="!m"
          class="rounded-lg border border-border px-[17px] py-3 text-sm text-muted-foreground"
          role="alert"
          data-minutes-load-error
        >
          {{
            loadState === 'missing'
              ? '회의록을 찾을 수 없습니다. 지워졌거나 볼 수 없는 회의록입니다.'
              : loadError
          }}
        </p>

        <template v-else>
          <header class="flex items-start gap-4">
            <div class="flex min-w-0 grow flex-col gap-2">
              <h1 class="text-2xl font-semibold tracking-tight break-words" data-minutes-heading>
                {{ m.title }}
              </h1>
              <p
                class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
                data-minutes-meta
              >
                <span class="inline-flex items-center gap-1">
                  <CalendarDays class="size-3.5" />
                  {{ m.meetingDate ? `${monthDay(m.meetingDate)} 회의` : '회의 날짜 없음' }}
                </span>
                <span>·</span>
                <span>{{ data.memberName(m.authorId) ?? '알 수 없음' }}</span>
                <span>·</span>
                <span :title="`${dayTime(m.createdAt)} 씀`">{{ dayTime(m.updatedAt) }} 고침</span>
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Button
                v-if="minutes.canEdit(m)"
                variant="outline"
                data-minutes-edit
                @click="router.push(`/minutes/${m.id}/edit`)"
              >
                <Pencil class="size-4" />
                고치기
              </Button>
              <Button
                v-if="minutes.canRemove(m)"
                variant="outline"
                data-minutes-remove
                @click="removeOpen = true"
              >
                <Trash2 class="size-4" />
                지우기
              </Button>
            </div>
          </header>

          <section
            v-if="m.summary"
            class="flex flex-col gap-2 rounded-lg border border-border bg-muted/50 px-[17px] py-[13px]"
            aria-label="요약"
          >
            <span class="text-xs font-medium text-muted-foreground">요약</span>
            <p
              class="text-sm leading-relaxed break-words whitespace-pre-wrap"
              data-minutes-saved-summary
            >
              {{ m.summary }}
            </p>
          </section>

          <!-- 본문 — 글 그대로. 줄바꿈을 살린다 -->
          <section
            class="rounded-lg border border-border bg-card px-[17px] py-[15px] shadow-sm"
            aria-label="본문"
          >
            <div class="text-sm leading-relaxed break-words whitespace-pre-wrap" data-minutes-body>
              {{ m.body }}
            </div>
          </section>

          <!-- 이 회의록에서 나온 것 — 스냅샷을 minutesId 로 거른다 -->
          <section class="flex flex-col gap-3" aria-label="이 회의록에서 나온 것" data-minutes-made>
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-medium">이 회의록에서 나온 것</h2>
              <span class="text-xs text-muted-foreground">{{ madeCount }}건</span>
              <div class="grow" />
              <Button
                v-if="!drafting"
                variant="outline"
                :disabled="draft.applying"
                data-minutes-run
                @click="runDraft"
              >
                <Sparkles class="size-4" />
                {{ runLabel }}
              </Button>
            </div>

            <p
              v-if="resultLine"
              class="flex items-center gap-2 text-sm text-muted-foreground"
              data-minutes-result
            >
              <CircleCheck class="size-4" />
              {{ resultLine }}
            </p>

            <p v-if="madeCount === 0" class="text-sm text-muted-foreground" data-minutes-made-empty>
              아직 정리하지 않았어요
            </p>
            <div v-else class="flex flex-col gap-2">
              <div v-if="outcome.threads.length > 0" class="flex flex-wrap items-center gap-1.5">
                <span class="w-10 shrink-0 text-xs text-muted-foreground">안건</span>
                <button
                  v-for="t in outcome.threads"
                  :key="t.id"
                  type="button"
                  class="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs hover:bg-accent"
                  :data-made-thread="t.id"
                  @click="openThread(t.id)"
                >
                  <ListTree class="size-3 shrink-0 text-muted-foreground" />
                  <span class="truncate">{{ t.title }}</span>
                  <ThreadStateBadge :state="t.state" :defer-count="threadRow(t.id)?.deferCount" />
                </button>
              </div>
              <div v-if="outcome.entries.length > 0" class="flex flex-wrap items-center gap-1.5">
                <span class="w-10 shrink-0 text-xs text-muted-foreground">이력</span>
                <button
                  v-for="e in outcome.entries"
                  :key="e.id"
                  type="button"
                  class="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs hover:bg-accent"
                  :title="e.text"
                  :data-made-entry="e.id"
                  @click="openThread(e.threadId)"
                >
                  <EntryKindBadge :kind="e.kind" />
                  <span class="truncate">{{ threadTitle(e.threadId) }}</span>
                </button>
              </div>
              <div v-if="outcome.tasks.length > 0" class="flex flex-wrap items-center gap-1.5">
                <span class="w-10 shrink-0 text-xs text-muted-foreground">작업</span>
                <button
                  v-for="t in outcome.tasks"
                  :key="t.id"
                  type="button"
                  class="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs hover:bg-accent"
                  :data-made-task="t.id"
                  @click="openTask(t.id)"
                >
                  <span class="shrink-0 font-mono text-muted-foreground">{{ t.key }}</span>
                  <span class="truncate">{{ t.title }}</span>
                </button>
              </div>
            </div>

            <!-- 정리 중 — 진행 한 줄과 [멈추기] -->
            <div
              v-if="drafting"
              class="flex items-center gap-2.5 rounded-lg border border-border bg-card px-[17px] py-[13px]"
              aria-live="polite"
            >
              <Loader2 class="size-4 shrink-0 animate-spin text-muted-foreground" />
              <span
                class="min-w-0 grow truncate text-sm text-muted-foreground"
                data-minutes-progress
              >
                {{ draft.tool || '회의록을 읽는 중' }}
              </span>
              <Button variant="outline" data-minutes-stop @click="draft.stop()">
                <Square class="size-3.5 fill-current" />
                멈추기
              </Button>
            </div>
            <p
              v-if="mine && draft.error"
              class="text-sm text-destructive"
              role="alert"
              data-minutes-error
            >
              {{ draft.error }}
            </p>
          </section>

          <!-- 검토 -->
          <template v-if="reviewing">
            <MinutesReview @open-thread="openThread" />
            <div
              class="sticky bottom-0 flex items-center gap-2.5 border-t border-border bg-background py-3"
            >
              <span class="min-w-0 grow text-xs text-muted-foreground">
                켠 줄만 등록합니다. 등록하면 바로 저장되고 되돌릴 수 없습니다.
              </span>
              <Button
                variant="ghost"
                :disabled="draft.applying"
                data-minutes-discard
                @click="discardDraft"
              >
                <X class="size-4" />
                그만두기
              </Button>
              <Button :disabled="!draft.canApply" data-minutes-apply @click="draft.apply()">
                <Loader2 v-if="draft.applying" class="size-4 animate-spin" />
                <ListPlus v-else class="size-4" />
                {{ draft.applying ? '등록하는 중' : `등록 ${draft.pickedCount}건` }}
              </Button>
            </div>
          </template>
        </template>
      </div>
    </div>

    <Dialog v-model:open="removeOpen">
      <DialogContent class="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>회의록을 지울까요?</DialogTitle>
          <DialogDescription class="text-pretty" data-minutes-remove-note>
            {{
              madeCount > 0
                ? `여기서 나온 ${madeCount}건은 남습니다. 그 안건 · 이력 · 작업에서 회의록 출처만 빠집니다.`
                : '지운 회의록은 되돌릴 수 없습니다.'
            }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="removeOpen = false">취소</Button>
          <Button
            variant="destructive"
            :disabled="removing"
            data-minutes-remove-confirm
            @click="remove"
          >
            <Loader2 v-if="removing" class="animate-spin" />
            지우기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <ThreadDetailDialog
      v-model:open="threadOpen"
      :thread-id="threadDetailId"
      @open-thread="openThread"
    />
    <TaskDetailDialog
      v-model:open="taskOpen"
      :task-id="taskDetailId"
      @open-task="openTask"
      @open-thread="openThread"
    />
  </AppShell>
</template>
