<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ChevronDown,
  ChevronRight,
  FolderClosed,
  KeyRound,
  ListTree,
  Loader2,
  LogOut,
  SquareKanban,
  UserCog,
  Users,
} from 'lucide-vue-next'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { canManageAccounts, canManageProject, GRADE_LABEL, gradeOf } from '@/lib/access'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useTaskStore } from '@/stores/task'
import { useThreadStore } from '@/stores/thread'

/* 대메뉴는 작업 · 안건 둘이다. 위에서 프로젝트를 고르면 두 화면 모두 그 프로젝트 안에서만 돈다.
   관리 메뉴는 권한이 있는 사람에게만 보인다 — 숨기는 것은 편의이고 막는 것은 서버다. */
const data = useDataStore()
const auth = useAuthStore()
const taskStore = useTaskStore()
const threadStore = useThreadStore()
const router = useRouter()

const manageProject = computed(
  () => data.currentProjectId !== '' && canManageProject(auth.me, data.currentProjectId),
)
const manageAccounts = computed(() => canManageAccounts(auth.me))
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
  <div class="flex h-screen min-h-0 flex-col bg-background text-foreground">
    <header class="flex h-[58px] shrink-0 items-center gap-3 border-b border-border px-[22px]">
      <div class="flex items-center gap-2.5">
        <div class="size-[19px] rounded-sm border-[1.5px] border-foreground" />
        <span class="text-lg font-semibold">innoFlow</span>
      </div>
      <ChevronRight class="size-3.5 text-muted-foreground" />
      <div class="flex items-center gap-2 text-sm">
        <FolderClosed class="size-3.5 text-muted-foreground" />
        <span :class="data.currentProject ? '' : 'text-muted-foreground'">
          {{ data.currentProject?.name ?? '고른 프로젝트 없음' }}
        </span>
        <!-- 프로젝트를 바꾸고 그 프로젝트의 레코드를 받는 동안 -->
        <Loader2
          v-if="data.syncing"
          class="size-3.5 animate-spin text-muted-foreground"
          aria-label="불러오는 중"
        />
      </div>
      <div class="grow" />
      <slot name="actions" />
      <DropdownMenu v-if="auth.me">
        <DropdownMenuTrigger
          class="flex h-9 items-center gap-1.5 rounded-md px-1.5 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label="내 메뉴"
        >
          <PersonChip :name="auth.me.name" />
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
    </header>

    <div class="flex min-h-0 grow">
      <aside
        class="flex w-60 shrink-0 flex-col gap-5 overflow-hidden border-r border-border bg-muted/50 px-4 py-[22px]"
      >
        <label class="flex flex-col gap-1.5">
          <span class="flex items-center gap-2 px-1">
            <span class="grow text-xs font-medium text-muted-foreground">프로젝트</span>
            <!-- 프로젝트를 만들고 고르는 자리. 대메뉴에 두지 않고 여기서 간다 -->
            <RouterLink
              to="/projects"
              class="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              목록
            </RouterLink>
          </span>
          <Select
            v-if="data.allProjects.length > 0"
            :model-value="data.currentProjectId"
            @update:model-value="(id) => data.setProject(String(id))"
          >
            <SelectTrigger class="h-11 w-full bg-card text-sm font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="p in data.allProjects" :key="p.id" :value="p.id">
                {{ p.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p
            v-else
            class="rounded-md border border-dashed border-border px-3 py-2.5 text-xs leading-relaxed text-muted-foreground"
          >
            {{ auth.systemAdmin ? '등록된 프로젝트가 없습니다.' : '부여받은 프로젝트가 없습니다.' }}
          </p>
        </label>

        <nav class="flex flex-col gap-[3px]">
          <RouterLink
            to="/tasks"
            class="flex min-h-12 items-center gap-2.5 rounded-md px-3 py-[11px] text-sm hover:bg-accent hover:text-accent-foreground"
            active-class="bg-accent font-medium text-accent-foreground"
          >
            <SquareKanban class="size-4 shrink-0" />
            <span class="grow">작업</span>
            <span class="text-xs text-muted-foreground">{{ taskStore.visibleRows.length }}</span>
          </RouterLink>
          <RouterLink
            to="/threads"
            class="flex min-h-12 items-center gap-2.5 rounded-md px-3 py-[11px] text-sm hover:bg-accent hover:text-accent-foreground"
            active-class="bg-accent font-medium text-accent-foreground"
          >
            <ListTree class="size-4 shrink-0" />
            <span class="grow">안건</span>
            <span class="text-xs text-muted-foreground">{{ threadStore.visibleRows.length }}</span>
          </RouterLink>
        </nav>

        <nav v-if="manageProject || manageAccounts" class="flex flex-col gap-[3px]">
          <span class="px-1 pb-1 text-xs font-medium text-muted-foreground">관리</span>
          <RouterLink
            v-if="manageProject"
            :to="`/projects/${data.currentProjectId}/members`"
            class="flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
            active-class="bg-accent font-medium text-accent-foreground"
          >
            <Users class="size-4 shrink-0" />
            프로젝트 멤버
          </RouterLink>
          <RouterLink
            v-if="manageAccounts"
            to="/admin/members"
            class="flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
            active-class="bg-accent font-medium text-accent-foreground"
          >
            <UserCog class="size-4 shrink-0" />
            사용자 관리
          </RouterLink>
        </nav>

        <slot name="aside" />
      </aside>

      <main class="flex min-w-0 grow flex-col overflow-hidden">
        <slot />
      </main>
    </div>

    <PasswordChangeDialog v-model:open="passwordOpen" />
  </div>
</template>
