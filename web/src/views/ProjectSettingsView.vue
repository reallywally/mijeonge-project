<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Loader2, Lock, Plus, UserMinus } from 'lucide-vue-next'
import PersonChip from '@/components/app/PersonChip.vue'
import ProjectAdminFrame from '@/components/app/ProjectAdminFrame.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PROJECT_ROLE_OPTIONS, memberLabel } from '@/lib/member'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import type { ProjectRole } from '@/types/domain'

/* 프로젝트 관리 — 프로젝트 정보와 프로젝트 멤버. 파트 소속은 여기서 보이기만 하고 고치는 곳은 파트 관리다 */
const data = useDataStore()
const auth = useAuthStore()
const partStore = usePartStore()
const route = useRoute()

const projectId = computed(() => String(route.params.projectId ?? ''))
const project = computed(() => data.allProjects.find((p) => p.id === projectId.value) ?? null)
const partsPath = computed(() => `/projects/${projectId.value}/parts`)

/* 서버 모드는 프로젝트를 바꾸면 스냅샷과 같이 멤버를 받는다 — 받기 전에는 비어 있다 */
const loading = computed(() => data.syncing || data.projectMembers[projectId.value] === undefined)
const recordsReady = computed(() => !data.syncing && data.holdsRecordsOf(projectId.value))

const rows = computed(() =>
  (data.projectMembers[projectId.value] ?? [])
    .map((p) => ({
      ...p,
      member: data.allMembers.find((m) => m.id === p.memberId) ?? null,
    }))
    .sort(
      (a, b) =>
        (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1) ||
        (a.member?.name ?? '').localeCompare(b.member?.name ?? '', 'ko'),
    ),
)

/* 한눈 정보 — 스냅샷이 이 프로젝트 것을 들고 있을 때만 센다 */
const stats = computed(() => {
  const id = projectId.value
  const count = (n: number) => (recordsReady.value ? String(n) : '—')
  const active = partStore.parts.filter((p) => p.active).length
  const archived = partStore.parts.length - active
  return [
    {
      key: 'tasks',
      label: '작업',
      value: count(data.allTasks.filter((t) => t.projectId === id).length),
      to: '/tasks',
    },
    {
      key: 'threads',
      label: '안건',
      value: count(data.allThreads.filter((t) => t.projectId === id).length),
      to: '/threads',
    },
    {
      key: 'parts',
      label: '파트',
      value: count(active),
      note: archived ? `보관 ${archived}` : '',
      to: partsPath.value,
    },
    {
      key: 'members',
      label: '멤버',
      value: loading.value ? '—' : String(rows.value.length),
      note: loading.value ? '' : `관리자 ${rows.value.filter((r) => r.role === 'admin').length}`,
    },
  ]
})

/* 이름 고치기 */
const nameDraft = ref('')
const renaming = ref(false)
watch(
  () => project.value?.name,
  (name) => (nameDraft.value = name ?? ''),
  { immediate: true },
)
const canRename = computed(
  () =>
    !!project.value &&
    nameDraft.value.trim() !== '' &&
    nameDraft.value.trim() !== project.value.name &&
    !renaming.value,
)
async function rename() {
  if (!canRename.value) return
  renaming.value = true
  await data.renameProject(projectId.value, nameDraft.value)
  renaming.value = false
}

/** 더할 수 있는 사람 — 아직 부여되지 않은 활성 멤버 */
const candidates = computed(() => {
  const granted = new Set(rows.value.map((r) => r.memberId))
  return data.allMembers.filter((m) => m.active && !granted.has(m.id))
})

const NONE = ''
const pickId = ref(NONE)
const pickRole = ref<ProjectRole>('user')
const adding = ref(false)
async function add() {
  if (!pickId.value || adding.value) return
  adding.value = true
  const ok = await data.grantMember(projectId.value, pickId.value, pickRole.value)
  adding.value = false
  if (ok) {
    pickId.value = NONE
    pickRole.value = 'user'
  }
}

const busyId = ref<string | null>(null)
const confirmingId = ref<string | null>(null)

async function changeRole(memberId: string, role: ProjectRole) {
  busyId.value = memberId
  await data.grantMember(projectId.value, memberId, role)
  busyId.value = null
}

async function remove(memberId: string) {
  busyId.value = memberId
  await data.revokeMember(projectId.value, memberId)
  busyId.value = null
  confirmingId.value = null
}

/** 그 사람이 속한 파트 — 이름 순. 보관한 파트도 보인다 */
const partsOf = (memberId: string) =>
  partStore.parts.filter((p) => partStore.partIdsOf(memberId).has(p.id))
</script>

<template>
  <ProjectAdminFrame section="settings" label="프로젝트 관리">
    <template #default="{ project: p }">
      <div class="flex w-full max-w-[900px] flex-col gap-4 pb-[26px]">
        <header class="flex flex-col gap-2.5">
          <h1 class="text-[22px] font-bold tracking-[-0.025em]">{{ p.name }} · 프로젝트 관리</h1>
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            프로젝트 정보와 이 프로젝트에 부여된 사람을 관리합니다. 파트를 만들고 사람을 넣고 빼는
            것은
            <RouterLink :to="partsPath" class="text-foreground underline-offset-4 hover:underline"
              >파트 관리</RouterLink
            >에서 합니다.
          </p>
        </header>

        <section class="flex flex-col gap-3" aria-label="프로젝트 정보">
          <h2 class="text-sm font-medium">프로젝트 정보</h2>
          <div
            class="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
          >
            <div class="flex items-center gap-2.5">
              <span class="w-[92px] shrink-0 text-sm text-muted-foreground">이름</span>
              <Input
                v-model="nameDraft"
                aria-label="프로젝트 이름"
                class="grow"
                @keyup.enter="rename"
              />
              <Button class="shrink-0" variant="outline" :disabled="!canRename" @click="rename">
                <Loader2 v-if="renaming" class="animate-spin" />
                이름 바꾸기
              </Button>
            </div>
            <div class="flex items-start gap-2.5">
              <span class="w-[92px] shrink-0 pt-1 text-sm text-muted-foreground"
                >작업 키 접두사</span
              >
              <div class="flex flex-col gap-1">
                <span
                  class="inline-flex h-7 items-center gap-1.5 self-start rounded-md border border-border bg-background px-2.5 font-mono text-sm"
                  data-task-key-prefix
                >
                  <Lock class="size-3 text-muted-foreground" />
                  {{ p.taskKeyPrefix }}
                </span>
                <p class="text-xs leading-relaxed text-muted-foreground text-pretty">
                  이미 붙은 작업 키({{ p.taskKeyPrefix }}-4 …)가 기록에 남아 있어 바꾸지 않습니다.
                </p>
              </div>
            </div>
          </div>

          <dl class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <component
              :is="s.to ? 'RouterLink' : 'div'"
              v-for="s in stats"
              :key="s.key"
              :to="s.to"
              :data-stat="s.key"
              class="flex flex-col gap-1 rounded-lg border border-border bg-card px-[15px] py-3 shadow-sm"
              :class="s.to ? 'transition-colors hover:bg-accent' : ''"
            >
              <dt class="text-xs text-muted-foreground">{{ s.label }}</dt>
              <dd class="flex items-baseline gap-1.5">
                <span class="text-xl font-semibold tabular-nums">{{ s.value }}</span>
                <span v-if="s.note" class="text-xs text-muted-foreground">{{ s.note }}</span>
              </dd>
            </component>
          </dl>
        </section>

        <section class="flex flex-col gap-3" aria-label="프로젝트 멤버">
          <div class="flex items-baseline gap-2">
            <h2 class="text-sm font-medium">프로젝트 멤버</h2>
            <span class="text-xs text-muted-foreground">{{ rows.length }}명</span>
          </div>
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            부여된 사람만 이 프로젝트를 보고, 작업 · 안건의 담당자로 고를 수 있습니다. 빼도 그
            사람이 맡았던 작업 · 안건은 그대로 남고, 속했던 파트에서는 같이 빠집니다.
          </p>

          <div
            class="flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3 shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
          >
            <span class="w-[92px] shrink-0 text-sm text-muted-foreground">사람 더하기</span>
            <Select v-model="pickId">
              <SelectTrigger class="grow" aria-label="더할 사람">
                <SelectValue
                  :placeholder="
                    candidates.length ? '사람을 고르세요' : '더할 수 있는 사람이 없습니다'
                  "
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="m in candidates" :key="m.id" :value="m.id">{{
                  m.name
                }}</SelectItem>
              </SelectContent>
            </Select>
            <Select v-model="pickRole">
              <SelectTrigger class="w-[150px] shrink-0" aria-label="더할 사람의 역할">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="o in PROJECT_ROLE_OPTIONS" :key="o.value" :value="o.value">
                  {{ o.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button class="shrink-0" :disabled="!pickId || adding" @click="add">
              <Loader2 v-if="adding" class="animate-spin" />
              <Plus v-else class="size-4" />
              더하기
            </Button>
          </div>

          <div
            class="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
          >
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/60 hover:bg-muted/60">
                  <TableHead class="h-10 text-xs font-medium text-muted-foreground">이름</TableHead>
                  <TableHead class="h-10 w-[200px] text-xs font-medium text-muted-foreground"
                    >역할</TableHead
                  >
                  <TableHead class="h-10 text-xs font-medium text-muted-foreground">
                    <span class="flex items-center gap-2">
                      파트
                      <RouterLink
                        :to="partsPath"
                        class="font-normal underline-offset-4 hover:text-foreground hover:underline"
                        >고치기</RouterLink
                      >
                    </span>
                  </TableHead>
                  <TableHead class="h-10 w-[180px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow
                  v-for="r in rows"
                  :key="r.memberId"
                  :data-member-id="r.memberId"
                  class="h-12"
                >
                  <TableCell>
                    <span class="flex items-center gap-2">
                      <PersonChip :name="r.member ? memberLabel(r.member) : '알 수 없음'" />
                      <Badge v-if="r.memberId === auth.me?.id" variant="secondary">나</Badge>
                    </span>
                  </TableCell>
                  <TableCell>
                    <Select
                      :model-value="r.role"
                      :disabled="busyId === r.memberId"
                      @update:model-value="(v) => changeRole(r.memberId, v as ProjectRole)"
                    >
                      <SelectTrigger
                        class="h-8 w-[170px] text-xs"
                        :aria-label="`${r.member?.name ?? ''} 역할`"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem
                          v-for="o in PROJECT_ROLE_OPTIONS"
                          :key="o.value"
                          :value="o.value"
                        >
                          {{ o.label }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <span class="flex flex-wrap gap-1">
                      <RouterLink
                        v-for="part in partsOf(r.memberId)"
                        :key="part.id"
                        :to="{ path: partsPath, query: { part: part.id } }"
                        class="inline-flex h-5 max-w-[140px] items-center rounded-sm border border-border px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        :title="`파트 관리 · ${part.name}`"
                        data-part-chip
                      >
                        <span class="truncate">{{
                          part.active ? part.name : `${part.name} (보관)`
                        }}</span>
                      </RouterLink>
                      <span
                        v-if="partsOf(r.memberId).length === 0"
                        class="text-xs text-muted-foreground"
                        >—</span
                      >
                    </span>
                  </TableCell>
                  <TableCell class="text-right">
                    <span
                      v-if="confirmingId === r.memberId"
                      class="flex items-center justify-end gap-1.5"
                    >
                      <span class="text-xs text-muted-foreground">뺄까요?</span>
                      <Button
                        variant="destructive"
                        size="xs"
                        :disabled="busyId === r.memberId"
                        @click="remove(r.memberId)"
                      >
                        빼기
                      </Button>
                      <Button variant="ghost" size="xs" @click="confirmingId = null">취소</Button>
                    </span>
                    <Button
                      v-else
                      variant="ghost"
                      size="sm"
                      :aria-label="`${r.member?.name ?? ''} 빼기`"
                      @click="confirmingId = r.memberId"
                    >
                      <UserMinus class="size-3.5" />
                      빼기
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow v-if="rows.length === 0" class="hover:bg-transparent">
                  <TableCell
                    :colspan="4"
                    class="h-[110px] text-center text-sm text-muted-foreground"
                  >
                    <span v-if="loading" class="inline-flex items-center gap-1.5">
                      <Loader2 class="size-3.5 animate-spin" />
                      불러오는 중…
                    </span>
                    <span v-else>아직 부여된 사람이 없습니다. 위에서 사람을 더하세요.</span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </template>
  </ProjectAdminFrame>
</template>
