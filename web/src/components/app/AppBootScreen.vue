<script setup lang="ts">
import { computed } from 'vue'
import { Loader2, RotateCw, WifiOff } from 'lucide-vue-next'
import { isUnreachable } from '@/api'
import { Button } from '@/components/ui/button'
import { useDataStore } from '@/stores/data'

/* 앱이 처음 뜰 때 — 프로젝트 · 멤버 · 첫 스냅샷을 받는 동안과 그게 실패했을 때 화면 전체를 덮는다 */
const emit = defineEmits<{ (e: 'retry'): void }>()

const data = useDataStore()

const unreachable = computed(() => isUnreachable(data.bootError))
</script>

<template>
  <div class="flex h-screen flex-col items-center justify-center gap-4 bg-background px-6">
    <template v-if="data.status === 'loading'">
      <Loader2 class="size-5 animate-spin text-muted-foreground" />
      <p class="text-sm text-muted-foreground">불러오는 중…</p>
    </template>
    <template v-else>
      <WifiOff class="size-6 text-muted-foreground" />
      <div class="flex flex-col items-center gap-1.5 text-center">
        <h1 class="text-lg font-semibold tracking-tight">
          {{ unreachable ? '서버에 연결할 수 없습니다' : '데이터를 불러오지 못했습니다' }}
        </h1>
        <p class="text-sm text-muted-foreground text-pretty">
          {{
            unreachable
              ? '서버가 떠 있는지 확인한 뒤 다시 시도해 주세요.'
              : (data.bootError?.message ?? '잠시 뒤 다시 시도해 주세요.')
          }}
        </p>
      </div>
      <Button variant="outline" @click="emit('retry')">
        <RotateCw class="size-4" />
        다시 시도
      </Button>
    </template>
  </div>
</template>
