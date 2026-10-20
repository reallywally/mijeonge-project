<script setup lang="ts">
import { computed, watch } from 'vue'
import { ArrowRight, Check, Loader2, Sparkles } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useDependencySuggestStore } from '@/stores/dependencySuggest'
import { useTaskStore } from '@/stores/task'

/* [AI 선행 관계 찾기] 의 제안 창 — 서버는 저장하지 않는다. 줄마다 이유를 읽고 [적용](= 선행 걸기) · [버리기].
   추측은 틀릴 수 있어 사람이 고른 것만 남는다 (Q49). 열 때마다 새로 묻고, 닫으면 버린다 */
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ (e: 'open-task', id: string): void }>()

const suggest = useDependencySuggestStore()
const taskStore = useTaskStore()

watch(
  open,
  (isOpen) => {
    if (isOpen) void suggest.load()
    else suggest.reset()
  },
  { immediate: true },
)

const taskOf = (id: string) => taskStore.tasks.find((t) => t.id === id)
const pendingCount = computed(
  () => suggest.rows.filter((r) => r.state === 'pending' || r.state === 'failed').length,
)
const applying = computed(() => suggest.rows.some((r) => r.state === 'applying'))

function openTask(id: string) {
  open.value = false
  emit('open-task', id)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[640px]">
      <DialogHeader>
        <DialogTitle>AI 선행 관계 찾기</DialogTitle>
        <DialogDescription class="text-pretty">
          아직 안 끝난 작업의 제목 · 내용 · 기간을 보고 빠진 선행 관계를 제안합니다. 적용한 것만
          남습니다.
        </DialogDescription>
      </DialogHeader>

      <div
        v-if="suggest.status === 'loading'"
        class="flex items-center gap-2 py-6 text-sm text-muted-foreground"
        data-suggest-loading
      >
        <Loader2 class="size-4 animate-spin" />
        작업을 읽고 선행 관계를 찾는 중
      </div>

      <div v-else-if="suggest.status === 'error'" class="flex flex-col gap-3 py-2">
        <p class="text-sm text-destructive">{{ suggest.error }}</p>
        <Button variant="outline" size="sm" class="self-start" @click="suggest.load()">
          다시 찾기
        </Button>
      </div>

      <div v-else-if="suggest.status === 'ready'" class="flex flex-col gap-2">
        <p v-if="suggest.rows.length === 0" class="py-4 text-sm text-muted-foreground">
          더 걸 만한 선행 관계를 찾지 못했습니다.
        </p>
        <ul class="flex max-h-[420px] flex-col gap-2 overflow-y-auto">
          <li
            v-for="row in suggest.rows"
            :key="`${row.suggestion.dependsOnId}>${row.suggestion.taskId}`"
            class="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2.5"
            :class="row.state === 'applied' ? 'bg-muted/50' : ''"
            data-suggestion
          >
            <div class="flex items-center gap-2 text-sm">
              <button
                type="button"
                class="flex min-w-0 items-center gap-1.5 underline-offset-4 hover:underline"
                @click="openTask(row.suggestion.dependsOnId)"
              >
                <span class="shrink-0 text-xs text-muted-foreground">{{
                  taskOf(row.suggestion.dependsOnId)?.key
                }}</span>
                <span class="truncate">{{ taskOf(row.suggestion.dependsOnId)?.title }}</span>
              </button>
              <ArrowRight class="size-3.5 shrink-0 text-muted-foreground" />
              <button
                type="button"
                class="flex min-w-0 items-center gap-1.5 underline-offset-4 hover:underline"
                @click="openTask(row.suggestion.taskId)"
              >
                <span class="shrink-0 text-xs text-muted-foreground">{{
                  taskOf(row.suggestion.taskId)?.key
                }}</span>
                <span class="truncate">{{ taskOf(row.suggestion.taskId)?.title }}</span>
              </button>
              <span class="grow" />
              <span
                v-if="row.state === 'applied'"
                class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
              >
                <Check class="size-3.5" />
                적용함
              </span>
              <template v-else>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 shrink-0"
                  :disabled="row.state === 'applying'"
                  @click="suggest.discard(row)"
                >
                  버리기
                </Button>
                <Button
                  size="sm"
                  class="h-7 shrink-0"
                  :disabled="row.state === 'applying'"
                  @click="suggest.apply(row)"
                >
                  <Loader2 v-if="row.state === 'applying'" class="animate-spin" />
                  적용
                </Button>
              </template>
            </div>
            <p class="text-xs leading-relaxed text-muted-foreground">
              {{ row.suggestion.reason }}
            </p>
            <p v-if="row.state === 'failed'" class="text-xs text-destructive" data-suggest-error>
              {{ row.error }}
            </p>
          </li>
        </ul>
        <p v-if="suggest.truncated" class="text-xs text-muted-foreground">
          안 끝난 작업이 많아 기한이 이른 것부터 일부만 봤습니다.
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">닫기</Button>
        <Button
          :disabled="suggest.status !== 'ready' || pendingCount === 0 || applying"
          @click="suggest.applyAll()"
        >
          <Sparkles />
          모두 적용
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
