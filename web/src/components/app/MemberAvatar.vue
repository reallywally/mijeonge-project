<script setup lang="ts">
import { computed, ref, watch, type HTMLAttributes } from 'vue'
import { avatarInitial, safeAvatarUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'

/* 사람 동그라미 하나 — 사진이 있으면 사진, 없으면 이름 첫 글자 (docs/api/me.md). 사진이 안 열리면(404 · 깨짐)
   첫 글자로 돌아간다. 이름은 늘 옆에 따로 적히므로 동그라미는 읽어 주지 않는다(aria-hidden).
   tone 은 놓이는 바탕에 맞춘 색 — brand(사람 칩 · 칸반), neutral(고르기 · 담당자 칸), inset(회색 칩 안) */
const props = withDefaults(
  defineProps<{
    name: string | null
    src?: string | null
    /** 지름(px) */
    size?: number
    tone?: 'brand' | 'neutral' | 'inset'
    class?: HTMLAttributes['class']
  }>(),
  { src: null, size: 20, tone: 'neutral', class: undefined },
)

const failed = ref(false)
watch(
  () => props.src,
  () => (failed.value = false),
)

const url = computed(() => (failed.value ? null : safeAvatarUrl(props.src)))
/* 글자는 지름의 반쯤 — 작은 동그라미에서도 10px 아래로는 안 내린다 */
const box = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.max(10, Math.round(props.size * 0.46))}px`,
}))
</script>

<template>
  <span
    aria-hidden="true"
    data-avatar
    :data-avatar-photo="url ? '' : undefined"
    :style="box"
    :class="
      cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full leading-none select-none',
        tone === 'brand' && 'bg-brand-soft font-semibold text-primary',
        tone === 'neutral' && 'bg-secondary text-muted-foreground',
        tone === 'inset' && 'bg-background text-muted-foreground',
        !name && 'font-normal text-muted-foreground',
        props.class,
      )
    "
  >
    <img
      v-if="url"
      :src="url"
      alt=""
      class="size-full object-cover"
      draggable="false"
      @error="failed = true"
    />
    <template v-else>{{ avatarInitial(name) }}</template>
  </span>
</template>
