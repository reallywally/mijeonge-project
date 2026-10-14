<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Search,
  UserMinus,
  Users,
} from 'lucide-vue-next'
import PersonChip from '@/components/app/PersonChip.vue'
import ProjectAdminFrame from '@/components/app/ProjectAdminFrame.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { memberLabel } from '@/lib/member'
import { partNameProblem } from '@/lib/part'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import type { Part } from '@/types/domain'

/* 파트 관리 — 왼쪽에서 파트 하나를 고르고 오른쪽에서 그 파트를 다룬다. 고른 파트는 주소(?part=)에 싣는다.
   파트는 보기 범위지 권한이 아니다 (docs/api/part.md). 지우지 않고 보관한다 — 지난 작업 · 안건이 가리킨다.
   이 화면은 주소의 프로젝트 = 고른 프로젝트라 part 스토어를 그대로 쓴다 */
const data = useDataStore()
const partStore = usePartStore()
const route = useRoute()
const router = useRouter()

const projectId = computed(() => String(route.params.projectId ?? ''))
const basePath = computed(() => `/projects/${projectId.value}/parts`)
const ready = computed(() => !data.syncing && data.holdsRecordsOf(projectId.value))

const activeParts = computed(() => partStore.parts.filter((p) => p.active))
const archivedParts = computed(() => partStore.parts.filter((p) => !p.active))

/** 파트마다 사람 · 작업 · 안건 수 */
const countsOf = computed(() => {
  const counts: Record<string, { people: number; tasks: number; threads: number }> = {}
  for (const p of partStore.parts) counts[p.id] = { people: 0, tasks: 0, threads: 0 }
  for (const pm of data.partMembers) if (counts[pm.partId]) counts[pm.partId].people += 1
  for (const t of data.allTasks) if (t.partId && counts[t.partId]) counts[t.partId].tasks += 1
  for (const t of data.allThreads) if (t.partId && counts[t.partId]) counts[t.partId].threads += 1
  return counts
})
const countOf = (partId: string) => countsOf.value[partId] ?? { people: 0, tasks: 0, threads: 0 }

/* 고른 파트 — 주소가 정본이다. 없거나 이 프로젝트에 없는 id 면 첫 파트로 바꿔 싣는다 */
const queryPartId = computed(() => (typeof route.query.part === 'string' ? route.query.part : null))
const selected = computed<Part | null>(
  () => partStore.parts.find((p) => p.id === queryPartId.value) ?? null,
)

watch(
  [ready, () => partStore.parts.length, queryPartId],
  () => {
    if (!ready.value || selected.value) return
    const first = activeParts.value[0] ?? partStore.parts[0]
    if (first) void router.replace({ path: basePath.value, query: { part: first.id } })
    else if (queryPartId.value) void router.replace(basePath.value)
  },
  { immediate: true },
)

function pick(partId: string) {
  if (partId === selected.value?.id) return
  void router.push({ path: basePath.value, query: { part: partId } })
}

const archivedOpen = ref(false)
const showArchived = computed(() => archivedOpen.value || selected.value?.active === false)

/* 새 파트 — 만들면 그 파트를 고른다 */
const newPartName = ref('')
const creating = ref(false)
const newPartProblem = computed(() =>
  newPartName.value.trim() ? partNameProblem(newPartName.value) : null,
)
async function createPart() {
  const name = newPartName.value.trim()
  if (!name || newPartProblem.value || creating.value) return
  creating.value = true
  const ok = await partStore.createPart(name)
  creating.value = false
  if (!ok) return
  newPartName.value = ''
  const made = partStore.parts.find((p) => p.name === name)
  if (made) pick(made.id)
}

/* 이름 바꾸기 */
const nameDraft = ref('')
watch(
  () => [selected.value?.id, selected.value?.name],
  () => (nameDraft.value = selected.value?.name ?? ''),
  { immediate: true },
)
const nameProblem = computed(() => (selected.value ? partNameProblem(nameDraft.value) : null))
const renaming = ref(false)
const canRename = computed(
  () =>
    !!selected.value &&
    !nameProblem.value &&
    nameDraft.value.trim() !== selected.value.name &&
    !renaming.value,
)
async function rename() {
  if (!canRename.value || !selected.value) return
  renaming.value = true
  const ok = await partStore.renamePart(selected.value.id, nameDraft.value)
  renaming.value = false
  if (!ok) nameDraft.value = selected.value.name
}

/* 보관 · 되살리기 — 되돌릴 수 있어 묻지 않는다 */
const archiving = ref(false)
async function setActive(active: boolean) {
  if (!selected.value || archiving.value) return
  archiving.value = true
  await partStore.setPartActive(selected.value.id, active)
  archiving.value = false
}

/* 이 파트의 사람 */
const projectRoleOf = (memberId: string) =>
  data.projectMembers[projectId.value]?.find((p) => p.memberId === memberId)?.role ?? null

const people = computed(() => {
  if (!selected.value) return []
  return partStore
    .membersOf(selected.value.id)
    .map((id) => ({ id, member: data.allMembers.find((m) => m.id === id) ?? null }))
    .sort((a, b) => (a.member?.name ?? '').localeCompare(b.member?.name ?? '', 'ko'))
})

const leavingId = ref<string | null>(null)
async function leave(memberId: string) {
  if (!selected.value || leavingId.value) return
  leavingId.value = memberId
  await partStore.leavePart(selected.value.id, memberId)
  leavingId.value = null
}

/* 사람 더하기 — 프로젝트에 부여된 활성 멤버 중 아직 이 파트에 없는 사람. 찾아서 여럿을 한 번에 고른다 */
const candidates = computed(() => {
  if (!selected.value) return []
  const inPart = new Set(partStore.membersOf(selected.value.id))
  const granted = new Set((data.projectMembers[projectId.value] ?? []).map((p) => p.memberId))
  return data.allMembers
    .filter((m) => m.active && granted.has(m.id) && !inPart.has(m.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
})
const search = ref('')
const shownCandidates = computed(() => {
  const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return candidates.value.filter((m) => words.every((w) => m.name.toLowerCase().includes(w)))
})
const picked = ref<string[]>([])
watch(
  () => selected.value?.id,
  () => {
    picked.value = []
    search.value = ''
  },
)
/* 다른 데서 이미 넣어진 사람은 고른 것에서 걷는다 */
watch(candidates, (list) => {
  const left = new Set(list.map((m) => m.id))
  picked.value = picked.value.filter((id) => left.has(id))
})

function togglePick(memberId: string, on: boolean) {
  picked.value = on
    ? [...new Set([...picked.value, memberId])]
    : picked.value.filter((id) => id !== memberId)
}

const joining = ref(false)
async function joinPicked() {
  if (!selected.value || picked.value.length === 0 || joining.value) return
  joining.value = true
  const partId = selected.value.id
  const failed: string[] = []
  /* 하나씩 보낸다 — 실패한 사람만 고른 채로 남는다 */
  for (const memberId of picked.value) {
    if (!(await partStore.joinPart(partId, memberId))) failed.push(memberId)
  }
  picked.value = failed
  if (failed.length === 0) search.value = ''
  joining.value = false
}

const listLink = (path: '/tasks' | '/threads') =>
  selected.value ? { path, query: { part: selected.value.id } } : path
</script>

<template>
  <ProjectAdminFrame
    section="parts"
    label="파트 관리"
    :meta="partStore.parts.length ? `${activeParts.length}개` : ''"
  >
    <template #default="{ project: p }">
      <div class="flex w-full max-w-[1100px] flex-col gap-4 pb-[26px]">
        <header class="flex flex-col gap-2.5">
          <h1 class="text-2xl font-semibold tracking-tight">{{ p.name }} · 파트 관리</h1>
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            파트는 보기 범위이지 권한이 아닙니다. '내 파트' 로 보면 공통 · 자기 파트 · 자기가 맡은
            것과 그 작업에 걸린 안건이 보입니다. 파트가 없으면 모두가 프로젝트 전체를 봅니다.
          </p>
        </header>

        <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
          <aside class="flex w-full flex-col gap-3 lg:w-[280px] lg:shrink-0" aria-label="파트 목록">
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center gap-2">
                <Input
                  v-model="newPartName"
                  aria-label="새 파트 이름"
                  placeholder="새 파트 이름 — 예) 인프라"
                  class="h-9 grow bg-background"
                  @keyup.enter="createPart"
                />
                <Button
                  class="shrink-0"
                  variant="outline"
                  size="icon"
                  aria-label="파트 만들기"
                  :disabled="!newPartName.trim() || !!newPartProblem || creating"
                  @click="createPart"
                >
                  <Loader2 v-if="creating" class="animate-spin" />
                  <Plus v-else class="size-4" />
                </Button>
              </div>
              <p v-if="newPartProblem" class="text-xs text-destructive">{{ newPartProblem }}</p>
            </div>

            <ul
              v-if="activeParts.length"
              class="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm"
            >
              <li
                v-for="part in activeParts"
                :key="part.id"
                class="border-b border-border last:border-b-0"
              >
                <button
                  type="button"
                  :data-part-id="part.id"
                  :aria-current="selected?.id === part.id ? 'true' : undefined"
                  class="flex w-full flex-col gap-0.5 px-3.5 py-2.5 text-left transition-colors hover:bg-accent"
                  :class="selected?.id === part.id ? 'bg-accent' : ''"
                  @click="pick(part.id)"
                >
                  <span class="truncate text-sm font-medium">{{ part.name }}</span>
                  <span class="text-xs text-muted-foreground">
                    {{ countOf(part.id).people }}명 · 작업 {{ countOf(part.id).tasks }} · 안건
                    {{ countOf(part.id).threads }}
                  </span>
                </button>
              </li>
            </ul>
            <p
              v-else-if="ready"
              class="rounded-lg border border-dashed border-border px-3.5 py-3 text-xs leading-relaxed text-muted-foreground"
            >
              아직 파트가 없습니다. 위에서 첫 파트를 만드세요.
            </p>
            <p v-else class="inline-flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
              <Loader2 class="size-3.5 animate-spin" />
              불러오는 중…
            </p>

            <div v-if="archivedParts.length" class="flex flex-col gap-1.5">
              <button
                type="button"
                class="inline-flex items-center gap-1 self-start px-1 text-xs text-muted-foreground hover:text-foreground"
                :aria-expanded="showArchived"
                @click="archivedOpen = !showArchived"
              >
                <ChevronDown v-if="showArchived" class="size-3.5" />
                <ChevronRight v-else class="size-3.5" />
                보관한 파트 {{ archivedParts.length }}개
              </button>
              <ul
                v-if="showArchived"
                class="flex flex-col overflow-hidden rounded-lg border border-dashed border-border"
              >
                <li
                  v-for="part in archivedParts"
                  :key="part.id"
                  class="border-b border-dashed border-border last:border-b-0"
                >
                  <button
                    type="button"
                    :data-part-id="part.id"
                    :aria-current="selected?.id === part.id ? 'true' : undefined"
                    class="flex w-full flex-col gap-0.5 px-3.5 py-2 text-left text-muted-foreground transition-colors hover:bg-accent"
                    :class="selected?.id === part.id ? 'bg-accent text-foreground' : ''"
                    @click="pick(part.id)"
                  >
                    <span class="truncate text-sm">{{ part.name }}</span>
                    <span class="text-xs">
                      {{ countOf(part.id).people }}명 · 작업 {{ countOf(part.id).tasks }} · 안건
                      {{ countOf(part.id).threads }}
                    </span>
                  </button>
                </li>
              </ul>
            </div>
          </aside>

          <section
            v-if="selected"
            :key="selected.id"
            class="flex min-w-0 grow flex-col gap-4 rounded-lg border border-border bg-card px-[20px] py-[18px] shadow-sm"
            aria-label="파트 상세"
            :data-selected-part="selected.id"
          >
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center gap-2">
                <Input
                  v-model="nameDraft"
                  aria-label="파트 이름"
                  class="h-10 grow bg-background text-base font-semibold"
                  @keyup.enter="rename"
                  @keydown.esc="nameDraft = selected.name"
                />
                <Button class="shrink-0" variant="outline" :disabled="!canRename" @click="rename">
                  <Loader2 v-if="renaming" class="animate-spin" />
                  이름 바꾸기
                </Button>
              </div>
              <p v-if="nameProblem" class="text-xs text-destructive">{{ nameProblem }}</p>
              <div
                class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"
              >
                <Badge v-if="!selected.active" variant="secondary">보관됨</Badge>
                <span>사람 {{ people.length }}명</span>
                <RouterLink
                  :to="listLink('/tasks')"
                  class="underline-offset-4 hover:text-foreground hover:underline"
                  data-link="tasks"
                  >작업 {{ countOf(selected.id).tasks }}건 보기</RouterLink
                >
                <RouterLink
                  :to="listLink('/threads')"
                  class="underline-offset-4 hover:text-foreground hover:underline"
                  data-link="threads"
                  >안건 {{ countOf(selected.id).threads }}건 보기</RouterLink
                >
              </div>
            </div>

            <div class="flex flex-col gap-2" aria-label="이 파트의 사람">
              <h2 class="flex items-center gap-1.5 text-sm font-medium">
                <Users class="size-4 text-muted-foreground" />
                사람
              </h2>
              <ul
                v-if="people.length"
                class="flex flex-col overflow-hidden rounded-md border border-border"
              >
                <li
                  v-for="person in people"
                  :key="person.id"
                  :data-member-id="person.id"
                  class="flex h-11 items-center gap-2 border-b border-border px-3 last:border-b-0"
                >
                  <PersonChip :name="person.member ? memberLabel(person.member) : '알 수 없음'" />
                  <Badge v-if="projectRoleOf(person.id) === 'admin'" variant="outline"
                    >프로젝트 관리자</Badge
                  >
                  <span class="grow" />
                  <Button
                    variant="ghost"
                    size="sm"
                    :disabled="leavingId === person.id"
                    :aria-label="`${person.member?.name ?? ''} 빼기`"
                    @click="leave(person.id)"
                  >
                    <Loader2 v-if="leavingId === person.id" class="size-3.5 animate-spin" />
                    <UserMinus v-else class="size-3.5" />
                    빼기
                  </Button>
                </li>
              </ul>
              <p
                v-else
                class="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground"
              >
                아직 이 파트에 사람이 없습니다.
              </p>
            </div>

            <div
              v-if="selected.active"
              class="flex flex-col gap-2 rounded-md bg-muted/50 px-3.5 py-3"
              aria-label="사람 더하기"
            >
              <h2 class="text-sm font-medium">사람 더하기</h2>
              <template v-if="candidates.length">
                <div
                  class="flex h-8 items-center gap-2 rounded-md border border-input bg-background px-2.5 shadow-sm focus-within:ring-1 focus-within:ring-ring"
                >
                  <Search class="size-3.5 shrink-0 text-muted-foreground" />
                  <input
                    v-model="search"
                    type="text"
                    aria-label="더할 사람 찾기"
                    placeholder="이름으로 찾기"
                    class="min-w-0 grow bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <ul class="flex max-h-56 flex-col overflow-y-auto">
                  <li v-for="m in shownCandidates" :key="m.id">
                    <label
                      :data-candidate-id="m.id"
                      class="flex h-9 cursor-pointer items-center gap-2.5 rounded-sm px-1.5 text-sm hover:bg-accent"
                    >
                      <Checkbox
                        :model-value="picked.includes(m.id)"
                        :aria-label="`${m.name} 고르기`"
                        @update:model-value="(v) => togglePick(m.id, v === true)"
                      />
                      <PersonChip :name="m.name" />
                    </label>
                  </li>
                  <li
                    v-if="shownCandidates.length === 0"
                    class="px-1.5 py-2 text-xs text-muted-foreground"
                  >
                    '{{ search.trim() }}' 이 들어간 사람이 없습니다
                  </li>
                </ul>
                <div class="flex items-center gap-2">
                  <span class="grow text-xs text-muted-foreground">
                    {{ picked.length ? `${picked.length}명 고름` : '더할 사람을 고르세요' }}
                  </span>
                  <Button size="sm" :disabled="picked.length === 0 || joining" @click="joinPicked">
                    <Loader2 v-if="joining" class="animate-spin" />
                    <Plus v-else class="size-4" />
                    {{ picked.length ? `${picked.length}명 더하기` : '더하기' }}
                  </Button>
                </div>
              </template>
              <p v-else class="text-xs leading-relaxed text-muted-foreground text-pretty">
                프로젝트에 부여된 사람이 모두 이 파트에 있습니다. 새 사람은
                <RouterLink
                  :to="`/projects/${projectId}/settings`"
                  class="text-foreground underline-offset-4 hover:underline"
                  >프로젝트 관리</RouterLink
                >에서 먼저 부여합니다.
              </p>
            </div>

            <div class="flex items-center gap-3 border-t border-border pt-4" aria-label="보관">
              <p class="grow text-xs leading-relaxed text-muted-foreground text-pretty">
                <template v-if="selected.active">
                  보관하면 새 작업 · 안건에서 고를 수 없고 목록 아래로 접힙니다. 이미 달린 작업 ·
                  안건과 사람은 그대로 남습니다.
                </template>
                <template v-else>
                  보관한 파트입니다. 되살리면 다시 작업 · 안건에서 고르고 사람을 더할 수 있습니다.
                </template>
              </p>
              <Button
                v-if="selected.active"
                class="shrink-0"
                variant="outline"
                size="sm"
                :disabled="archiving"
                @click="setActive(false)"
              >
                <Archive class="size-3.5" />
                보관
              </Button>
              <Button
                v-else
                class="shrink-0"
                variant="outline"
                size="sm"
                :disabled="archiving"
                @click="setActive(true)"
              >
                <ArchiveRestore class="size-3.5" />
                되살리기
              </Button>
            </div>
          </section>

          <section
            v-else-if="ready && partStore.parts.length === 0"
            class="flex min-w-0 grow flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-6 py-12 text-center"
          >
            <p class="text-sm font-medium">파트가 없습니다</p>
            <p class="max-w-[420px] text-xs leading-relaxed text-muted-foreground text-pretty">
              AI · 인프라 · 기간계 연동처럼 일을 나누는 단위로 만들면, 사람마다 '내 파트' 로 자기
              일과 그 일에 걸린 안건만 추려 볼 수 있습니다.
            </p>
          </section>
        </div>
      </div>
    </template>
  </ProjectAdminFrame>
</template>
