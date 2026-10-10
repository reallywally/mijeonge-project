<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import ProjectCreateDialog from '@/components/app/ProjectCreateDialog.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDataStore } from '@/stores/data'

/* 프로젝트 목록 · 등록 — memo 화면 1. 여기서 고른 프로젝트 안에서만 나머지 화면이 돈다.
   조회 조건 · 표 · 페이징은 안건 목록과 같은 자리, 같은 모양이다. */
const data = useDataStore()
const route = useRoute()
const router = useRouter()

const nameDraft = ref('')
const query = ref('')
const page = ref(1)
const perPage = 8

const rows = computed(() =>
  data.allProjects.map((project) => ({
    project,
    /* 서버 모드는 고른 프로젝트 하나치만 받는다 — 안 받은 프로젝트의 수는 모른다 */
    taskCount: data.holdsRecordsOf(project.id)
      ? data.allTasks.filter((t) => t.projectId === project.id).length
      : '—',
    threadCount: data.holdsRecordsOf(project.id)
      ? data.allThreads.filter((t) => t.projectId === project.id).length
      : '—',
  })),
)

const filtered = computed(() => rows.value.filter((r) => r.project.name.includes(query.value)))

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / perPage)))
const current = computed(() => Math.min(page.value, pageCount.value))
const start = computed(() => (current.value - 1) * perPage)
const pageRows = computed(() => filtered.value.slice(start.value, start.value + perPage))
const rangeLabel = computed(() =>
  filtered.value.length === 0
    ? '0건'
    : `총 ${filtered.value.length}건 중 ${start.value + 1}–${start.value + pageRows.value.length}건`,
)

function resetPage() {
  page.value = 1
}
function search() {
  query.value = nameDraft.value.trim()
  resetPage()
}
function resetAll() {
  nameDraft.value = ''
  query.value = ''
  resetPage()
}

/* 프로젝트 등록 — 목록을 그대로 두고 그 위에 띄우되, 주소를 갖는다.
   프로젝트가 하나도 없으면 라우터가 여기로 보낸다 (API.md Q18) */
const createOpen = computed({
  get: () => route.path === '/projects/new',
  set: (open: boolean) => {
    if (!open && data.allProjects.length > 0) router.push('/projects')
  },
})

function openCreate() {
  router.push('/projects/new')
}

/** 고르면 그 프로젝트 안으로 들어간다 — 작업이 첫 화면이다 */
function pickProject(id: string) {
  data.setProject(id)
  router.push('/tasks')
}

function onCreated() {
  router.push('/tasks')
}
</script>

<template>
  <AppShell>
    <div class="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-border px-[26px]">
      <span class="text-xs font-medium text-muted-foreground">프로젝트</span>
      <span class="text-xs text-muted-foreground">{{ rangeLabel }}</span>
    </div>

    <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
      <div class="flex w-full max-w-[900px] flex-col gap-4">
        <header class="flex items-start gap-4">
          <div class="flex min-w-0 grow flex-col gap-2.5">
            <h1 class="text-2xl font-semibold tracking-tight">프로젝트</h1>
            <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
              가장 큰 단위입니다. 개발은 차세대 · 이관 같은 사업 단위로, 사무직은 파트 단위로
              만듭니다. 여기서 고른 프로젝트 안에서만 작업 · 안건이 돕니다.
            </p>
          </div>
          <Button class="shrink-0" @click="openCreate">
            <Plus class="size-4" />
            프로젝트 추가
          </Button>
        </header>

        <section
          class="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-[17px] py-[15px]"
        >
          <span class="w-[52px] shrink-0 text-sm text-muted-foreground">이름</span>
          <Input
            v-model="nameDraft"
            placeholder="프로젝트 이름에 들어가는 말"
            class="grow bg-background"
            @keyup.enter="search"
          />
          <Button class="shrink-0" @click="search">
            <Search class="size-4" />
            조회
          </Button>
          <Button variant="outline" class="shrink-0" @click="resetAll">초기화</Button>
        </section>

        <div class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/50 hover:bg-muted/50">
                <TableHead class="h-10 text-xs font-medium text-muted-foreground"
                  >프로젝트</TableHead
                >
                <TableHead class="h-10 w-[96px] text-xs font-medium text-muted-foreground"
                  >작업 키</TableHead
                >
                <TableHead
                  class="h-10 w-[64px] text-right text-xs font-medium text-muted-foreground"
                  >작업</TableHead
                >
                <TableHead
                  class="h-10 w-[64px] text-right text-xs font-medium text-muted-foreground"
                  >안건</TableHead
                >
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="row in pageRows"
                :key="row.project.id"
                class="h-12 cursor-pointer"
                @click="pickProject(row.project.id)"
              >
                <TableCell class="min-w-0">
                  <div class="flex items-center gap-2.5">
                    <Check
                      v-if="row.project.id === data.currentProjectId"
                      class="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span v-else class="size-3.5 shrink-0" />
                    <button
                      type="button"
                      class="min-w-0 truncate text-left text-sm underline-offset-4 hover:underline"
                      :class="row.project.id === data.currentProjectId ? 'font-medium' : ''"
                    >
                      {{ row.project.name }}
                    </button>
                  </div>
                </TableCell>
                <TableCell class="text-sm text-muted-foreground">
                  {{ row.project.taskKeyPrefix }}-1
                </TableCell>
                <TableCell class="text-right text-sm text-muted-foreground">{{
                  row.taskCount
                }}</TableCell>
                <TableCell class="text-right text-sm text-muted-foreground">{{
                  row.threadCount
                }}</TableCell>
              </TableRow>
              <TableRow v-if="pageRows.length === 0" class="hover:bg-transparent">
                <TableCell colspan="4" class="h-[110px] text-center text-sm text-muted-foreground">
                  {{
                    data.allProjects.length === 0
                      ? '등록된 프로젝트가 없습니다. 프로젝트를 먼저 만들어 주세요.'
                      : '조회 조건에 맞는 프로젝트가 없습니다.'
                  }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div class="flex items-center gap-2.5 pb-[26px]">
          <span class="text-xs text-muted-foreground">{{ rangeLabel }}</span>
          <div class="grow" />
          <Button
            variant="outline"
            size="icon"
            :disabled="current <= 1"
            @click="page = current - 1"
          >
            <ChevronLeft class="size-4" />
          </Button>
          <Button
            v-for="n in pageCount"
            :key="n"
            :variant="n === current ? 'default' : 'outline'"
            size="icon"
            class="text-xs"
            @click="page = n"
          >
            {{ n }}
          </Button>
          <Button
            variant="outline"
            size="icon"
            :disabled="current >= pageCount"
            @click="page = current + 1"
          >
            <ChevronRight class="size-4" />
          </Button>
        </div>
      </div>
    </div>

    <ProjectCreateDialog v-model:open="createOpen" @created="onCreated" />
  </AppShell>
</template>
