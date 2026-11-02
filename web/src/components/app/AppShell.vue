<script setup lang="ts">
import { computed } from 'vue'
import {
  FileChartColumn,
  FlaskConical,
  FolderClosed,
  ListChecks,
  ListTree,
  NotebookPen,
  Loader2,
  ShieldCheck,
  SquareKanban,
  TriangleAlert,
} from 'lucide-vue-next'
import AccountMenu from '@/components/app/AccountMenu.vue'
import BrandMark from '@/components/app/BrandMark.vue'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { canOpenAdmin } from '@/lib/access'
import { orderProjects } from '@/lib/project'
import { useAuthStore } from '@/stores/auth'
import { useCheckStore } from '@/stores/check'
import { useDataStore } from '@/stores/data'
import { useTaskStore } from '@/stores/task'
import { useThreadStore } from '@/stores/thread'

/* 대메뉴는 작업 · 안건 · 테스트 · 리스크 · 리포트 · 확인 요청 · 회의록이다. 위에서 프로젝트를 고르면 모두 그 프로젝트 안에서만 돈다.
   관리 메뉴는 관리자 페이지(AdminShell)로 뺐다 — 여기는 관리 권한이 있는 사람에게만 그리로 가는 링크 하나를 둔다.
   숨기는 것은 편의이고 막는 것은 서버다.
   확인 요청 배지는 지금 프로젝트의 내 대기 수, 프로젝트 고르기에는 다른 프로젝트의 수 — 0 이면 안 그린다 (Q38) */
const data = useDataStore()
const auth = useAuthStore()
const taskStore = useTaskStore()
const threadStore = useThreadStore()
const checks = useCheckStore()

const openAdmin = computed(() => canOpenAdmin(auth.me))
/** 종료한 프로젝트는 뒤로 */
const projectOptions = computed(() => orderProjects(data.allProjects))
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
      <AccountMenu />
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
              <!-- 고른 항목의 글을 베끼지 않고 직접 그린다 — 종료 · 다시 열기가 바로 따라오게 -->
              <SelectValue class="min-w-0 grow truncate text-left">
                <template v-if="data.currentProject">
                  {{ data.currentProject.name
                  }}<span
                    v-if="data.currentProject.status === 'closed'"
                    class="ml-1 text-xs font-normal text-muted-foreground"
                    data-closed-mark
                    >· 종료</span
                  >
                </template>
              </SelectValue>
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
              <SelectItem
                v-for="p in projectOptions"
                :key="p.id"
                :value="p.id"
                :data-project-option="p.id"
              >
                <span :class="p.status === 'closed' ? 'text-muted-foreground' : ''">{{
                  p.name
                }}</span>
                <span
                  v-if="p.status === 'closed'"
                  class="ml-1 text-xs text-muted-foreground"
                  data-closed-mark
                  >· 종료</span
                >
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

        <slot name="aside" />

        <!-- 관리 메뉴는 관리자 페이지에 모았다. 맨 아래에 두어 대메뉴와 섞이지 않게 한다 -->
        <RouterLink
          v-if="openAdmin"
          to="/admin"
          class="mt-auto flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground [&>svg]:text-muted-foreground"
          data-admin-link
        >
          <ShieldCheck class="size-4 shrink-0" />
          관리자 페이지
        </RouterLink>
      </aside>

      <main class="flex min-w-0 grow flex-col overflow-hidden bg-background">
        <slot />
      </main>
    </div>
  </div>
</template>
