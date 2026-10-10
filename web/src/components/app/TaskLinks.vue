<script setup lang="ts">
import { X } from 'lucide-vue-next'
import SearchPicker from '@/components/app/SearchPicker.vue'
import ThreadStateBadge from '@/components/app/ThreadStateBadge.vue'
import type { TaskThreadRow, Thread } from '@/types/domain'

/* 작업에 거는 안건 — 작업 상세와 작업 추가가 같이 쓴다. 위의 검색 칸으로 찾아 걸고, 걸린 것은 표로 본다.
   거는 일은 부모가 한다 — 상세는 바로 링크를 만들고, 추가는 골라 두었다가 만들 때 건다. */
withDefaults(
  defineProps<{
    threads: TaskThreadRow[]
    /** 아직 안 건 것 — 검색 칸이 이 안에서 찾는다 */
    threadChoices: Thread[]
    /** 제목을 눌러 그 안건으로 갈 수 있는지 — 아직 없는 작업을 만드는 중에는 못 간다 */
    navigable?: boolean
  }>(),
  { navigable: true },
)
const emit = defineEmits<{
  (e: 'link-thread' | 'unlink-thread' | 'open-thread', id: string): void
}>()
</script>

<template>
  <section class="flex min-w-0 flex-col gap-2.5">
    <div class="flex items-baseline gap-2">
      <span class="text-xs font-medium">연관 안건</span>
      <span class="text-xs text-muted-foreground">{{ threads.length }}건</span>
      <span class="grow" />
      <span class="truncate text-xs text-muted-foreground">이 작업을 하다가 정할 것</span>
    </div>

    <SearchPicker
      :items="threadChoices"
      :text="(t) => t.title"
      :key-of="(t) => t.id"
      placeholder="안건 제목으로 찾기"
      empty-label="연결할 수 있는 안건을 모두 연결했습니다"
      @pick="(t) => emit('link-thread', t.id)"
    >
      <template #item="{ item }">
        <span class="min-w-0 grow truncate">{{ item.title }}</span>
        <ThreadStateBadge :state="item.state" />
      </template>
    </SearchPicker>

    <div
      v-if="threads.length"
      class="flex flex-col overflow-hidden rounded-md border border-border"
    >
      <div
        class="flex h-8 items-center gap-3 border-b border-border bg-muted/50 px-3 text-xs font-medium tracking-wider text-muted-foreground"
      >
        <span class="min-w-0 grow">안건</span>
        <span class="w-[92px] shrink-0">상태</span>
        <span class="w-7 shrink-0" />
      </div>
      <div
        v-for="row in threads"
        :key="row.thread.id"
        class="group flex min-h-[46px] items-center gap-3 border-b border-border px-3 py-1.5 last:border-b-0"
      >
        <span class="flex min-w-0 grow flex-col gap-0.5">
          <button
            type="button"
            class="min-w-0 truncate text-left text-[13px] underline-offset-4 enabled:hover:underline"
            :disabled="!navigable"
            :title="row.thread.title"
            @click="emit('open-thread', row.thread.id)"
          >
            {{ row.thread.title }}
          </button>
          <span
            class="truncate text-xs text-muted-foreground"
            :title="`${row.line}\n${row.where}`"
            >{{ row.line }}</span
          >
        </span>
        <span class="w-[92px] shrink-0">
          <ThreadStateBadge :state="row.thread.state" :defer-count="row.deferCount" />
        </span>
        <button
          type="button"
          class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
          :aria-label="`${row.thread.title} 연결 해제`"
          title="연결 해제"
          @click="emit('unlink-thread', row.thread.id)"
        >
          <X class="size-3.5" />
        </button>
      </div>
    </div>
    <p v-else class="text-xs text-muted-foreground">연결한 안건이 없습니다.</p>
  </section>
</template>
