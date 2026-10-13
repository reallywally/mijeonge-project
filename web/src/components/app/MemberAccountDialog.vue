<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { looksLikeEmail, normalizeEmail, passwordProblem, SYSTEM_ROLE_OPTIONS } from '@/lib/member'
import { useAdminStore } from '@/stores/admin'
import type { MemberAccount, MemberAccountPatch, SystemRole } from '@/types/domain'

/* 사용자 등록 · 수정 — 사용자 관리 표 위 팝업. account 가 없으면 등록이다.
   등록에는 첫 비밀번호를 같이 받고, 수정에서는 활성을 끄고 켠다(지우지 않는다 — 기록이 가리킨다).
   서버의 거절(EMAIL_TAKEN · LAST_SYSTEM_ADMIN …)은 스토어가 토스트로 띄우고 칸은 그대로 둔다 */
const props = defineProps<{ account: MemberAccount | null }>()
const open = defineModel<boolean>('open', { required: true })

const admin = useAdminStore()

const name = ref('')
const email = ref('')
const password = ref('')
const systemRole = ref<SystemRole>('user')
const active = ref(true)
const saving = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) return
  name.value = props.account?.name ?? ''
  email.value = props.account?.email ?? ''
  password.value = ''
  systemRole.value = props.account?.systemRole ?? 'user'
  active.value = props.account?.active ?? true
})

const creating = computed(() => props.account === null)

const emailHint = computed(() =>
  email.value.trim() && !looksLikeEmail(email.value) ? '이메일 형식이 아닙니다.' : null,
)
const passwordHint = computed(() => (password.value ? passwordProblem(password.value) : null))

/** 바뀐 칸만 보낸다 — 부분 수정이다 */
const patch = computed<MemberAccountPatch>(() => {
  const a = props.account
  if (!a) return {}
  const out: MemberAccountPatch = {}
  if (name.value.trim() !== a.name) out.name = name.value.trim()
  if (normalizeEmail(email.value) !== (a.email ?? '')) out.email = email.value.trim()
  if (systemRole.value !== a.systemRole) out.systemRole = systemRole.value
  if (active.value !== a.active) out.active = active.value
  return out
})

const canSubmit = computed(() => {
  if (saving.value || !name.value.trim()) return false
  if (creating.value) return looksLikeEmail(email.value) && passwordProblem(password.value) === null
  /* 이메일이 없던 사람은 비워 둔 채로도 이름 · 역할을 고칠 수 있다 */
  if (email.value.trim() && !looksLikeEmail(email.value)) return false
  return Object.keys(patch.value).length > 0
})

async function submit() {
  if (!canSubmit.value) return
  saving.value = true
  const ok = props.account
    ? await admin.update(props.account.id, patch.value)
    : (await admin.create({
        name: name.value.trim(),
        email: email.value.trim(),
        password: password.value,
        systemRole: systemRole.value,
      })) !== null
  saving.value = false
  if (ok) open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[460px]">
      <DialogHeader>
        <DialogTitle>{{ creating ? '사용자 등록' : '사용자 수정' }}</DialogTitle>
        <DialogDescription class="text-pretty">
          {{
            creating
              ? '등록한 이메일과 비밀번호로 로그인합니다. 프로젝트는 프로젝트 멤버 화면에서 따로 부여합니다.'
              : '사용자는 지우지 않고 끕니다. 끄면 로그인할 수 없고 담당자로 고를 수 없습니다.'
          }}
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-3.5 py-1" @submit.prevent="submit">
        <div class="flex flex-col gap-2">
          <Label for="account-name">이름</Label>
          <Input id="account-name" v-model="name" placeholder="예: 김서연" />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="account-email">이메일</Label>
          <Input
            id="account-email"
            v-model="email"
            type="email"
            autocomplete="off"
            placeholder="name@company.com"
          />
          <p v-if="emailHint" class="text-xs text-destructive">{{ emailHint }}</p>
        </div>
        <div v-if="creating" class="flex flex-col gap-2">
          <Label for="account-password">첫 비밀번호</Label>
          <Input
            id="account-password"
            v-model="password"
            type="password"
            autocomplete="new-password"
          />
          <p v-if="passwordHint" class="text-xs text-destructive">{{ passwordHint }}</p>
          <p v-else class="text-xs text-muted-foreground">10자 이상. 본인에게 따로 알려 주세요.</p>
        </div>
        <div class="flex flex-col gap-2">
          <Label>시스템 역할</Label>
          <Select v-model="systemRole">
            <SelectTrigger class="w-[200px]" aria-label="시스템 역할">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="o in SYSTEM_ROLE_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label v-if="!creating" class="flex items-center gap-2 text-sm">
          <Checkbox
            :model-value="active"
            aria-label="활성"
            @update:model-value="(v) => (active = v === true)"
          />
          활성 — 로그인하고 담당자로 고를 수 있다
        </label>
        <button type="submit" class="hidden" />
      </form>

      <DialogFooter>
        <Button variant="outline" @click="open = false">취소</Button>
        <Button :disabled="!canSubmit" @click="submit">
          <Loader2 v-if="saving" class="animate-spin" />
          {{ creating ? '등록' : '저장' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
