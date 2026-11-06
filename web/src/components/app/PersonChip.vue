<script setup lang="ts">
import MemberAvatar from '@/components/app/MemberAvatar.vue'

/* 사람 한 명 — 동그라미(사진 또는 첫 글자) + 이름. 이력 곳곳에 같은 모양으로 나온다. */
defineProps<{ name: string; src?: string | null }>()
</script>

<template>
  <span class="inline-flex h-6 items-center gap-1.5 text-[13px]">
    <MemberAvatar :name="name" :src="src" tone="brand" />
    {{ name }}
  </span>
</template>
