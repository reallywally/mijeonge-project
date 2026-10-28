<script setup lang="ts">
/* 상태 하나 — 색 점 + 말. 작업 · 안건 · 테스트가 같은 모양을 쓴다.
   색은 뜻으로만 고른다: 아직(todo) · 움직이는 중(doing) · 끝(done) · 멈춤(blocked) · 주의(warn) */
export type StatusTone = 'todo' | 'doing' | 'done' | 'blocked' | 'warn' | 'idle'

defineProps<{ tone: StatusTone }>()

const DOT: Record<StatusTone, string> = {
  todo: 'border-[1.5px] border-status-todo bg-transparent',
  doing: 'bg-status-doing',
  done: 'bg-status-done',
  blocked: 'bg-status-blocked',
  warn: 'bg-status-warn',
  idle: 'border-[1.5px] border-dashed border-status-todo bg-transparent',
}
const PILL: Record<StatusTone, string> = {
  todo: 'bg-card border-border text-foreground/80',
  doing:
    'bg-[color-mix(in_oklab,var(--status-doing)_9%,var(--card))] border-[color-mix(in_oklab,var(--status-doing)_22%,var(--card))] text-[color-mix(in_oklab,var(--status-doing)_75%,var(--foreground))]',
  done: 'bg-[color-mix(in_oklab,var(--status-done)_10%,var(--card))] border-[color-mix(in_oklab,var(--status-done)_24%,var(--card))] text-[color-mix(in_oklab,var(--status-done)_70%,var(--foreground))]',
  blocked:
    'bg-[color-mix(in_oklab,var(--status-blocked)_9%,var(--card))] border-[color-mix(in_oklab,var(--status-blocked)_24%,var(--card))] text-[color-mix(in_oklab,var(--status-blocked)_80%,var(--foreground))]',
  warn: 'bg-[color-mix(in_oklab,var(--status-warn)_12%,var(--card))] border-[color-mix(in_oklab,var(--status-warn)_30%,var(--card))] text-[color-mix(in_oklab,var(--status-warn)_55%,var(--foreground))]',
  idle: 'bg-card border-dashed border-border text-muted-foreground',
}
</script>

<template>
  <span
    class="inline-flex h-[22px] items-center gap-1.5 rounded-full border pr-2 pl-1.5 text-xs font-medium whitespace-nowrap"
    :class="PILL[tone]"
    :data-tone="tone"
  >
    <span class="size-[7px] shrink-0 rounded-full" :class="DOT[tone]" aria-hidden="true" />
    <slot />
  </span>
</template>
