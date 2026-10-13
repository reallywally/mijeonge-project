<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Loader2 } from 'lucide-vue-next'
import { messageOf } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { safeNext } from '@/lib/access'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'

/* 로그인 — 관리자가 등록한 이메일 + 비밀번호. 가입하는 길은 없다 (docs/api/auth.md).
   들어가면 가려던 주소(?next=)로 돌아간다. 실패 이유는 서버가 가르지 않으니 그 message 를 그대로 띄운다 */
const auth = useAuthStore()
const data = useDataStore()
const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)
const emailField = ref<InstanceType<typeof Input> | null>(null)

const canSubmit = computed(() => email.value.trim() !== '' && password.value !== '' && !busy.value)

onMounted(() => {
  ;(emailField.value?.$el as HTMLInputElement | undefined)?.focus()
})

async function submit() {
  if (!canSubmit.value) return
  busy.value = true
  error.value = ''
  try {
    await auth.login(email.value.trim(), password.value)
  } catch (e) {
    error.value = messageOf(e)
    password.value = ''
    busy.value = false
    return
  }
  /* 로그인한 사람이 볼 수 있는 것으로 처음부터 다시 받는다 */
  await data.retry()
  busy.value = false
  await router.replace(safeNext(route.query.next))
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-muted/50 px-6">
    <div
      class="flex w-full max-w-[380px] flex-col gap-6 rounded-lg border border-border bg-card px-7 py-8 shadow-sm"
    >
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-2.5">
          <div class="size-[19px] rounded-sm border-[1.5px] border-foreground" />
          <span class="text-lg font-semibold">innoFlow</span>
        </div>
        <p class="text-sm text-muted-foreground text-pretty">
          관리자에게 받은 이메일과 비밀번호로 로그인하세요.
        </p>
      </div>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="flex flex-col gap-2">
          <Label for="login-email">이메일</Label>
          <Input
            id="login-email"
            ref="emailField"
            v-model="email"
            type="email"
            autocomplete="username"
            placeholder="name@company.com"
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="login-password">비밀번호</Label>
          <Input
            id="login-password"
            v-model="password"
            type="password"
            autocomplete="current-password"
          />
        </div>
        <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
        <Button type="submit" class="w-full" :disabled="!canSubmit">
          <Loader2 v-if="busy" class="animate-spin" />
          로그인
        </Button>
      </form>

      <p class="text-xs text-muted-foreground text-pretty">
        계정이 없거나 비밀번호를 잊었으면 시스템 관리자에게 요청하세요.
      </p>
    </div>
  </div>
</template>
