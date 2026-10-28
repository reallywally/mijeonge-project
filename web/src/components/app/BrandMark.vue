<script setup lang="ts">
/* innoFlow 표시 — 세 칸이 차례로 차오르는 흐름. 위 막대 · 로그인 · 첫 화면이 같은 것을 쓴다 */
withDefaults(defineProps<{ size?: 'sm' | 'lg' }>(), { size: 'sm' })
</script>

<template>
  <span class="inline-flex items-center gap-2" :class="size === 'lg' ? 'gap-2.5' : ''">
    <span
      class="flex items-center justify-center bg-primary shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]"
      :class="size === 'lg' ? 'size-8 rounded-[9px]' : 'size-6 rounded-[7px]'"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 16 16"
        class="text-primary-foreground"
        :class="size === 'lg' ? 'size-[18px]' : 'size-3.5'"
      >
        <rect x="2" y="9" width="3" height="5" rx="1" fill="currentColor" opacity="0.55" />
        <rect x="6.5" y="5.5" width="3" height="8.5" rx="1" fill="currentColor" opacity="0.8" />
        <rect x="11" y="2" width="3" height="12" rx="1" fill="currentColor" />
      </svg>
    </span>
    <span class="font-bold tracking-[-0.02em]" :class="size === 'lg' ? 'text-xl' : 'text-[15px]'"
      >innoFlow</span
    >
  </span>
</template>
