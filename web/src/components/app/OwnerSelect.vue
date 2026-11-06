<script setup lang="ts">
import { computed } from 'vue'
import MemberAvatar from '@/components/app/MemberAvatar.vue'
import MemberPicker from '@/components/app/MemberPicker.vue'
import { cn } from '@/lib/utils'
import { useDataStore } from '@/stores/data'

/* 담당자 고르기 — 작업 · 안건 · 테스트의 속성 칸과 회의록 검토가 같이 쓴다(미정 + 고른 프로젝트의 활성 멤버, 이름으로 찾기).
   속성 패널은 triggerClass 로 ghost 모양을 준다.
   AI 가 사람을 못 정해 부른 말(hint)만 남겼으면 비어 있는 동안 "회의록: 김 책임 — 골라 주세요" 를 띄운다.
   selfAssign 이면 칸 오른쪽에 [나에게 할당] — 내가 그 프로젝트의 활성 멤버이고 아직 내가 담당이 아닐 때만 선다 */
const props = defineProps<{
  label: string
  hint?: string
  triggerClass?: string
  disabled?: boolean
  selfAssign?: boolean
}>()
const ownerId = defineModel<string | null>({ required: true })

const data = useDataStore()

const ownerName = computed(() => data.memberName(ownerId.value))
const hinted = computed(() => ownerId.value === null && !!props.hint)

const me = computed(() => data.currentMemberId)
const canAssignMe = computed(
  () =>
    props.selfAssign &&
    !props.disabled &&
    me.value !== null &&
    ownerId.value !== me.value &&
    data.assignable.some((m) => m.id === me.value),
)
</script>

<template>
  <div class="flex min-w-0 items-center gap-1">
    <MemberPicker
      :label="label"
      :selected-id="ownerId"
      allow-none
      :disabled="disabled"
      :trigger-class="cn('min-w-0 bg-background text-xs', hinted && 'border-dashed', triggerClass)"
      :data-owner-hint="hinted ? hint : undefined"
      @pick="(id) => (ownerId = id)"
    >
      <template #trigger>
        <span class="flex min-w-0 items-center gap-2">
          <MemberAvatar
            :name="ownerName"
            :src="data.memberAvatar(ownerId)"
            :size="22"
            :class="ownerName ? 'text-foreground' : ''"
          />
          <span class="truncate" :class="ownerName ? '' : 'text-muted-foreground'">
            {{ ownerName ?? (hinted ? `회의록: ${hint} — 골라 주세요` : '미정') }}
          </span>
        </span>
      </template>
    </MemberPicker>
    <button
      v-if="canAssignMe"
      type="button"
      class="shrink-0 rounded-md px-1.5 py-1 text-xs whitespace-nowrap text-primary hover:bg-accent"
      data-assign-me
      @click="ownerId = me"
    >
      나에게 할당
    </button>
  </div>
</template>
