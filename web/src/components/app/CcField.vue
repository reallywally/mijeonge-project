<script setup lang="ts">
import { computed } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import MemberAvatar from '@/components/app/MemberAvatar.vue'
import MemberPicker from '@/components/app/MemberPicker.vue'
import { useDataStore } from '@/stores/data'

/* 안건 · 테스트 속성 칸의 참조 한 줄 — 알아야 하는 사람 여럿 (docs/api/cc.md). 권한은 주지 않는다.
   고를 수 있는 것은 이 프로젝트의 활성 멤버 중 아직 안 고른 사람. 이미 붙어 있다가 빠진(비활성 · 부여 해제)
   사람은 흐린 칩으로 남고, 고칠 때도 그대로 보낸다 — 서버는 이미 걸린 id 를 받는다(API.md Q68). × 로는 뺄 수 있다.
   '+ 참조' 를 누르면 이름으로 찾아 고르고, 고른 뒤에도 목록이 열린 채라 잇달아 고를 수 있다.
   readonly 면 칩만 보인다 — 고칠 권한이 없는 안건 · 테스트 */
defineProps<{ readonly?: boolean }>()
const ccIds = defineModel<string[]>({ required: true })

const data = useDataStore()

const eligible = (id: string) => data.assignable.some((m) => m.id === id)
const chips = computed(() =>
  ccIds.value.map((id) => ({
    id,
    name: data.memberName(id) ?? '알 수 없음',
    avatarUrl: data.memberAvatar(id),
    stale: !eligible(id),
  })),
)
const choices = computed(() => data.assignable.filter((m) => !ccIds.value.includes(m.id)))

const add = (id: string | null) => id && (ccIds.value = [...ccIds.value, id])
const remove = (id: string) => (ccIds.value = ccIds.value.filter((x) => x !== id))
</script>

<template>
  <div class="flex min-h-9 items-start gap-2 py-1" data-cc-field>
    <dt class="w-[72px] shrink-0 pt-1.5 text-xs text-muted-foreground">참조</dt>
    <dd class="flex min-w-0 grow flex-wrap items-center gap-1">
      <span
        v-for="c in chips"
        :key="c.id"
        class="inline-flex h-[26px] items-center gap-1 rounded-full bg-secondary py-0.5 pl-1 text-xs"
        :class="[c.stale ? 'text-muted-foreground' : '', readonly ? 'pr-2' : 'pr-1']"
        :data-cc="c.id"
      >
        <MemberAvatar :name="c.name" :src="c.avatarUrl" :size="18" tone="inset" />
        {{ c.name }}
        <button
          v-if="!readonly"
          type="button"
          class="flex size-[18px] items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
          :aria-label="`참조에서 ${c.name} 빼기`"
          data-cc-remove
          @click="remove(c.id)"
        >
          <X class="size-3" />
        </button>
      </span>

      <span v-if="readonly && ccIds.length === 0" class="pt-1 pl-2 text-xs text-muted-foreground"
        >없음</span
      >
      <MemberPicker
        v-if="!readonly"
        label="참조 더하기"
        :exclude="ccIds"
        keep-open
        hide-chevron
        :disabled="choices.length === 0"
        trigger-class="h-[26px] w-auto gap-1 rounded-full border-transparent bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:border-transparent hover:bg-accent hover:text-foreground"
        data-cc-add
        @pick="add"
      >
        <template #trigger>
          <span class="flex items-center gap-1"><Plus class="size-3" />참조</span>
        </template>
      </MemberPicker>
    </dd>
  </div>
</template>
