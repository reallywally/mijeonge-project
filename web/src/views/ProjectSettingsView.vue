<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { toast } from 'vue-sonner'
import { Loader2, Lock, Plus, Trash2, UserMinus, X } from 'lucide-vue-next'
import { ApiError, messageOf } from '@/api'
import PersonChip from '@/components/app/PersonChip.vue'
import ProjectAdminFrame from '@/components/app/ProjectAdminFrame.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { projectPartsPath } from '@/lib/access'
import { dayTime } from '@/lib/date'
import { PROJECT_ROLE_OPTIONS, memberLabel } from '@/lib/member'
import {
  PROJECT_DESCRIPTION_MAX,
  PROJECT_STATUS_OPTIONS,
  projectDateRangeError,
} from '@/lib/project'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import type { Project, ProjectPatch, ProjectRole, ProjectStatus } from '@/types/domain'

/* 프로젝트 관리 — 프로젝트 정보(상태 포함) · 멤버, 시스템 관리자에게는 삭제까지.
   파트 소속은 여기서 보이기만 하고 고치는 곳은 파트 관리다 */
const data = useDataStore()
const auth = useAuthStore()
const partStore = usePartStore()
const route = useRoute()

const projectId = computed(() => String(route.params.projectId ?? ''))
const project = computed(() => data.allProjects.find((p) => p.id === projectId.value) ?? null)
const partsPath = computed(() => projectPartsPath(projectId.value))

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

/* 기본 정보 — 이름 · 설명 · 기간 · 상태를 한 번에 저장한다. 바뀐 칸만 보낸다 */
interface InfoDraft {
  name: string
  description: string
  startDate: string
  endDate: string
  status: ProjectStatus
}
const toDraft = (p: Project | null): InfoDraft => ({
  name: p?.name ?? '',
  description: p?.description ?? '',
  startDate: p?.startDate ?? '',
  endDate: p?.endDate ?? '',
  status: p?.status ?? 'active',
})
const draft = ref<InfoDraft>(toDraft(null))
const saving = ref(false)
const saveError = ref<{ code: string; message: string } | null>(null)

watch(
  () => [
    project.value?.id,
    project.value?.name,
    project.value?.description,
    project.value?.startDate,
    project.value?.endDate,
    project.value?.status,
  ],
  () => {
    draft.value = toDraft(project.value)
    saveError.value = null
  },
  { immediate: true },
)

const nullable = (value: string) => (value.trim() === '' ? null : value)

/** 서버에 보낼 바뀐 칸 — 비운 칸은 null(지우기) */
const patch = computed<ProjectPatch>(() => {
  const p = project.value
  if (!p) return {}
  const d = draft.value
  const out: ProjectPatch = {}
  if (d.name.trim() !== p.name) out.name = d.name.trim()
  const description = nullable(d.description.trim())
  if (description !== (p.description?.trim() || null)) out.description = description
  if (nullable(d.startDate) !== p.startDate) out.startDate = nullable(d.startDate)
  if (nullable(d.endDate) !== p.endDate) out.endDate = nullable(d.endDate)
  if (d.status !== p.status) out.status = d.status
  return out
})
const dirty = computed(() => Object.keys(patch.value).length > 0)

const nameError = computed(() => (draft.value.name.trim() === '' ? '이름을 적어 주세요.' : null))
const descriptionError = computed(() =>
  draft.value.description.length > PROJECT_DESCRIPTION_MAX
    ? `설명은 ${PROJECT_DESCRIPTION_MAX}자 이하로 적어 주세요.`
    : null,
)
/* 기간은 화면에서 먼저 막고, 그래도 서버가 막으면(다른 사람이 그사이 고침) 그 message 를 같은 자리에 띄운다 */
const rangeError = computed(
  () =>
    projectDateRangeError(draft.value.startDate, draft.value.endDate) ??
    (saveError.value?.code === 'PROJECT_DATE_RANGE' ? saveError.value.message : null),
)
const otherError = computed(() =>
  saveError.value && saveError.value.code !== 'PROJECT_DATE_RANGE' ? saveError.value.message : null,
)

const canSave = computed(
  () =>
    !!project.value &&
    dirty.value &&
    !saving.value &&
    !nameError.value &&
    !descriptionError.value &&
    !projectDateRangeError(draft.value.startDate, draft.value.endDate),
)

async function saveInfo() {
  if (!canSave.value) return
  saving.value = true
  saveError.value = null
  try {
    await data.updateProject(projectId.value, patch.value)
    toast.success('저장이 완료되었습니다.')
  } catch (e) {
    saveError.value = {
      code: e instanceof ApiError ? e.code : '',
      message: messageOf(e),
    }
  } finally {
    saving.value = false
  }
}

function clearPeriod() {
  draft.value.startDate = ''
  draft.value.endDate = ''
}

function resetInfo() {
  draft.value = toDraft(project.value)
  saveError.value = null
}

/* 날짜 칸이 바뀌면 지난 서버 오류는 걷는다 — 고친 값에 옛 말이 남지 않게 */
watch(
  () => [draft.value.startDate, draft.value.endDate],
  () => {
    if (saveError.value?.code === 'PROJECT_DATE_RANGE') saveError.value = null
  },
)

/* 삭제 — 시스템 관리자만. 이름을 그대로 쳐야 켜진다. 지운 뒤 갈 곳은 틀(ProjectAdminFrame)이 정한다 */
const deleteOpen = ref(false)
const deleteTyped = ref('')
const deleting = ref(false)
watch(deleteOpen, (open) => {
  if (open) deleteTyped.value = ''
})
const deleteMatches = computed(
  () => !!project.value && deleteTyped.value.trim() === project.value.name,
)
async function removeProject() {
  if (!deleteMatches.value || deleting.value) return
  deleting.value = true
  const ok = await data.deleteProject(projectId.value)
  deleting.value = false
  if (ok) deleteOpen.value = false
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
            프로젝트 정보와 이 프로젝트에 부여된 사람을 관리합니다. 파트를 만들고 사람을 넣고
            빼는 것은
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
            <div class="flex items-start gap-2.5">
              <span class="w-[92px] shrink-0 pt-1.5 text-sm text-muted-foreground">이름</span>
              <div class="flex grow flex-col gap-1">
                <Input
                  v-model="draft.name"
                  aria-label="프로젝트 이름"
                  :aria-invalid="!!nameError"
                  @keyup.enter="saveInfo"
                />
                <p v-if="nameError" class="text-xs text-destructive">{{ nameError }}</p>
              </div>
            </div>
            <div class="flex items-start gap-2.5">
              <span class="w-[92px] shrink-0 pt-1.5 text-sm text-muted-foreground">설명</span>
              <div class="flex grow flex-col gap-1">
                <Textarea
                  v-model="draft.description"
                  aria-label="프로젝트 설명"
                  rows="3"
                  placeholder="무엇을 하는 프로젝트인지 — 비워 둬도 됩니다"
                  :aria-invalid="!!descriptionError"
                />
                <p
                  class="text-xs tabular-nums"
                  :class="descriptionError ? 'text-destructive' : 'text-muted-foreground'"
                  data-description-count
                >
                  {{
                    descriptionError ?? `${draft.description.length} / ${PROJECT_DESCRIPTION_MAX}`
                  }}
                </p>
              </div>
            </div>
            <div class="flex items-start gap-2.5">
              <span class="w-[92px] shrink-0 pt-1.5 text-sm text-muted-foreground">기간</span>
              <div class="flex grow flex-col gap-1">
                <div class="flex items-center gap-2">
                  <Input
                    v-model="draft.startDate"
                    type="date"
                    aria-label="시작일"
                    class="w-[170px]"
                    :class="draft.startDate ? '' : 'text-muted-foreground'"
                    :max="draft.endDate || undefined"
                  />
                  <span class="text-sm text-muted-foreground">~</span>
                  <Input
                    v-model="draft.endDate"
                    type="date"
                    aria-label="종료일"
                    class="w-[170px]"
                    :class="draft.endDate ? '' : 'text-muted-foreground'"
                    :min="draft.startDate || undefined"
                    :aria-invalid="!!rangeError"
                  />
                  <Button
                    v-if="draft.startDate || draft.endDate"
                    variant="ghost"
                    size="sm"
                    class="text-muted-foreground"
                    @click="clearPeriod"
                  >
                    <X class="size-3.5" />
                    비우기
                  </Button>
                </div>
                <p v-if="rangeError" class="text-xs text-destructive" data-range-error>
                  {{ rangeError }}
                </p>
                <p v-else class="text-xs text-muted-foreground">
                  둘 다 비워 둘 수 있습니다. 한쪽만 적어도 됩니다.
                </p>
              </div>
            </div>
            <div class="flex items-start gap-2.5">
              <span class="w-[92px] shrink-0 pt-1.5 text-sm text-muted-foreground">상태</span>
              <div class="flex grow flex-col gap-1">
                <div class="flex flex-wrap items-center gap-2.5">
                  <div
                    role="group"
                    aria-label="프로젝트 상태"
                    class="flex items-center gap-0.5 rounded-md bg-secondary p-0.5"
                  >
                    <button
                      v-for="o in PROJECT_STATUS_OPTIONS"
                      :key="o.value"
                      type="button"
                      class="inline-flex h-7 items-center rounded-[5px] px-4 text-sm transition-colors"
                      :class="
                        draft.status === o.value
                          ? 'bg-background font-medium shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      "
                      :aria-pressed="draft.status === o.value"
                      :data-status-option="o.value"
                      @click="draft.status = o.value"
                    >
                      {{ o.label }}
                    </button>
                  </div>
                  <span
                    v-if="p.status === 'closed' && draft.status === 'closed' && p.closedAt"
                    class="text-xs text-muted-foreground"
                    data-closed-at
                    >{{ dayTime(p.closedAt) }}에 종료</span
                  >
                </div>
                <p class="text-xs leading-relaxed text-muted-foreground text-pretty">
                  표시만 바뀝니다 — 목록과 프로젝트 고르기에서 진행 · 준비 · 종료 순으로 서고, 작업 ·
                  안건은 어느 상태든 그대로 쓸 수 있습니다.
                </p>
              </div>
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
            <div class="flex items-center justify-end gap-2 border-t border-border pt-3">
              <p v-if="otherError" class="grow text-xs text-destructive" data-save-error>
                {{ otherError }}
              </p>
              <Button v-if="dirty" variant="outline" :disabled="saving" @click="resetInfo"
                >되돌리기</Button
              >
              <Button :disabled="!canSave" data-save-info @click="saveInfo">
                <Loader2 v-if="saving" class="animate-spin" />
                저장
              </Button>
            </div>
          </div>

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

        <!-- 프로젝트 관리자에게는 숨긴다 — 막는 것은 서버다 -->
        <section v-if="auth.systemAdmin" class="flex flex-col gap-3" aria-label="위험 구역">
          <h2 class="text-sm font-medium text-destructive">위험 구역</h2>
          <div
            class="flex items-center gap-3 rounded-lg border border-destructive/40 bg-card px-4 py-3 shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
          >
            <div class="flex min-w-0 grow flex-col gap-0.5">
              <span class="text-sm font-medium">프로젝트 삭제</span>
              <p class="text-xs leading-relaxed text-muted-foreground text-pretty">
                지우면 목록에서 빠지고 아무도 이 프로젝트를 열 수 없습니다. 작업 · 안건 · 기록도
                같이 볼 수 없게 됩니다. 시스템 관리자만 할 수 있습니다.
              </p>
            </div>
            <Button variant="destructive" class="shrink-0" @click="deleteOpen = true">
              <Trash2 class="size-4" />
              프로젝트 삭제
            </Button>
          </div>
        </section>

        <Dialog v-if="auth.systemAdmin" v-model:open="deleteOpen">
          <DialogContent class="sm:max-w-[460px]">
            <DialogHeader>
              <DialogTitle>프로젝트를 지울까요?</DialogTitle>
              <DialogDescription class="text-pretty">
                지운 프로젝트는 목록에서 빠지고 아무도 열 수 없습니다.
              </DialogDescription>
            </DialogHeader>
            <div class="flex flex-col gap-2 py-1">
              <Label for="project-delete-name" class="leading-relaxed">
                확인하려면 프로젝트 이름
                <span class="font-semibold">{{ p.name }}</span> 을(를) 그대로 입력하세요.
              </Label>
              <Input
                id="project-delete-name"
                v-model="deleteTyped"
                autocomplete="off"
                aria-label="지울 프로젝트 이름"
                @keyup.enter="removeProject"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" @click="deleteOpen = false">취소</Button>
              <Button
                variant="destructive"
                :disabled="!deleteMatches || deleting"
                data-delete-confirm
                @click="removeProject"
              >
                <Loader2 v-if="deleting" class="animate-spin" />
                지우기
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </template>
  </ProjectAdminFrame>
</template>
