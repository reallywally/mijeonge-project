<script setup lang="ts">
import { computed } from 'vue'
import { CalendarDays, CornerDownRight, ListTree, Sparkles, TriangleAlert } from 'lucide-vue-next'
import OwnerSelect from '@/components/app/OwnerSelect.vue'
import AgendaStateBadge from '@/components/app/AgendaStateBadge.vue'
import AgendaStateSelect from '@/components/app/AgendaStateSelect.vue'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { monthDay } from '@/lib/date'
import { taskPriorityLabel } from '@/lib/task'
import { updateKey } from '@/lib/minutes'
import { useDataStore } from '@/stores/data'
import { useMinutesDraftStore } from '@/stores/minutesDraft'
import { useAgendaStore } from '@/stores/agenda'

/* 회의록 초안 검토 — 요약과 세 묶음(새 안건 · 기존 안건 결정내용 바꾸기 · 작업). 줄마다 체크(기본 켬) · 고칠 칸 · 근거.
   근거(quote)는 AI 가 회의록에서 옮긴 글이라 v-html 없이 흐리게 둔다. 고친 값은 스토어의 사본(form)에 바로 들어간다.
   요약은 [등록] 때 회의록에 저장되므로 고칠 수 있게 둔다 */
const emit = defineEmits<{ 'open-agenda': [id: string] }>()

const minutes = useMinutesDraftStore()
const data = useDataStore()
const agendaStore = useAgendaStore()

const form = computed(() => minutes.form!)

const existing = (agendaId: string) => agendaStore.rows.find((r) => r.agenda.id === agendaId)
/* 상태 고르기 칸 — 검토 줄은 작게 */
const STATE_TRIGGER = 'h-8 w-full bg-background px-2 text-xs'
const newTitle = (tempId: string) =>
  form.value.agendas.find((t) => t.tempId === tempId)?.title || '제목 없는 새 안건'
const parentLabel = (parentTempId: string | null, parentId: string | null) => {
  if (parentTempId) return form.value.tasks.find((t) => t.tempId === parentTempId)?.title ?? ''
  const parent = parentId ? data.allTasks.find((t) => t.id === parentId) : null
  return parent ? `${parent.key} ${parent.title}` : (parentId ?? '')
}

/* 끈 줄은 흐리게 — 체크는 흐리지 않아야 다시 켤 자리가 보인다 */
const rowClass = (tempId: string) => (minutes.picked[tempId] ? '' : 'bg-muted/50')
const bodyClass = (tempId: string) => (minutes.picked[tempId] ? '' : 'opacity-60')

const problemOf = (tempId: string) =>
  minutes.picked[tempId] ? (minutes.problems[tempId] ?? minutes.rowErrors[tempId] ?? '') : ''

/* 날짜는 다 고른 뒤(change)에만 넣는다 — 글자를 치는 중의 반쪽 날짜를 넣지 않게 */
const picked = (e: Event) => (e.target as HTMLInputElement).value || null
</script>

<template>
  <div class="flex flex-col gap-6">
    <section
      class="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-[17px] py-[13px] shadow-sm"
      aria-label="요약"
    >
      <div class="flex items-center gap-2 text-sm font-medium">
        <Sparkles class="size-4 text-muted-foreground" />
        회의 요약
        <span class="text-xs font-normal text-muted-foreground"
          >등록하면 회의록에 이 요약이 남습니다</span
        >
      </div>
      <Textarea
        v-model="form.summary"
        rows="4"
        class="resize-y bg-background text-sm leading-relaxed"
        aria-label="회의 요약"
        data-minutes-summary
      />
      <p class="flex items-center gap-1.5 text-xs text-muted-foreground" data-minutes-date>
        <CalendarDays class="size-3.5" />
        <template v-if="form.meetingDate">
          회의 날짜 {{ monthDay(form.meetingDate) }} — "다음 주 금요일" 같은 날짜는 이 날 기준으로
          바꿨어요
        </template>
        <template v-else>날짜를 못 읽어 오늘 기준으로 바꿨어요</template>
      </p>
    </section>

    <!-- 새 안건 -->
    <section v-if="form.agendas.length > 0" class="flex flex-col gap-2" aria-label="새 안건">
      <h2 class="flex items-baseline gap-2 text-sm font-medium">
        새 안건
        <span class="text-xs font-normal text-muted-foreground">{{ form.agendas.length }}</span>
      </h2>
      <ul class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        <li
          v-for="t in form.agendas"
          :key="t.tempId"
          class="flex gap-3 px-4 py-3"
          :class="rowClass(t.tempId)"
          :data-minutes-row="t.tempId"
        >
          <Checkbox
            class="mt-2"
            :model-value="minutes.picked[t.tempId]"
            :aria-label="`새 안건 '${t.title}' 등록`"
            @update:model-value="(v) => minutes.setPicked(t.tempId, v === true)"
          />
          <div class="flex min-w-0 grow flex-col gap-2" data-row-body :class="bodyClass(t.tempId)">
            <Input v-model="t.title" class="h-8 text-sm font-medium" aria-label="안건 제목" />
            <div class="grid grid-cols-3 gap-2">
              <OwnerSelect v-model="t.ownerId" label="담당자" :hint="t.ownerHint" />
              <Input
                :model-value="t.dueDate ?? ''"
                type="date"
                class="h-8 text-xs"
                aria-label="결정 기한"
                @change="(e: Event) => (t.dueDate = picked(e))"
              />
              <AgendaStateSelect v-model="t.state" :trigger-class="STATE_TRIGGER" />
            </div>
            <p v-if="t.description" class="text-xs leading-relaxed text-muted-foreground">
              {{ t.description }}
            </p>
            <Textarea
              v-model="t.decision"
              rows="2"
              class="resize-y bg-background text-sm leading-relaxed"
              aria-label="결정내용"
              placeholder="이 회의에서 정한 것 (없으면 비워 둡니다)"
              data-minutes-agenda-decision
            />
            <blockquote
              class="border-l-2 border-border pl-2.5 text-xs leading-relaxed text-muted-foreground opacity-80"
              data-minutes-quote
            >
              {{ t.quote }}
            </blockquote>
            <p v-if="problemOf(t.tempId)" class="text-xs text-destructive" role="alert">
              {{ problemOf(t.tempId) }}
            </p>
          </div>
        </li>
      </ul>
    </section>

    <!-- 기존 안건 결정내용 바꾸기 — 지금 결정내용을 통째로 갈아끼운다 -->
    <section
      v-if="form.updates.length > 0"
      class="flex flex-col gap-2"
      aria-label="기존 안건 결정내용 바꾸기"
    >
      <h2 class="flex items-baseline gap-2 text-sm font-medium">
        기존 안건 결정내용 바꾸기
        <span class="text-xs font-normal text-muted-foreground">{{ form.updates.length }}</span>
        <span class="text-xs font-normal text-muted-foreground"
          >등록하면 지금 결정내용이 아래 글로 바뀝니다</span
        >
      </h2>
      <ul class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        <li
          v-for="u in form.updates"
          :key="u.agendaId"
          class="flex gap-3 px-4 py-3"
          :class="rowClass(updateKey(u.agendaId))"
          :data-minutes-row="updateKey(u.agendaId)"
        >
          <Checkbox
            class="mt-1"
            :model-value="minutes.picked[updateKey(u.agendaId)]"
            :aria-label="`'${existing(u.agendaId)?.agenda.title ?? u.agendaId}' 결정내용 바꾸기`"
            @update:model-value="(v) => minutes.setPicked(updateKey(u.agendaId), v === true)"
          />
          <div
            class="flex min-w-0 grow flex-col gap-2"
            data-row-body
            :class="bodyClass(updateKey(u.agendaId))"
          >
            <div class="flex min-w-0">
              <button
                v-if="existing(u.agendaId)"
                type="button"
                class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs hover:bg-accent"
                :data-minutes-agenda="u.agendaId"
                @click="emit('open-agenda', u.agendaId)"
              >
                <ListTree class="size-3 shrink-0 text-muted-foreground" />
                <span class="truncate">{{ existing(u.agendaId)!.agenda.title }}</span>
                <AgendaStateBadge :state="existing(u.agendaId)!.agenda.state" />
              </button>
              <span v-else class="text-xs text-muted-foreground">찾을 수 없는 안건</span>
            </div>
            <p
              v-if="existing(u.agendaId)?.agenda.decision"
              class="text-xs whitespace-pre-line text-muted-foreground line-through"
              data-minutes-current-decision
            >
              {{ existing(u.agendaId)!.agenda.decision }}
            </p>
            <Textarea
              v-model="u.decision"
              rows="3"
              class="resize-y bg-background text-sm leading-relaxed"
              aria-label="새 결정내용"
              data-minutes-update-decision
            />
            <div class="grid grid-cols-3 gap-2">
              <AgendaStateSelect v-model="u.state" :trigger-class="STATE_TRIGGER" />
            </div>
            <blockquote
              v-if="u.quote"
              class="border-l-2 border-border pl-2.5 text-xs leading-relaxed text-muted-foreground opacity-80"
              data-minutes-quote
            >
              {{ u.quote }}
            </blockquote>
            <p
              v-if="problemOf(updateKey(u.agendaId))"
              class="text-xs text-destructive"
              role="alert"
            >
              {{ problemOf(updateKey(u.agendaId)) }}
            </p>
          </div>
        </li>
      </ul>
    </section>

    <!-- 작업 -->
    <section v-if="form.tasks.length > 0" class="flex flex-col gap-2" aria-label="작업">
      <h2 class="flex items-baseline gap-2 text-sm font-medium">
        작업
        <span class="text-xs font-normal text-muted-foreground">{{ form.tasks.length }}</span>
      </h2>
      <ul class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        <li
          v-for="t in form.tasks"
          :key="t.tempId"
          class="flex gap-3 px-4 py-3"
          :class="rowClass(t.tempId)"
          :data-minutes-row="t.tempId"
        >
          <Checkbox
            class="mt-2"
            :model-value="minutes.picked[t.tempId]"
            :aria-label="`작업 '${t.title}' 등록`"
            @update:model-value="(v) => minutes.setPicked(t.tempId, v === true)"
          />
          <div class="flex min-w-0 grow flex-col gap-2" data-row-body :class="bodyClass(t.tempId)">
            <Input v-model="t.title" class="h-8 text-sm font-medium" aria-label="작업 제목" />
            <div class="grid grid-cols-3 gap-2">
              <OwnerSelect v-model="t.ownerId" label="담당자" :hint="t.ownerHint" />
              <Input
                :model-value="t.start ?? ''"
                type="date"
                class="h-8 text-xs"
                aria-label="시작 날짜"
                @change="(ev: Event) => (t.start = picked(ev))"
              />
              <Input
                :model-value="t.due ?? ''"
                type="date"
                class="h-8 text-xs"
                aria-label="기한"
                @change="(ev: Event) => (t.due = picked(ev))"
              />
            </div>
            <div
              v-if="
                t.agendaTempIds.length > 0 ||
                t.agendaIds.length > 0 ||
                t.parentTempId ||
                t.parentId ||
                t.priority !== 'normal'
              "
              class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                v-if="t.parentTempId || t.parentId"
                class="inline-flex items-center gap-1"
                :class="minutes.losesParent(t.tempId) ? 'line-through' : ''"
              >
                <CornerDownRight class="size-3" />
                {{ parentLabel(t.parentTempId, t.parentId) }} 밑
              </span>
              <span
                v-for="tempId in t.agendaTempIds"
                :key="tempId"
                class="inline-flex max-w-full items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5"
                :class="minutes.picked[tempId] ? '' : 'line-through'"
                :data-minutes-link="tempId"
              >
                <ListTree class="size-3 shrink-0" />
                <span class="truncate">{{ newTitle(tempId) }}</span>
                <span class="shrink-0">· 새 안건</span>
              </span>
              <span
                v-for="agendaId in t.agendaIds"
                :key="agendaId"
                class="inline-flex max-w-full items-center gap-1 rounded-md border border-border px-1.5 py-0.5"
                :data-minutes-link="agendaId"
              >
                <ListTree class="size-3 shrink-0" />
                <span class="truncate">{{ existing(agendaId)?.agenda.title ?? agendaId }}</span>
              </span>
              <Badge v-if="t.priority !== 'normal'" variant="outline">
                우선순위 {{ taskPriorityLabel(t.priority) }}
              </Badge>
            </div>
            <p
              v-if="minutes.picked[t.tempId] && minutes.droppedAgendas(t.tempId).length > 0"
              class="flex items-center gap-1.5 text-xs text-destructive"
              data-minutes-dropped
            >
              <TriangleAlert class="size-3.5 shrink-0" />
              안건 연결이 빠집니다 — {{ minutes.droppedAgendas(t.tempId).join(', ') }}
            </p>
            <p
              v-if="minutes.picked[t.tempId] && minutes.losesParent(t.tempId)"
              class="flex items-center gap-1.5 text-xs text-destructive"
            >
              <TriangleAlert class="size-3.5 shrink-0" />
              상위 작업을 빼서 최상위 작업으로 들어갑니다
            </p>
            <blockquote
              class="border-l-2 border-border pl-2.5 text-xs leading-relaxed text-muted-foreground opacity-80"
              data-minutes-quote
            >
              {{ t.quote }}
            </blockquote>
            <p v-if="problemOf(t.tempId)" class="text-xs text-destructive" role="alert">
              {{ problemOf(t.tempId) }}
            </p>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
