<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ChevronDown,
  FileChartColumn,
  FlaskConical,
  FolderClosed,
  KeyRound,
  ListChecks,
  ListTree,
  NotebookPen,
  Loader2,
  LogOut,
  Settings,
  SquareKanban,
  TriangleAlert,
  UserCog,
  Users,
} from 'lucide-vue-next'
import BrandMark from '@/components/app/BrandMark.vue'
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
import { Badge } from '@/components/ui/badge'
import { canManageAccounts, canManageProject, GRADE_LABEL, gradeOf } from '@/lib/access'
import { useAuthStore } from '@/stores/auth'
import { useCheckStore } from '@/stores/check'
import { useDataStore } from '@/stores/data'
import { useTaskStore } from '@/stores/task'
import { useThreadStore } from '@/stores/thread'

/* 대메뉴는 작업 · 안건 · 테스트 · 리스크 · 리포트 · 확인 요청 · 회의록이다. 위에서 프로젝트를 고르면 모두 그 프로젝트 안에서만 돈다.
   관리 메뉴는 권한이 있는 사람에게만 보인다 — 숨기는 것은 편의이고 막는 것은 서버다.
   확인 요청 배지는 지금 프로젝트의 내 대기 수, 프로젝트 고르기에는 다른 프로젝트의 수 — 0 이면 안 그린다 (Q38) */
const data = useDataStore()
const auth = useAuthStore()
const taskStore = useTaskStore()
const threadStore = useThreadStore()
const checks = useCheckStore()
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
    <header class="flex h-12 shrink-0 items-center gap-2.5 border-b border-border bg-card px-4">
      <RouterLink to="/tasks" class="flex w-[212px] shrink-0 items-center pl-1">
        <BrandMark />
      </RouterLink>
      <div class="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <FolderClosed class="size-3.5" />
        <span :class="data.currentProject ? 'font-medium text-foreground' : ''">
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
          class="flex h-8 items-center gap-1 rounded-md pr-1 pl-1.5 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-none"
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
        class="flex w-[244px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-sidebar px-3 py-3"
      >
        <label class="flex flex-col gap-1.5">
          <span class="flex items-center gap-2 px-1">
            <span class="grow text-[11.5px] font-medium text-muted-foreground">프로젝트</span>
            <!-- 프로젝트를 만들고 고르는 자리. 대메뉴에 두지 않고 여기서 간다 -->
            <RouterLink
              to="/projects"
              class="text-[11.5px] text-muted-foreground hover:text-foreground"
            >
              목록
            </RouterLink>
          </span>
          <Select
            v-if="data.allProjects.length > 0"
            :model-value="data.currentProjectId"
            @update:model-value="(id) => data.setProject(String(id))"
          >
            <SelectTrigger class="h-9 w-full gap-2 bg-card text-[13px] font-semibold">
              <SelectValue class="min-w-0 grow truncate text-left" />
              <Badge
                v-if="checks.pendingElsewhere > 0"
                variant="secondary"
                class="shrink-0 px-1.5 font-normal"
                :title="`다른 프로젝트에 확인 대기 ${checks.pendingElsewhere}건`"
                data-check-badge-elsewhere
                >{{ checks.pendingElsewhere }}</Badge
              >
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="p in data.allProjects" :key="p.id" :value="p.id">
                {{ p.name }}
                <span
                  v-if="p.id !== data.currentProjectId && checks.pendingOf(p.id) > 0"
                  class="text-xs text-muted-foreground"
                  :data-check-badge-project="p.id"
                  >· 확인 대기 {{ checks.pendingOf(p.id) }}</span
                >
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

        <nav class="flex flex-col gap-px">
          <RouterLink
            to="/tasks"
            class="group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground [&>svg]:text-muted-foreground"
            active-class="!bg-card font-semibold !text-foreground shadow-[0_1px_2px_rgb(16_24_40/0.06),0_0_0_1px_var(--border)] [&>svg]:!text-primary"
          >
            <SquareKanban class="size-4 shrink-0" />
            <span class="grow">작업</span>
            <span class="text-xs text-muted-foreground tabular-nums">{{
              taskStore.visibleRows.length
            }}</span>
          </RouterLink>
          <RouterLink
            to="/threads"
            class="group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground [&>svg]:text-muted-foreground"
            active-class="!bg-card font-semibold !text-foreground shadow-[0_1px_2px_rgb(16_24_40/0.06),0_0_0_1px_var(--border)] [&>svg]:!text-primary"
          >
            <ListTree class="size-4 shrink-0" />
            <span class="grow">안건</span>
            <span class="text-xs text-muted-foreground tabular-nums">{{
              threadStore.visibleRows.length
            }}</span>
          </RouterLink>
          <RouterLink
            to="/tests"
            class="group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground [&>svg]:text-muted-foreground"
            active-class="!bg-card font-semibold !text-foreground shadow-[0_1px_2px_rgb(16_24_40/0.06),0_0_0_1px_var(--border)] [&>svg]:!text-primary"
          >
            <FlaskConical class="size-4 shrink-0" />
            <span class="grow">테스트</span>
          </RouterLink>
          <RouterLink
            to="/risks"
            class="group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground [&>svg]:text-muted-foreground"
            active-class="!bg-card font-semibold !text-foreground shadow-[0_1px_2px_rgb(16_24_40/0.06),0_0_0_1px_var(--border)] [&>svg]:!text-primary"
          >
            <TriangleAlert class="size-4 shrink-0" />
            <span class="grow">리스크</span>
          </RouterLink>
          <RouterLink
            to="/reports"
            class="group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground [&>svg]:text-muted-foreground"
            active-class="!bg-card font-semibold !text-foreground shadow-[0_1px_2px_rgb(16_24_40/0.06),0_0_0_1px_var(--border)] [&>svg]:!text-primary"
          >
            <FileChartColumn class="size-4 shrink-0" />
            <span class="grow">리포트</span>
          </RouterLink>
          <RouterLink
            to="/checks"
            class="group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground [&>svg]:text-muted-foreground"
            active-class="!bg-card font-semibold !text-foreground shadow-[0_1px_2px_rgb(16_24_40/0.06),0_0_0_1px_var(--border)] [&>svg]:!text-primary"
          >
            <ListChecks class="size-4 shrink-0" />
            <span class="grow">확인 요청</span>
            <Badge
              v-if="checks.pendingHere > 0"
              class="h-[18px] min-w-[18px] justify-center rounded-full px-1.5 text-[11px] tabular-nums"
              :aria-label="`확인 대기 ${checks.pendingHere}건`"
              data-check-badge
              >{{ checks.pendingHere }}</Badge
            >
          </RouterLink>
          <RouterLink
            to="/minutes"
            class="group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground [&>svg]:text-muted-foreground"
            active-class="!bg-card font-semibold !text-foreground shadow-[0_1px_2px_rgb(16_24_40/0.06),0_0_0_1px_var(--border)] [&>svg]:!text-primary"
          >
            <NotebookPen class="size-4 shrink-0" />
            <span class="grow">회의록</span>
          </RouterLink>
        </nav>

        <nav v-if="manageProject || manageAccounts" class="flex flex-col gap-[3px]">
          <span class="px-2.5 pb-1.5 text-[11.5px] font-medium text-muted-foreground">관리</span>
          <template v-if="manageProject">
            <RouterLink
              :to="`/projects/${data.currentProjectId}/settings`"
              class="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground [&>svg]:text-muted-foreground"
              active-class="!bg-card font-semibold !text-foreground shadow-[0_1px_2px_rgb(16_24_40/0.06),0_0_0_1px_var(--border)] [&>svg]:!text-primary"
            >
              <Settings class="size-4 shrink-0" />
              프로젝트 관리
            </RouterLink>
            <RouterLink
              :to="`/projects/${data.currentProjectId}/parts`"
              class="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground [&>svg]:text-muted-foreground"
              active-class="!bg-card font-semibold !text-foreground shadow-[0_1px_2px_rgb(16_24_40/0.06),0_0_0_1px_var(--border)] [&>svg]:!text-primary"
            >
              <Users class="size-4 shrink-0" />
              파트 관리
            </RouterLink>
          </template>
          <RouterLink
            v-if="manageAccounts"
            to="/admin/members"
            class="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground [&>svg]:text-muted-foreground"
            active-class="!bg-card font-semibold !text-foreground shadow-[0_1px_2px_rgb(16_24_40/0.06),0_0_0_1px_var(--border)] [&>svg]:!text-primary"
          >
            <UserCog class="size-4 shrink-0" />
            사용자 관리
          </RouterLink>
        </nav>

        <slot name="aside" />
      </aside>

      <main class="flex min-w-0 grow flex-col overflow-hidden bg-background">
        <slot />
      </main>
    </div>

    <PasswordChangeDialog v-model:open="passwordOpen" />
  </div>
</template>
