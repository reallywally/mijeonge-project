<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Loader2 } from 'lucide-vue-next'
import { messageOf } from '@/api'
import BrandMark from '@/components/app/BrandMark.vue'
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
  <div
    class="flex min-h-screen flex-col items-center justify-center gap-7 bg-background bg-[radial-gradient(60%_50%_at_50%_0%,var(--brand-soft),transparent)] px-6"
  >
    <BrandMark size="lg" />
    <div
      class="flex w-full max-w-[380px] flex-col gap-6 rounded-xl border border-border bg-card px-7 py-7 shadow-[0_1px_2px_rgb(16_24_40/0.04),0_12px_32px_-12px_rgb(16_24_40/0.12)]"
    >
      <div class="flex flex-col gap-1.5">
        <h1 class="text-lg font-bold tracking-[-0.02em]">로그인</h1>
        <p class="text-[13px] text-muted-foreground text-pretty">
          관리자에게 받은 이메일과 비밀번호로 로그인하세요.
        </p>
      </div>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="flex flex-col gap-2">
          <Label for="login-email">이메일</Label>
          <Input
            id="login-email"
            class="h-10 text-sm"
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
            class="h-10 text-sm"
            v-model="password"
            type="password"
            autocomplete="current-password"
          />
        </div>
        <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
        <Button type="submit" size="lg" class="mt-1 w-full" :disabled="!canSubmit">
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
