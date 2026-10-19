<script setup lang="ts">
import { computed } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CC_MAX } from '@/lib/check'
import { useDataStore } from '@/stores/data'

/* 안건 속성 칸의 참조 한 줄 — 결정을 같이 알아야 할 사람 여럿. 고를 수 있는 것은 이 프로젝트의 활성 멤버.
   이미 붙어 있다가 빠진(비활성 · 부여 해제) 사람은 흐린 칩으로 남는다 — 서버는 그대로 둔 수정을 받고,
   보낼 때 조용히 건너뛴다 (docs/api/check.md '구현에서 메운 것') */
const ccIds = defineModel<string[]>({ required: true })

const data = useDataStore()

const eligible = (id: string) => data.assignable.some((m) => m.id === id)
const chips = computed(() =>
  ccIds.value.map((id) => ({
    id,
    name: data.memberName(id) ?? '알 수 없음',
    stale: !eligible(id),
  })),
)
const choices = computed(() => data.assignable.filter((m) => !ccIds.value.includes(m.id)))
const full = computed(() => ccIds.value.length >= CC_MAX)

const add = (id: string) => (ccIds.value = [...ccIds.value, id])
const remove = (id: string) => (ccIds.value = ccIds.value.filter((x) => x !== id))
</script>

<template>
  <div class="flex min-h-9 items-start gap-2 py-1" data-cc-field>
    <dt class="w-[72px] shrink-0 pt-1.5 text-xs text-muted-foreground">참조</dt>
    <dd class="flex min-w-0 grow flex-wrap items-center gap-1">
      <span
        v-for="c in chips"
        :key="c.id"
        class="inline-flex h-[26px] items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-1 text-xs"
        :class="c.stale ? 'text-muted-foreground' : ''"
        :data-cc="c.id"
      >
        <span
          class="flex size-[18px] items-center justify-center rounded-full bg-background text-[10px] text-muted-foreground"
        >
          {{ c.name.charAt(0) }}
        </span>
        {{ c.name }}
        <button
          type="button"
          class="flex size-[18px] items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
          :aria-label="`참조에서 ${c.name} 빼기`"
          data-cc-remove
          @click="remove(c.id)"
        >
          <X class="size-3" />
        </button>
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="inline-flex h-[26px] items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="full || choices.length === 0"
            aria-label="참조 더하기"
            data-cc-add
          >
            <Plus class="size-3" />
            <span v-if="ccIds.length === 0">없음 — 더하기</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="max-h-72 w-48 overflow-y-auto">
          <DropdownMenuLabel class="text-xs font-normal text-muted-foreground"
            >결정을 같이 알아야 할 사람</DropdownMenuLabel
          >
          <DropdownMenuItem
            v-for="m in choices"
            :key="m.id"
            class="text-xs"
            :data-cc-choice="m.id"
            @select="add(m.id)"
          >
            {{ m.name }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </dd>
  </div>
</template>
