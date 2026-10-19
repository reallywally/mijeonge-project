<script setup lang="ts">
import { Badge } from '@/components/ui/badge'
import { dayTime } from '@/lib/date'

/* 두 상태뿐이다 — 대기 · 확인(시각). 시간이 지나도 바뀌지 않는다 (Q40) */
defineProps<{ confirmedAt: string | null }>()
</script>

<template>
  <Badge
    v-if="confirmedAt === null"
    variant="secondary"
    class="shrink-0 font-normal"
    data-check-state="pending"
    >대기</Badge
  >
  <span v-else class="shrink-0 text-xs text-muted-foreground" data-check-state="confirmed">
    <time :datetime="confirmedAt">{{ dayTime(confirmedAt) }}</time> 확인
  </span>
</template>
