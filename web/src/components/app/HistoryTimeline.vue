<script setup lang="ts">
import { ref } from 'vue'
import { useNow } from '@vueuse/core'
import PersonChip from '@/components/app/PersonChip.vue'
import { dayTime, relativeTime } from '@/lib/date'
import { clipText, type HistoryChangeView, type HistoryEntryView } from '@/lib/history'

/* 변경 이력 줄 목록 — 작업 · 테스트 상세가 같이 쓴다. 화면 말은 lib/history 가 이미 만들어 넘긴다.
   줄마다 사람 · 언제, 그 아래 칸마다 '칸 이름: 전 → 후'. 긴 글은 줄여 보이고 눌러 펼친다 */
defineProps<{ entries: HistoryEntryView[] }>()

/* '5분 전' 이 그대로 굳지 않게 1분마다 다시 잰다 */
const now = useNow({ interval: 60_000 })

/** 펼친 긴 글 — 줄 id + 칸 */
const opened = ref(new Set<string>())
const keyOf = (entryId: string, c: HistoryChangeView) => `${entryId}:${c.field}`
const isOpen = (entryId: string, c: HistoryChangeView) => opened.value.has(keyOf(entryId, c))

function toggle(entryId: string, c: HistoryChangeView) {
  const next = new Set(opened.value)
  const key = keyOf(entryId, c)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  opened.value = next
}

/** 긴 칸이 줄여 보이는 중인가 */
const clipped = (c: HistoryChangeView) =>
  c.long && (clipText(c.from ?? '').clipped || clipText(c.to ?? '').clipped)

/** 한쪽 값 — 긴 칸을 펼치지 않았으면 줄인 글 */
const shown = (entryId: string, c: HistoryChangeView, text: string) =>
  c.long && !isOpen(entryId, c) ? clipText(text).text : text
</script>

<template>
  <ol class="flex flex-col">
    <li
      v-for="e in entries"
      :key="e.id"
      :data-history-entry="e.id"
      class="flex flex-col gap-1 border-b border-border py-2 first:pt-0 last:border-b-0"
    >
      <div class="flex items-center gap-2">
        <PersonChip v-if="e.who" :name="e.who" />
        <time
          class="text-xs text-muted-foreground"
          :datetime="e.changedAt"
          :title="dayTime(e.changedAt)"
          >{{ relativeTime(e.changedAt, now) }}</time
        >
      </div>
      <ul class="flex flex-col gap-0.5 pl-1">
        <li
          v-for="c in e.changes"
          :key="c.field"
          class="text-xs leading-relaxed break-words"
          :data-history-field="c.field"
        >
          <template v-if="c.from !== undefined && c.to !== undefined">
            <span class="text-muted-foreground">{{ c.label }}: </span>
            <span class="whitespace-pre-wrap">{{ shown(e.id, c, c.from) }}</span>
            <span class="text-muted-foreground"> → </span>
            <span class="whitespace-pre-wrap">{{ shown(e.id, c, c.to) }}</span>
            <button
              v-if="clipped(c)"
              type="button"
              class="ml-1.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              :aria-expanded="isOpen(e.id, c)"
              data-history-more
              @click="toggle(e.id, c)"
            >
              {{ isOpen(e.id, c) ? '접기' : '펼치기' }}
            </button>
          </template>
          <template v-else-if="c.value !== undefined">
            <span class="text-muted-foreground">{{ c.label }}: </span>
            <span>{{ c.value }}</span>
          </template>
          <span v-else>{{ c.label }}</span>
        </li>
      </ul>
    </li>
  </ol>
</template>
