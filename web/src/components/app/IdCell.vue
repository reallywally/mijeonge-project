<script setup lang="ts">
import { computed } from 'vue'
import { toast } from 'vue-sonner'

const props = defineProps<{ id: string }>()

const short = computed(() => props.id.slice(0, 8))

async function copy() {
  try {
    // 비보안 컨텍스트(http 로 연 사내 주소)에서는 clipboard 가 아예 없다
    if (!navigator.clipboard) throw new Error('no clipboard')
    await navigator.clipboard.writeText(props.id)
    toast.success('ID 를 복사했습니다')
  } catch {
    toast.error('ID 를 복사하지 못했습니다')
  }
}
</script>

<template>
  <!-- 줄을 누르면 상세가 열리는 표가 많아 복사 클릭이 줄까지 올라가지 않게 막는다 -->
  <button
    type="button"
    data-id-cell
    :title="id"
    :aria-label="`ID ${id} 복사`"
    class="cursor-copy rounded-sm font-mono text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    @click.stop="copy"
  >
    {{ short }}
  </button>
</template>
