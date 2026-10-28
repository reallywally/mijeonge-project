<script setup lang="ts">
/* 담당자 한 명 — 이름 첫 글자 동그라미 + 이름. 이력 곳곳에 같은 모양으로 나온다. */
defineProps<{ name: string }>()
</script>

<template>
  <span class="inline-flex h-6 items-center gap-1.5 text-[13px]">
    <span
      class="flex size-5 items-center justify-center rounded-full bg-brand-soft text-[10.5px] font-semibold text-primary"
    >
      {{ name.charAt(0) }}
    </span>
    {{ name }}
  </span>
</template>
