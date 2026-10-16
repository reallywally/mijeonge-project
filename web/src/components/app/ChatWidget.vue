<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowUp, Loader2, MessageCircle, RotateCcw, Square, X } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import ChatProposalCard from '@/components/app/ChatProposalCard.vue'
import ChatRefText from '@/components/app/ChatRefText.vue'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { insertMention, mentionCandidates, mentionQuery, type MentionQuery } from '@/lib/mention'
import { taskStatusLabel } from '@/lib/task'
import { useChatStore } from '@/stores/chat'
import { useDataStore } from '@/stores/data'
import { useTaskStore } from '@/stores/task'

/* 오른쪽 아래 챗봇. App.vue 에 한 번만 둔다 — 화면을 옮겨도 대화가 이어진다.
   창을 닫으면 대화가 끝난다 (API.md Q26). 모달이 아니라 열어 둔 채 뒤 화면을 쓸 수 있다. */
const data = useDataStore()
const chat = useChatStore()
const taskStore = useTaskStore()
const router = useRouter()

const EXAMPLES = ['서버 OS 뭐로 정했지?', '아직 안 정해진 안건 뭐 있어?', '막힌 작업 알려줘']

const open = ref(false)
const draft = ref('')
const input = ref<InstanceType<typeof Textarea> | null>(null)
const scroller = ref<HTMLElement | null>(null)

const inputEl = () => input.value?.$el as HTMLTextAreaElement | undefined
const focusInput = () => inputEl()?.focus()

/* '@' 를 치면 작업을 골라 '@HW-4' 로 넣는다 — 서버가 그 키를 작업으로 찾아 Claude 에게 넘긴다.
   한글은 조합 중에도 고를 수 있게 v-model 이 아니라 입력칸의 지금 글로 본다 */
const mention = ref<MentionQuery | null>(null)
const picked = ref(0)
const candidates = computed(() =>
  mention.value ? mentionCandidates(taskStore.tasks, mention.value.query) : [],
)
const mentionOpen = computed(() => candidates.value.length > 0)

function trackMention() {
  const el = inputEl()
  const next = el ? mentionQuery(el.value, el.selectionStart ?? el.value.length) : null
  if (next?.query !== mention.value?.query || next?.start !== mention.value?.start) picked.value = 0
  mention.value = next
}

async function pickMention(index = picked.value) {
  const el = inputEl()
  const task = candidates.value[index]
  if (!el || !mention.value || !task) return
  const next = insertMention(el.value, mention.value, task.key)
  draft.value = next.text
  mention.value = null
  await nextTick()
  el.focus()
  el.setSelectionRange(next.caret, next.caret)
}

async function show() {
  open.value = true
  await nextTick()
  focusInput()
}

function close() {
  open.value = false
  draft.value = ''
  mention.value = null
  chat.reset()
}

function send(text = draft.value) {
  if (!text.trim() || chat.receiving || chat.registering) return
  draft.value = ''
  mention.value = null
  void chat.ask(text)
  focusInput()
}

/* 근거 칩은 주소로 간다 — 그 화면이 기존 상세 팝업을 띄운다. 창은 닫지 않는다(대화가 이어진다) */
function openThread(id: string) {
  void router.push({ name: 'thread', params: { id } })
}
function openTask(id: string) {
  void router.push({ name: 'task', params: { id } })
}

/* Enter 는 보내기, Shift+Enter 는 줄바꿈. 한글 조합을 끝내는 Enter 는 보내지 않는다 */
function onInputKeydown(e: KeyboardEvent) {
  if (mentionOpen.value && !e.isComposing && e.keyCode !== 229) {
    const n = candidates.value.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      picked.value = (picked.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
      return
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault()
      void pickMention()
      return
    }
    if (e.key === 'Escape') {
      /* 창까지 닫지 않고 목록만 닫는다 */
      e.preventDefault()
      e.stopPropagation()
      mention.value = null
      return
    }
  }
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return
  e.preventDefault()
  send()
}

/* 좌우 · 처음 · 끝으로 커서만 옮겨도 '@…' 안팎이 바뀐다 */
function onInputKeyup(e: KeyboardEvent) {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) trackMention()
}

function onPanelKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !e.isComposing) close()
}

/* 새 글이 붙으면 맨 아래를 보여 준다 */
watch(
  () =>
    chat.lines.map((l) => l.text.length + l.tool + l.status + (l.proposal?.status ?? '')).join(),
  async () => {
    await nextTick()
    const el = scroller.value
    if (el) el.scrollTop = el.scrollHeight
  },
)
</script>

<template>
  <template v-if="data.currentProjectId">
    <Button
      v-if="!open"
      size="icon-lg"
      class="fixed right-6 bottom-6 z-40 size-12 rounded-full shadow-lg"
      aria-label="AI 도우미 열기"
      @click="show"
    >
      <MessageCircle class="size-5" />
    </Button>

    <section
      v-else
      role="dialog"
      aria-label="AI 도우미"
      class="fixed inset-0 z-40 flex flex-col bg-background sm:inset-auto sm:right-6 sm:bottom-6 sm:h-150 sm:max-h-[calc(100dvh-3rem)] sm:w-100 sm:rounded-xl sm:border sm:border-border sm:shadow-xl"
      @keydown="onPanelKeydown"
    >
      <header class="flex shrink-0 items-center gap-2 border-b border-border py-3 pr-2 pl-4">
        <MessageCircle class="size-4 text-muted-foreground" />
        <div class="min-w-0 grow">
          <h2 class="text-sm font-semibold">AI 도우미</h2>
          <p class="truncate text-xs text-muted-foreground">
            {{ data.currentProject?.name }}의 안건 · 작업에서 찾아 답합니다
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="닫기" @click="close">
          <X />
        </Button>
      </header>

      <div ref="scroller" class="min-h-0 grow overflow-y-auto px-4 py-4" aria-live="polite">
        <div v-if="chat.empty" class="flex h-full flex-col justify-end gap-3">
          <p class="text-sm text-muted-foreground">
            정해 둔 것, 아직 못 정한 것, 막힌 작업을 물어보세요.
            <br />
            창을 닫으면 대화는 지워집니다.
          </p>
          <div class="flex flex-col items-start gap-2">
            <Button
              v-for="q in EXAMPLES"
              :key="q"
              variant="outline"
              size="sm"
              class="h-auto py-1.5 text-left whitespace-normal"
              @click="send(q)"
            >
              {{ q }}
            </Button>
          </div>
        </div>

        <ol v-else class="flex flex-col gap-3">
          <li
            v-for="line in chat.lines"
            :key="line.id"
            :class="line.role === 'user' ? 'flex justify-end' : 'flex flex-col items-start gap-1.5'"
          >
            <p
              v-if="line.role === 'user'"
              class="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm break-words whitespace-pre-wrap text-primary-foreground"
            >
              {{ line.text }}
            </p>
            <template v-else>
              <!-- 답은 AI 가 낸 글이라 v-html 로 그리지 않는다. 근거 표시만 칩으로, 사용자 글은 그대로 둔다 -->
              <ChatRefText
                v-if="line.text"
                :text="line.text"
                class="max-w-[85%] rounded-lg bg-muted px-3 py-2"
                data-answer-text
                @open-thread="openThread"
                @open-task="openTask"
              />
              <ChatProposalCard
                v-if="line.proposal"
                :proposal="line.proposal"
                :registering="chat.registering === line.id"
                @register="chat.register(line.id)"
                @cancel="chat.cancelProposal(line.id)"
              />
              <p
                v-if="line.status === 'streaming' && (line.tool || !line.text)"
                class="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <Loader2 class="size-3.5 animate-spin" />
                {{ line.tool ? `${line.tool}…` : '답을 준비하는 중…' }}
              </p>
              <p v-else-if="line.status === 'stopped'" class="text-xs text-muted-foreground">
                멈췄습니다.
              </p>
              <div
                v-else-if="line.status === 'error'"
                class="flex items-center gap-2 text-xs text-destructive"
              >
                <span>{{ line.error }}</span>
                <Button
                  variant="ghost"
                  size="xs"
                  :disabled="chat.receiving"
                  @click="chat.retry(line.id)"
                >
                  <RotateCcw />
                  다시 묻기
                </Button>
              </div>
            </template>
          </li>
        </ol>
      </div>

      <form
        class="relative flex shrink-0 items-end gap-2 border-t border-border p-3"
        @submit.prevent="send()"
      >
        <ul
          v-if="mentionOpen"
          id="chat-mentions"
          role="listbox"
          aria-label="작업 고르기"
          class="absolute inset-x-3 bottom-full z-10 mb-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <li
            v-for="(t, i) in candidates"
            :id="`chat-mention-${i}`"
            :key="t.id"
            role="option"
            :aria-selected="i === picked"
            class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm"
            :class="i === picked ? 'bg-accent text-accent-foreground' : ''"
            @mousedown.prevent="pickMention(i)"
            @mouseenter="picked = i"
          >
            <span class="shrink-0 font-mono text-xs text-muted-foreground">{{ t.key }}</span>
            <span class="min-w-0 grow truncate">{{ t.title }}</span>
            <span class="shrink-0 text-xs text-muted-foreground">{{
              taskStatusLabel(t.status)
            }}</span>
          </li>
        </ul>
        <Textarea
          ref="input"
          v-model="draft"
          rows="1"
          maxlength="2000"
          aria-label="질문"
          placeholder="질문을 입력하세요 · @ 로 작업 언급"
          class="max-h-32 min-h-9 resize-none"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="chat-mentions"
          :aria-expanded="mentionOpen"
          :aria-activedescendant="mentionOpen ? `chat-mention-${picked}` : undefined"
          @keydown="onInputKeydown"
          @input="trackMention"
          @click="trackMention"
          @keyup="onInputKeyup"
          @blur="mention = null"
        />
        <Button
          v-if="chat.receiving"
          type="button"
          variant="outline"
          size="icon"
          aria-label="멈추기"
          class="shrink-0"
          @click="chat.stop()"
        >
          <Square class="fill-current" />
        </Button>
        <Button
          v-else
          type="submit"
          size="icon"
          aria-label="보내기"
          class="shrink-0"
          :disabled="!draft.trim() || !!chat.registering"
        >
          <ArrowUp />
        </Button>
      </form>
    </section>
  </template>
</template>
