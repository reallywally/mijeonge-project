<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ChevronLeft, FileText, FolderOpen, Loader2, Save } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, messageOf } from '@/api'
import { minutesInputProblems, minutesLength, MINUTES_MAX_CHARS } from '@/lib/minutes'
import { useMinutesStore } from '@/stores/minutes'
import type { MinutesInput } from '@/types/domain'

/* 회의록 쓰기 · 고치기 — /minutes/new · /minutes/:minutesId/edit. 고치기는 작성자만.
   양식은 맞추지 않는다 — 붙여넣은 글 · 파일 글을 그대로 남긴다. 쓰다 나가면 묻는다 */
const route = useRoute()
const router = useRouter()
const minutes = useMinutesStore()

const editingId = computed(() =>
  typeof route.params.minutesId === 'string' ? route.params.minutesId : null,
)

const title = ref('')
const meetingDate = ref('')
const body = ref('')
/** 처음 채운 값 — 이것과 다르면 쓰다 만 것이다 */
const initial = ref<MinutesInput>({ title: '', meetingDate: null, body: '' })

const loadState = ref<'loading' | 'ready' | 'missing' | 'forbidden' | 'error'>('ready')
const loadError = ref('')

const input = computed<MinutesInput>(() => ({
  title: title.value,
  meetingDate: meetingDate.value || null,
  body: body.value,
}))

function fill(next: MinutesInput) {
  title.value = next.title
  meetingDate.value = next.meetingDate ?? ''
  body.value = next.body
  initial.value = { ...next }
}

async function load(id: string | null) {
  if (!id) {
    fill({ title: '', meetingDate: null, body: '' })
    loadState.value = 'ready'
    return
  }
  loadState.value = 'loading'
  try {
    const m = await minutes.fetchOne(id)
    if (editingId.value !== id) return
    if (!minutes.canEdit(m)) {
      loadState.value = 'forbidden'
      return
    }
    fill({ title: m.title, meetingDate: m.meetingDate, body: m.body })
    loadState.value = 'ready'
  } catch (e) {
    if (editingId.value !== id) return
    loadState.value = e instanceof ApiError && e.status === 404 ? 'missing' : 'error'
    loadError.value = messageOf(e)
  }
}
watch(editingId, (id) => void load(id), { immediate: true })

const dirty = computed(
  () =>
    loadState.value === 'ready' &&
    (input.value.title !== initial.value.title ||
      input.value.meetingDate !== initial.value.meetingDate ||
      input.value.body !== initial.value.body),
)

const LEAVE_MESSAGE = '쓰던 회의록은 저장되지 않습니다. 이 화면을 떠날까요?'
/** 저장하고 떠날 때는 묻지 않는다 */
let leaving = false

onBeforeRouteLeave(() => {
  if (leaving || !dirty.value) return true
  return window.confirm(LEAVE_MESSAGE)
})

/* 새로고침 · 탭 닫기 — 브라우저가 띄우는 기본 확인 창이다 */
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!dirty.value) return
  e.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

const length = computed(() => minutesLength(body.value))
const tooLong = computed(() => length.value > MINUTES_MAX_CHARS)
const problems = computed(() => minutesInputProblems(input.value))
/** 제목이 너무 긴 것만 바로 띄운다 — 빈 칸은 [저장] 이 막는 것으로 충분하다 */
const titleProblem = computed(() => (title.value.trim() ? (problems.value.title ?? '') : ''))

const saving = ref(false)
const canSave = computed(
  () => loadState.value === 'ready' && !saving.value && Object.keys(problems.value).length === 0,
)

/** 쓴 본문을 바꾸기 전에 묻는다 — 같은 글이거나 비었으면 묻지 않는다 */
function replaceBody(next: string) {
  const now = body.value
  if (now.trim() && now !== next && !window.confirm('지금 쓴 본문을 바꿀까요?')) return
  body.value = next
}

const fileInput = ref<HTMLInputElement | null>(null)
const fileError = ref('')

async function openFile(e: Event) {
  const el = e.target as HTMLInputElement
  const file = el.files?.[0]
  el.value = ''
  if (!file) return
  fileError.value = ''
  if (!/\.(txt|md)$/i.test(file.name)) {
    fileError.value = '.txt · .md 파일만 열 수 있습니다.'
    return
  }
  try {
    replaceBody(await file.text())
  } catch {
    fileError.value = '파일을 읽지 못했습니다.'
  }
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  const id = editingId.value
  let target: string | null = null
  if (id) {
    /* 고치기는 보낸 칸만 바꾼다 — 바뀐 칸만 보낸다 */
    const patch: Partial<MinutesInput> = {}
    if (input.value.title !== initial.value.title) patch.title = input.value.title
    if (input.value.meetingDate !== initial.value.meetingDate)
      patch.meetingDate = input.value.meetingDate
    if (input.value.body !== initial.value.body) patch.body = input.value.body
    const ok = Object.keys(patch).length === 0 || (await minutes.update(id, patch))
    target = ok ? id : null
  } else {
    target = await minutes.create(input.value)
  }
  saving.value = false
  if (!target) return
  leaving = true
  await router.replace(`/minutes/${target}`)
}

function cancel() {
  void router.push(editingId.value ? `/minutes/${editingId.value}` : '/minutes')
}
</script>

<template>
  <AppShell>
    <div class="flex h-11 shrink-0 items-center gap-2.5 border-b border-border bg-card px-6">
      <RouterLink
        to="/minutes"
        class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft class="size-3.5" />
        회의록
      </RouterLink>
    </div>

    <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
      <div class="flex w-full max-w-[900px] flex-col gap-4 pb-[26px]">
        <h1 class="text-[22px] font-bold tracking-[-0.025em]">
          {{ editingId ? '회의록 고치기' : '새 회의록' }}
        </h1>

        <div
          v-if="loadState === 'loading'"
          class="flex h-[110px] items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 class="size-4 animate-spin" />
          회의록을 받는 중입니다.
        </div>
        <p
          v-else-if="loadState !== 'ready'"
          class="rounded-lg border border-border px-[17px] py-3 text-sm text-muted-foreground"
          role="alert"
          data-minutes-load-error
        >
          {{
            loadState === 'missing'
              ? '회의록을 찾을 수 없습니다. 지워졌거나 볼 수 없는 회의록입니다.'
              : loadState === 'forbidden'
                ? '회의록은 쓴 사람만 고칠 수 있습니다.'
                : loadError
          }}
        </p>

        <form
          v-else
          class="flex flex-col gap-4 rounded-lg border border-border bg-card px-[17px] py-[15px] shadow-sm"
          @submit.prevent="save"
        >
          <div class="grid grid-cols-[1fr_180px] gap-3">
            <div class="flex flex-col gap-1.5">
              <Label for="minutes-title">제목</Label>
              <Input
                id="minutes-title"
                v-model="title"
                placeholder="예: 10월 셋째 주 주간 회의"
                data-minutes-title
              />
              <p v-if="titleProblem" class="text-xs text-destructive">{{ titleProblem }}</p>
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="minutes-date">회의 날짜</Label>
              <Input id="minutes-date" v-model="meetingDate" type="date" data-minutes-date-input />
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            <Label for="minutes-body">본문</Label>
            <Textarea
              id="minutes-body"
              v-model="body"
              class="h-96 resize-y bg-background leading-relaxed"
              placeholder="회의록을 붙여넣으세요. 양식은 상관없습니다 — 표 · 개조식 · 메모 · 대화록 모두 됩니다."
              data-minutes-text
            />
          </div>
          <input
            ref="fileInput"
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            class="hidden"
            data-minutes-file
            @change="openFile"
          />
          <p v-if="fileError" class="text-xs text-destructive" role="alert">{{ fileError }}</p>

          <div class="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" @click="fileInput?.click()">
              <FolderOpen class="size-4" />
              파일 열기
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-minutes-example
              @click="replaceBody(minutes.example)"
            >
              <FileText class="size-4" />
              예시 넣기
            </Button>
            <div class="grow" />
            <span
              class="text-xs tabular-nums"
              :class="tooLong ? 'text-destructive' : 'text-muted-foreground'"
              data-minutes-count
            >
              {{ length.toLocaleString('ko-KR') }} / {{ MINUTES_MAX_CHARS.toLocaleString('ko-KR') }}
            </span>
            <Button type="button" variant="outline" @click="cancel">취소</Button>
            <Button type="submit" :disabled="!canSave" data-minutes-save>
              <Loader2 v-if="saving" class="size-4 animate-spin" />
              <Save v-else class="size-4" />
              저장
            </Button>
          </div>
        </form>
      </div>
    </div>
  </AppShell>
</template>
