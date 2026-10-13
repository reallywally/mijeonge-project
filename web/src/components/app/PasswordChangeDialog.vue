<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { passwordProblem } from '@/lib/member'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'

/* 내 비밀번호 바꾸기 — 내 이름 메뉴에서 연다. 바꾸면 서버가 이 세션 말고 내 다른 세션을 끊는다 */
const open = defineModel<boolean>('open', { required: true })

const auth = useAuthStore()

const current = ref('')
const next = ref('')
const confirm = ref('')
const saving = ref(false)

watch(open, (isOpen) => {
  if (isOpen) {
    current.value = ''
    next.value = ''
    confirm.value = ''
  }
})

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

async function submit() {
  if (!canSubmit.value) return
  saving.value = true
  try {
    await auth.changePassword(current.value, next.value)
    toast.success('비밀번호를 바꿨습니다.')
    open.value = false
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>비밀번호 바꾸기</DialogTitle>
        <DialogDescription class="text-pretty">
          바꾸면 이 브라우저 말고 다른 곳에 로그인된 세션은 모두 끊깁니다.
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-3.5 py-1" @submit.prevent="submit">
        <div class="flex flex-col gap-2">
          <Label for="pw-current">현재 비밀번호</Label>
          <Input
            id="pw-current"
            v-model="current"
            type="password"
            autocomplete="current-password"
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="pw-next">새 비밀번호</Label>
          <Input id="pw-next" v-model="next" type="password" autocomplete="new-password" />
          <p v-if="nextHint" class="text-xs text-destructive">{{ nextHint }}</p>
          <p v-else class="text-xs text-muted-foreground">10자 이상 적어 주세요.</p>
        </div>
        <div class="flex flex-col gap-2">
          <Label for="pw-confirm">새 비밀번호 확인</Label>
          <Input id="pw-confirm" v-model="confirm" type="password" autocomplete="new-password" />
          <p v-if="confirmHint" class="text-xs text-destructive">{{ confirmHint }}</p>
        </div>
        <!-- Enter 로 보내려면 폼 안에 submit 버튼이 있어야 한다 -->
        <button type="submit" class="hidden" />
      </form>

      <DialogFooter>
        <Button variant="outline" @click="open = false">취소</Button>
        <Button :disabled="!canSubmit" @click="submit">
          <Loader2 v-if="saving" class="animate-spin" />
          바꾸기
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
