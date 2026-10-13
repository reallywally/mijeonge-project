<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Loader2, Plus, UserMinus } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import PersonChip from '@/components/app/PersonChip.vue'
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
import { canManageProject } from '@/lib/access'
import { PROJECT_ROLE_OPTIONS } from '@/lib/member'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import type { ProjectRole } from '@/types/domain'

/* 프로젝트 멤버 — 그 프로젝트의 관리자 · 시스템 관리자. 부여된 사람만 담당자로 고를 수 있다.
   주소의 프로젝트가 곧 고른 프로젝트다 — 옆의 프로젝트 선택을 바꾸면 그 프로젝트의 멤버 화면으로 옮긴다 */
const data = useDataStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const projectId = computed(() => String(route.params.projectId ?? ''))
const project = computed(() => data.allProjects.find((p) => p.id === projectId.value) ?? null)

watch(
  projectId,
  (id) => {
    if (id && id !== data.currentProjectId && data.allProjects.some((p) => p.id === id))
      data.setProject(id)
  },
  { immediate: true },
)

watch(
  () => data.currentProjectId,
  (id) => {
    if (id === projectId.value) return
    void router.replace(id && canManageProject(auth.me, id) ? `/projects/${id}/members` : '/tasks')
  },
)

/* 나를 내리거나 뺐으면 이 화면에 있을 수 없다 */
watch(
  () => canManageProject(auth.me, projectId.value),
  (can) => {
    if (!can) void router.replace('/tasks')
  },
)

/* 서버 모드는 프로젝트를 바꾸면 스냅샷과 같이 멤버를 받는다 — 받기 전에는 비어 있다 */
const loading = computed(() => data.syncing || data.projectMembers[projectId.value] === undefined)

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

/** 더할 수 있는 사람 — 아직 부여되지 않은 활성 멤버 */
const candidates = computed(() => {
  const granted = new Set(rows.value.map((r) => r.memberId))
  return data.allMembers.filter((m) => m.active && !granted.has(m.id))
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

/* 사람 더하기 */
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
</script>

<template>
  <AppShell>
    <div class="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-border px-[26px]">
      <span class="text-xs font-medium text-muted-foreground">프로젝트 멤버</span>
      <span class="text-xs text-muted-foreground">{{ rows.length }}명</span>
    </div>

    <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
      <div v-if="!project" class="pt-10 text-sm text-muted-foreground">
        프로젝트를 찾을 수 없습니다.
      </div>
      <div v-else class="flex w-full max-w-[900px] flex-col gap-4 pb-[26px]">
        <header class="flex flex-col gap-2.5">
          <h1 class="text-2xl font-semibold tracking-tight">{{ project.name }} · 멤버</h1>
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            부여된 사람만 이 프로젝트를 보고, 작업 · 안건의 담당자로 고를 수 있습니다. 빼도 그
            사람이 맡았던 작업 · 안건은 그대로 남습니다.
          </p>
        </header>

        <section
          class="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-[17px] py-[15px]"
        >
          <span class="w-[72px] shrink-0 text-sm text-muted-foreground">이름</span>
          <Input
            v-model="nameDraft"
            aria-label="프로젝트 이름"
            class="grow bg-background"
            @keyup.enter="rename"
          />
          <Button class="shrink-0" variant="outline" :disabled="!canRename" @click="rename">
            <Loader2 v-if="renaming" class="animate-spin" />
            이름 바꾸기
          </Button>
        </section>

        <section
          class="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-[17px] py-[15px]"
        >
          <span class="w-[72px] shrink-0 text-sm text-muted-foreground">사람 더하기</span>
          <Select v-model="pickId">
            <SelectTrigger class="grow bg-background" aria-label="더할 사람">
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
            <SelectTrigger class="w-[150px] shrink-0 bg-background" aria-label="더할 사람의 역할">
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
        </section>

        <div class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/50 hover:bg-muted/50">
                <TableHead class="h-10 text-xs font-medium text-muted-foreground">이름</TableHead>
                <TableHead class="h-10 w-[200px] text-xs font-medium text-muted-foreground"
                  >역할</TableHead
                >
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
                    <PersonChip :name="data.memberName(r.memberId) ?? '알 수 없음'" />
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
                      <SelectItem v-for="o in PROJECT_ROLE_OPTIONS" :key="o.value" :value="o.value">
                        {{ o.label }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
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
                <TableCell colspan="3" class="h-[110px] text-center text-sm text-muted-foreground">
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
      </div>
    </div>
  </AppShell>
</template>
