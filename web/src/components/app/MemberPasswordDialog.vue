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
import { useAdminStore } from '@/stores/admin'
import type { MemberAccount } from '@/types/domain'

/* 비밀번호 새로 걸기 — 잊었을 때 · 처음 로그인시킬 때. 걸면 그 사람의 세션이 모두 끊긴다 */
const props = defineProps<{ account: MemberAccount | null }>()
const open = defineModel<boolean>('open', { required: true })

const admin = useAdminStore()

const password = ref('')
const saving = ref(false)

watch(open, (isOpen) => {
  if (isOpen) password.value = ''
})

const hint = computed(() => (password.value ? passwordProblem(password.value) : null))
const canSubmit = computed(
  () => props.account !== null && passwordProblem(password.value) === null && !saving.value,
)

async function submit() {
  if (!canSubmit.value || !props.account) return
  saving.value = true
  const ok = await admin.setPassword(props.account.id, password.value)
  saving.value = false
  if (ok) {
    toast.success(`${props.account.name}의 비밀번호를 새로 걸었습니다.`)
    open.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[420px]">
      <DialogHeader>
        <DialogTitle>비밀번호 새로 걸기</DialogTitle>
        <DialogDescription class="text-pretty">
          {{ account?.name }}의 비밀번호를 바꿉니다. 로그인해 있던 곳은 모두 끊깁니다.
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-2 py-1" @submit.prevent="submit">
        <Label for="member-password">새 비밀번호</Label>
        <Input
          id="member-password"
          v-model="password"
          type="password"
          autocomplete="new-password"
        />
        <p v-if="hint" class="text-xs text-destructive">{{ hint }}</p>
        <p v-else class="text-xs text-muted-foreground">10자 이상. 본인에게 따로 알려 주세요.</p>
      </form>

      <DialogFooter>
        <Button variant="outline" @click="open = false">취소</Button>
        <Button :disabled="!canSubmit" @click="submit">
          <Loader2 v-if="saving" class="animate-spin" />
          걸기
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
