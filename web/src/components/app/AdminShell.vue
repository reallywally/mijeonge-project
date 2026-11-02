<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, Loader2, Settings, ShieldCheck, UserCog, Users } from 'lucide-vue-next'
import AccountMenu from '@/components/app/AccountMenu.vue'
import BrandMark from '@/components/app/BrandMark.vue'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ADMIN_MEMBERS_PATH,
  canManageAccounts,
  canManageProject,
  projectPartsPath,
  projectSettingsPath,
} from '@/lib/access'
import { orderProjects, projectStatusLabel } from '@/lib/project'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'

/* 관리자 페이지의 틀 — 업무 대메뉴 대신 관리 메뉴만 둔다. 권한이 없는 묶음은 숨긴다(막는 것은 라우터 가드 · 서버).
   프로젝트 고르기는 관리할 수 있는 프로젝트만 보인다. 고르면 업무 화면과 같은 '현재 프로젝트'가 바뀐다 —
   프로젝트 관리 · 파트 관리에 있으면 틀(ProjectAdminFrame)이 그 프로젝트의 같은 화면으로 옮긴다 */
const data = useDataStore()
const auth = useAuthStore()

/* 진행 → 준비 → 종료 */
const managedProjects = computed(() =>
  orderProjects(data.allProjects).filter((p) => canManageProject(auth.me, p.id)),
)
const manageProject = computed(
  () => data.currentProjectId !== '' && canManageProject(auth.me, data.currentProjectId),
)
const manageAccounts = computed(() => canManageAccounts(auth.me))
</script>

<template>
  <div class="flex h-screen min-h-0 flex-col bg-background text-foreground">
    <header class="flex h-12 shrink-0 items-center gap-2.5 border-b border-border bg-card px-4">
      <RouterLink to="/tasks" class="flex w-[212px] shrink-0 items-center pl-1">
        <BrandMark />
      </RouterLink>
      <div class="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
        <ShieldCheck class="size-3.5 text-muted-foreground" />
        관리자 페이지
        <Loader2
          v-if="data.syncing"
          class="size-3.5 animate-spin text-muted-foreground"
          aria-label="불러오는 중"
        />
      </div>
      <div class="grow" />
      <slot name="actions" />
      <AccountMenu />
    </header>

    <div class="flex min-h-0 grow">
      <aside
        class="flex w-[244px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-sidebar px-3 py-3"
        aria-label="관리 메뉴"
      >
        <RouterLink
          to="/tasks"
          class="flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
          data-back-link
        >
          <ArrowLeft class="size-4 shrink-0" />
          업무 화면으로
        </RouterLink>

        <nav
          v-if="managedProjects.length > 0"
          class="flex flex-col gap-[3px]"
          data-admin-group="project"
        >
          <span class="px-2.5 pb-1.5 text-[11.5px] font-medium text-muted-foreground"
            >프로젝트</span
          >
          <Select
            :model-value="manageProject ? data.currentProjectId : undefined"
            @update:model-value="(id) => data.setProject(String(id))"
          >
            <SelectTrigger
              class="mb-1 h-9 w-full gap-2 bg-card text-[13px] font-semibold"
              aria-label="관리할 프로젝트"
            >
              <!-- 고른 항목의 글을 베끼지 않고 직접 그린다 — 상태를 바꾸면 바로 따라오게. 진행은 표시 없음 -->
              <SelectValue class="min-w-0 grow truncate text-left">
                <template v-if="manageProject && data.currentProject">
                  {{ data.currentProject.name
                  }}<span
                    v-if="data.currentProject.status !== 'active'"
                    class="ml-1 text-xs font-normal text-muted-foreground"
                    :data-status-mark="data.currentProject.status"
                    >· {{ projectStatusLabel(data.currentProject.status) }}</span
                  >
                </template>
                <span v-else class="text-muted-foreground">프로젝트 고르기</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="p in managedProjects"
                :key="p.id"
                :value="p.id"
                :data-project-option="p.id"
              >
                <span :class="p.status === 'closed' ? 'text-muted-foreground' : ''">{{
                  p.name
                }}</span>
                <span
                  v-if="p.status !== 'active'"
                  class="ml-1 text-xs text-muted-foreground"
                  :data-status-mark="p.status"
                  >· {{ projectStatusLabel(p.status) }}</span
                >
              </SelectItem>
            </SelectContent>
          </Select>
          <template v-if="manageProject">
            <RouterLink
              :to="projectSettingsPath(data.currentProjectId)"
              class="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground [&>svg]:text-muted-foreground"
              active-class="!bg-card font-semibold !text-foreground shadow-[0_1px_2px_rgb(16_24_40/0.06),0_0_0_1px_var(--border)] [&>svg]:!text-primary"
              data-admin-link="settings"
            >
              <Settings class="size-4 shrink-0" />
              프로젝트 관리
            </RouterLink>
            <RouterLink
              :to="projectPartsPath(data.currentProjectId)"
              class="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground [&>svg]:text-muted-foreground"
              active-class="!bg-card font-semibold !text-foreground shadow-[0_1px_2px_rgb(16_24_40/0.06),0_0_0_1px_var(--border)] [&>svg]:!text-primary"
              data-admin-link="parts"
            >
              <Users class="size-4 shrink-0" />
              파트 관리
            </RouterLink>
          </template>
        </nav>

        <nav v-if="manageAccounts" class="flex flex-col gap-[3px]" data-admin-group="system">
          <span class="px-2.5 pb-1.5 text-[11.5px] font-medium text-muted-foreground">시스템</span>
          <RouterLink
            :to="ADMIN_MEMBERS_PATH"
            class="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground [&>svg]:text-muted-foreground"
            active-class="!bg-card font-semibold !text-foreground shadow-[0_1px_2px_rgb(16_24_40/0.06),0_0_0_1px_var(--border)] [&>svg]:!text-primary"
            data-admin-link="members"
          >
            <UserCog class="size-4 shrink-0" />
            사용자 관리
          </RouterLink>
        </nav>
      </aside>

      <main class="flex min-w-0 grow flex-col overflow-hidden bg-background">
        <slot />
      </main>
    </div>
  </div>
</template>
