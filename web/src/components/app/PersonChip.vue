<script setup lang="ts">
/* 담당자 한 명 — 이름 첫 글자 동그라미 + 이름. 이력 곳곳에 같은 모양으로 나온다. */
defineProps<{ name: string }>()
</script>

<template>
  <span class="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-secondary py-0.5 pr-2.5 pl-1 text-xs">
    <span class="flex size-[18px] items-center justify-center rounded-full bg-background text-[10px] text-muted-foreground">
      {{ name.charAt(0) }}
    </span>
    {{ name }}
  </span>
</template>
