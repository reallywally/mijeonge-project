<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useNow } from '@vueuse/core'
import { Loader2, Pencil, RotateCcw, Trash2 } from 'lucide-vue-next'
import PersonChip from '@/components/app/PersonChip.vue'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { dayTime, relativeTime } from '@/lib/date'
import { useCommentStore } from '@/stores/comment'
import { useDataStore } from '@/stores/data'

/* 작업 댓글 — 작업 상세의 맨 아래. 본문은 스냅샷에 없어 열 때 받는다.
   남기는 사람은 머리글에서 고른 '나'다. 자기 댓글만 고치고 지운다. */
const props = defineProps<{ taskId: string }>()

const data = useDataStore()
const commentStore = useCommentStore()

const comments = computed(() => commentStore.commentsOf(props.taskId))
const status = computed(() => commentStore.statusOf(props.taskId))
const me = computed(() => data.currentMemberId)

/* '5분 전' 이 그대로 굳지 않게 1분마다 다시 잰다 */
const now = useNow({ interval: 60_000 })

const draft = ref('')
const sending = ref(false)

const editingId = ref<string | null>(null)
const editDraft = ref('')
/* v-for 안의 ref 는 배열로 모인다 — 고치는 칸은 한 번에 하나라 첫 것이다 */
const editField = ref<InstanceType<typeof Textarea>[]>([])
const confirmingId = ref<string | null>(null)
const busyId = ref<string | null>(null)

watch(
  () => props.taskId,
  (taskId) => {
    draft.value = ''
    editingId.value = null
    confirmingId.value = null
    void commentStore.load(taskId)
  },
  { immediate: true },
)

/** ⌘/Ctrl+Enter — 한글 조합 중의 Enter 는 글자를 맺는 키라 보내지 않는다 */
const isSubmitKey = (e: KeyboardEvent) =>
  e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing && e.keyCode !== 229

async function send() {
  if (sending.value || !me.value || !draft.value.trim()) return
  sending.value = true
  const ok = await commentStore.add(props.taskId, draft.value)
  sending.value = false
  if (ok) draft.value = ''
}

function onDraftKeydown(e: KeyboardEvent) {
  if (!isSubmitKey(e)) return
  e.preventDefault()
  void send()
}

async function startEdit(commentId: string, body: string) {
  confirmingId.value = null
  editingId.value = commentId
  editDraft.value = body
  await nextTick()
  ;(editField.value[0]?.$el as HTMLTextAreaElement | undefined)?.focus()
}

function cancelEdit() {
  editingId.value = null
  editDraft.value = ''
}

async function saveEdit() {
  const commentId = editingId.value
  if (!commentId || busyId.value || !editDraft.value.trim()) return
  busyId.value = commentId
  const ok = await commentStore.edit(commentId, editDraft.value)
  busyId.value = null
  if (ok) cancelEdit()
}

function onEditKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !e.isComposing) {
    /* 팝업까지 닫히지 않게 여기서 멈춘다 */
    e.preventDefault()
    e.stopPropagation()
    cancelEdit()
  } else if (isSubmitKey(e)) {
    e.preventDefault()
    void saveEdit()
  }
}

async function confirmRemove(commentId: string) {
  if (busyId.value) return
  busyId.value = commentId
  await commentStore.remove(commentId)
  busyId.value = null
  confirmingId.value = null
}

const authorName = (authorId: string | null) => data.memberName(authorId) ?? '알 수 없음'
</script>

<template>
  <section class="flex min-w-0 flex-col gap-2.5" aria-label="댓글">
    <div class="flex items-baseline gap-2">
      <span class="text-xs font-medium">댓글</span>
      <span class="text-xs text-muted-foreground">{{ comments.length }}개</span>
      <Loader2
        v-if="status === 'loading' && comments.length > 0"
        class="size-3 animate-spin self-center text-muted-foreground"
        aria-label="불러오는 중"
      />
    </div>

    <p
      v-if="status === 'loading' && comments.length === 0"
      class="flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Loader2 class="size-3.5 animate-spin" />
      댓글을 불러오는 중입니다.
    </p>
    <div
      v-else-if="status === 'error' && comments.length === 0"
      class="flex items-center gap-2 text-xs text-destructive"
    >
      <span>{{ commentStore.errorOf(taskId) }}</span>
      <Button variant="outline" size="xs" @click="commentStore.load(taskId)">
        <RotateCcw />
        다시 불러오기
      </Button>
    </div>
    <p v-else-if="comments.length === 0" class="text-xs text-muted-foreground">
      아직 댓글이 없습니다.
    </p>

    <ol v-if="comments.length > 0" class="flex flex-col">
      <li
        v-for="c in comments"
        :key="c.id"
        :data-comment-id="c.id"
        class="group flex flex-col gap-1.5 border-b border-border py-2.5 first:pt-0 last:border-b-0"
      >
        <div class="flex items-center gap-2">
          <PersonChip :name="authorName(c.authorId)" />
          <time
            class="text-xs text-muted-foreground"
            :datetime="c.createdAt"
            :title="dayTime(c.createdAt)"
            >{{ relativeTime(c.createdAt, now) }}</time
          >
          <span
            v-if="c.editedAt"
            class="text-xs text-muted-foreground"
            :title="`${dayTime(c.editedAt)}에 고침`"
            >(수정됨)</span
          >
          <span class="grow" />
          <template v-if="commentStore.isMine(c) && editingId !== c.id">
            <template v-if="confirmingId === c.id">
              <span class="text-xs text-muted-foreground">지울까요?</span>
              <Button
                variant="destructive"
                size="xs"
                :disabled="busyId === c.id"
                @click="confirmRemove(c.id)"
              >
                삭제
              </Button>
              <Button variant="ghost" size="xs" @click="confirmingId = null">취소</Button>
            </template>
            <template v-else>
              <button
                type="button"
                class="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
                aria-label="댓글 고치기"
                title="고치기"
                @click="startEdit(c.id, c.body)"
              >
                <Pencil class="size-3.5" />
              </button>
              <button
                type="button"
                class="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
                aria-label="댓글 지우기"
                title="지우기"
                @click="confirmingId = c.id"
              >
                <Trash2 class="size-3.5" />
              </button>
            </template>
          </template>
        </div>

        <form v-if="editingId === c.id" class="flex flex-col gap-1.5" @submit.prevent="saveEdit">
          <Textarea
            ref="editField"
            v-model="editDraft"
            rows="2"
            aria-label="댓글 고치기"
            class="min-h-16 resize-y text-sm"
            @keydown="onEditKeydown"
          />
          <div class="flex items-center justify-end gap-1.5">
            <span class="grow text-xs text-muted-foreground">⌘/Ctrl+Enter 저장 · Esc 취소</span>
            <Button type="button" variant="ghost" size="xs" @click="cancelEdit">취소</Button>
            <Button type="submit" size="xs" :disabled="!editDraft.trim() || busyId === c.id">
              저장
            </Button>
          </div>
        </form>
        <p v-else class="text-sm leading-relaxed break-words whitespace-pre-wrap">{{ c.body }}</p>
      </li>
    </ol>

    <form class="flex flex-col gap-1.5" @submit.prevent="send">
      <Textarea
        v-model="draft"
        rows="2"
        aria-label="댓글"
        :disabled="!me"
        :placeholder="me ? '댓글을 남기세요' : '댓글을 남기려면 머리글에서 나를 먼저 고르세요'"
        class="min-h-16 resize-y text-sm"
        @keydown="onDraftKeydown"
      />
      <div class="flex items-center gap-2">
        <span v-if="me" class="grow text-xs text-muted-foreground">
          {{ data.memberName(me) }} 이름으로 남깁니다 · ⌘/Ctrl+Enter
        </span>
        <span v-else class="grow text-xs text-muted-foreground">
          로그인이 없어 오른쪽 위 '나'에서 누구인지 고릅니다.
        </span>
        <Button type="submit" size="sm" :disabled="!me || !draft.trim() || sending">
          <Loader2 v-if="sending" class="animate-spin" />
          댓글 남기기
        </Button>
      </div>
    </form>
  </section>
</template>
