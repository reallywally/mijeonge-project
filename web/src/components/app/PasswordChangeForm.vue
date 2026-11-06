<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { passwordProblem } from '@/lib/member'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'

/* 내 비밀번호 바꾸기 칸(현재 · 새 · 새 확인) — 내 이름 메뉴의 창과 마이페이지가 같이 쓴다.
   버튼은 놓이는 자리마다 모양이 달라 #actions 슬롯으로 받는다. 바꾸면 서버가 이 세션 말고 내 다른 세션을 끊는다 */
const props = withDefaults(defineProps<{ idPrefix?: string }>(), { idPrefix: 'pw' })
const emit = defineEmits<{ (e: 'changed'): void }>()
defineSlots<{
  actions(props: { canSubmit: boolean; saving: boolean; submit: () => Promise<void> }): unknown
}>()

const auth = useAuthStore()

const current = ref('')
const next = ref('')
const confirm = ref('')
const saving = ref(false)

/* 새 비밀번호는 다 적은 뒤에만 탓한다 — 치는 중에 빨간 글씨가 먼저 나오지 않게 */
const nextHint = computed(() => (next.value ? passwordProblem(next.value) : null))
const confirmHint = computed(() =>
  confirm.value && confirm.value !== next.value ? '새 비밀번호가 서로 다릅니다.' : null,
)

const canSubmit = computed(
  () =>
    current.value !== '' &&
    passwordProblem(next.value) === null &&
    next.value === confirm.value &&
    !saving.value,
)

const id = (name: string) => `${props.idPrefix}-${name}`

async function submit() {
  if (!canSubmit.value) return
  saving.value = true
  try {
    await auth.changePassword(current.value, next.value)
    toast.success('비밀번호를 바꿨습니다. 다른 기기의 로그인은 끊겼습니다.')
    current.value = ''
    next.value = ''
    confirm.value = ''
    emit('changed')
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="flex flex-col gap-3.5" data-password-form @submit.prevent="submit">
    <div class="flex flex-col gap-2">
      <Label :for="id('current')">현재 비밀번호</Label>
      <Input
        :id="id('current')"
        v-model="current"
        type="password"
        autocomplete="current-password"
      />
    </div>
    <div class="flex flex-col gap-2">
      <Label :for="id('next')">새 비밀번호</Label>
      <Input :id="id('next')" v-model="next" type="password" autocomplete="new-password" />
      <p v-if="nextHint" class="text-xs text-destructive">{{ nextHint }}</p>
      <p v-else class="text-xs text-muted-foreground">10자 이상 적어 주세요.</p>
    </div>
    <div class="flex flex-col gap-2">
      <Label :for="id('confirm')">새 비밀번호 확인</Label>
      <Input :id="id('confirm')" v-model="confirm" type="password" autocomplete="new-password" />
      <p v-if="confirmHint" class="text-xs text-destructive">{{ confirmHint }}</p>
    </div>
    <!-- Enter 로 보내려면 폼 안에 submit 버튼이 있어야 한다 -->
    <button type="submit" class="hidden" />
    <slot name="actions" v-bind="{ canSubmit, saving, submit }" />
  </form>
</template>
