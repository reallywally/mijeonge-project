<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDown, KeyRound, LogOut, UserRound } from 'lucide-vue-next'
import PasswordChangeDialog from '@/components/app/PasswordChangeDialog.vue'
import PersonChip from '@/components/app/PersonChip.vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { GRADE_LABEL, gradeOf } from '@/lib/access'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'

/* 머리 줄 오른쪽 내 메뉴 — 업무 화면(AppShell)과 관리자 페이지(AdminShell)가 같이 쓴다.
   마이페이지(/me)에도 비밀번호 바꾸기가 있지만, 어느 화면에서든 바로 바꾸게 창도 남긴다 */
const data = useDataStore()
const auth = useAuthStore()
const router = useRouter()

const gradeLabel = computed(() => {
  const grade = gradeOf(auth.me, data.currentProjectId)
  return grade ? GRADE_LABEL[grade] : ''
})

const passwordOpen = ref(false)

async function logout() {
  await auth.logout()
  await router.replace('/login')
}
</script>

<template>
  <DropdownMenu v-if="auth.me">
    <DropdownMenuTrigger
      class="flex h-8 items-center gap-1 rounded-md pr-1 pl-1.5 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-none"
      aria-label="내 메뉴"
    >
      <PersonChip :name="auth.me.name" :src="auth.me.avatarUrl" />
      <ChevronDown class="size-3.5 text-muted-foreground" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-56">
      <DropdownMenuLabel class="flex flex-col gap-0.5">
        <span>{{ auth.me.name }}</span>
        <span class="truncate text-xs font-normal text-muted-foreground">
          {{ auth.me.email }}
        </span>
        <span class="text-xs font-normal text-muted-foreground">{{ gradeLabel }}</span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem data-my-page @select="router.push('/me')">
        <UserRound />
        마이페이지
      </DropdownMenuItem>
      <DropdownMenuItem @select="passwordOpen = true">
        <KeyRound />
        비밀번호 바꾸기
      </DropdownMenuItem>
      <DropdownMenuItem @select="logout">
        <LogOut />
        로그아웃
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
  <PasswordChangeDialog v-model:open="passwordOpen" />
</template>
