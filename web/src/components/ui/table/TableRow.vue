<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <tr :class="cn('border-b border-border/70 transition-colors hover:bg-muted/60 data-[state=selected]:bg-brand-soft', props.class)">
    <slot />
  </tr>
</template>
