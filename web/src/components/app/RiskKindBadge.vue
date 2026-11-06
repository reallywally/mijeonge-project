<script setup lang="ts">
import { RISK_KIND_LABEL } from '@/lib/risk'
import type { RiskKind } from '@/types/domain'

/* 리스크 줄의 종류 — 안건 · 작업 · 테스트. 대시보드 목록 · 저장한 분석이 같이 쓴다. 색은 종류 토큰(--kind-*) */
defineProps<{ kind: RiskKind }>()

const TONE: Record<RiskKind, string> = {
  agenda:
    'bg-[color-mix(in_oklab,var(--kind-agenda)_10%,var(--card))] border-[color-mix(in_oklab,var(--kind-agenda)_26%,var(--card))] text-[color-mix(in_oklab,var(--kind-agenda)_80%,var(--foreground))]',
  task: 'bg-[color-mix(in_oklab,var(--kind-task)_10%,var(--card))] border-[color-mix(in_oklab,var(--kind-task)_26%,var(--card))] text-[color-mix(in_oklab,var(--kind-task)_80%,var(--foreground))]',
  test: 'bg-[color-mix(in_oklab,var(--kind-test)_12%,var(--card))] border-[color-mix(in_oklab,var(--kind-test)_30%,var(--card))] text-[color-mix(in_oklab,var(--kind-test)_70%,var(--foreground))]',
}
</script>

<template>
  <span
    class="inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 text-xs font-medium whitespace-nowrap"
    :class="TONE[kind]"
    :data-risk-kind="kind"
    >{{ RISK_KIND_LABEL[kind] }}</span
  >
</template>
