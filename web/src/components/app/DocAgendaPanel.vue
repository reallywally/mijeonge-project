<script setup lang="ts">
import { computed, ref } from 'vue'
import { CheckCheck, CornerDownLeft, Link2, TriangleAlert, X } from 'lucide-vue-next'
import AgendaStateBadge from '@/components/app/AgendaStateBadge.vue'
import SearchPicker from '@/components/app/SearchPicker.vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DOC_AGENDAS_MAX } from '@/lib/document'
import { useAgendaStore } from '@/stores/agenda'
import { useDataStore } from '@/stores/data'
import { useDocumentStore } from '@/stores/document'
import type { Agenda, ProjectDoc } from '@/types/domain'

/* 문서 화면 오른쪽 '연결한 안건' 칸 — 줄마다 상태 · 제목(누르면 안건 상세) · 결정내용 몇 줄 · [본문에 넣기].
   결정이 바뀐 안건은 주황 테두리 + '결정 바뀜 — 판 n → m' + [확인]. 머리에 [모두 확인] · [안건 연결].
   읽기 전용이면 연결 · 확인 · 넣기를 숨기고 보기만 한다 */
const props = defineProps<{ doc: ProjectDoc; readonly?: boolean }>()
const emit = defineEmits<{
  (e: 'insert', agenda: Agenda): void
  (e: 'open-agenda', id: string): void
}>()

const data = useDataStore()
const agendaStore = useAgendaStore()
const docs = useDocumentStore()

const changed = computed(() => new Set(docs.changedOf(props.doc)))
const rows = computed(() =>
  docs
    .linksOf(props.doc)
    .map((link) => ({ link, agenda: data.allAgendas.find((a) => a.id === link.agendaId) }))
    .filter((r): r is { link: typeof r.link; agenda: Agenda } => r.agenda !== undefined),
)

const linkedIds = computed(() => new Set(props.doc.agendas.map((l) => l.agendaId)))
const RANK = { decided: 0, open: 1, queued: 2 } as const
/** 더 연결할 안건 — 결정된 것이 위 */
const choices = computed(() =>
  agendaStore.agendas
    .filter((a) => !linkedIds.value.has(a.id))
    .map((a, i) => ({ a, i }))
    .sort((x, y) => RANK[x.a.state] - RANK[y.a.state] || x.i - y.i)
    .map(({ a }) => a),
)
const full = computed(() => props.doc.agendas.length >= DOC_AGENDAS_MAX)

const pickOpen = ref(false)
const busy = ref(false)

async function busyWith(fn: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  try {
    await fn()
  } finally {
    busy.value = false
  }
}

const link = (agenda: Agenda) => busyWith(() => docs.linkAgenda(props.doc.id, agenda.id))
const unlink = (agendaId: string) => busyWith(() => docs.unlinkAgenda(props.doc.id, agendaId))
const confirmOne = (agendaId: string) => busyWith(() => docs.confirm(props.doc.id, [agendaId]))
const confirmAll = () => busyWith(() => docs.confirm(props.doc.id))
</script>

<template>
  <aside
    class="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-muted/50 px-4 pt-4 pb-6"
    aria-label="연결한 안건"
    data-doc-agendas
  >
    <div class="flex items-center gap-2">
      <h2 class="text-sm font-medium">연결한 안건</h2>
      <span class="text-xs text-muted-foreground tabular-nums">{{ rows.length }}</span>
      <span class="grow" />
      <Button
        v-if="!readonly && changed.size > 0"
        variant="outline"
        size="sm"
        :disabled="busy"
        data-doc-confirm-all
        @click="confirmAll"
      >
        <CheckCheck class="size-3.5" />
        모두 확인
      </Button>
      <Button
        v-if="!readonly"
        variant="outline"
        size="sm"
        :disabled="full"
        :title="full ? `안건은 ${DOC_AGENDAS_MAX}개까지 연결합니다.` : undefined"
        data-doc-link-open
        @click="pickOpen = true"
      >
        <Link2 class="size-3.5" />
        안건 연결
      </Button>
    </div>

    <p
      v-if="changed.size > 0"
      class="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"
      data-doc-changed-note
    >
      <TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-status-warn" />
      결정이 바뀐 안건 {{ changed.size }}건 — 본문을 고친 뒤 [확인] 하세요.
    </p>

    <p v-if="rows.length === 0" class="text-xs leading-relaxed text-muted-foreground">
      연결한 안건이 없습니다.<template v-if="!readonly">
        [안건 연결] 로 이 문서에 모아 적을 안건을 고르세요.</template
      >
    </p>

    <ul class="flex flex-col gap-2">
      <li
        v-for="{ link: l, agenda } in rows"
        :key="agenda.id"
        class="group flex flex-col gap-1.5 rounded-lg border bg-card px-3 py-2.5 shadow-sm"
        :class="changed.has(agenda.id) ? 'border-status-warn/60' : 'border-border'"
        :data-doc-agenda="agenda.id"
        :data-changed="changed.has(agenda.id) || undefined"
      >
        <div class="flex items-start gap-2">
          <button
            type="button"
            class="min-w-0 grow text-left text-[13px] leading-snug font-medium underline-offset-4 hover:underline"
            :title="agenda.title"
            data-doc-agenda-open
            @click="emit('open-agenda', agenda.id)"
          >
            {{ agenda.title }}
          </button>
          <AgendaStateBadge :state="agenda.state" class="shrink-0" />
          <button
            v-if="!readonly"
            type="button"
            class="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
            :aria-label="`${agenda.title} 연결 해제`"
            title="연결 해제"
            :disabled="busy"
            :data-doc-unlink="agenda.id"
            @click="unlink(agenda.id)"
          >
            <X class="size-3.5" />
          </button>
        </div>
        <p
          class="line-clamp-3 text-xs leading-relaxed whitespace-pre-wrap"
          :class="agenda.decision.trim() ? 'text-foreground/80' : 'text-muted-foreground'"
          :title="agenda.decision || undefined"
          data-doc-agenda-decision
        >
          {{ agenda.decision.trim() || '아직 정하지 않았습니다.' }}
        </p>
        <div
          v-if="changed.has(agenda.id)"
          class="flex items-center gap-2 rounded-md bg-status-warn/10 px-2 py-1 text-xs"
          data-doc-agenda-changed
        >
          <TriangleAlert class="size-3.5 shrink-0 text-status-warn" />
          <span class="grow">결정 바뀜 — 판 {{ l.seenRev }} → {{ agenda.decisionRev }}</span>
          <Button
            v-if="!readonly"
            variant="outline"
            size="sm"
            class="h-6 px-2 text-xs"
            :disabled="busy"
            :data-doc-confirm="agenda.id"
            @click="confirmOne(agenda.id)"
          >
            확인
          </Button>
        </div>
        <button
          v-if="!readonly"
          type="button"
          class="flex items-center gap-1 self-start rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          :data-doc-insert="agenda.id"
          @click="emit('insert', agenda)"
        >
          <CornerDownLeft class="size-3" />
          본문에 넣기
        </button>
      </li>
    </ul>

    <Dialog v-model:open="pickOpen">
      <DialogContent class="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>안건 연결</DialogTitle>
          <DialogDescription class="text-pretty">
            고르면 바로 연결됩니다. 연결할 때의 결정 판을 적어 두었다가, 결정이 바뀌면 알려 줍니다.
          </DialogDescription>
        </DialogHeader>
        <SearchPicker
          data-doc-link-dialog
          :items="choices"
          :text="(a) => a.title"
          :key-of="(a) => a.id"
          placeholder="안건 제목으로 찾기 — 결정된 안건이 위"
          empty-label="더 연결할 안건이 없습니다"
          @pick="link"
        >
          <template #item="{ item }">
            <span class="min-w-0 grow truncate">{{ item.title }}</span>
            <AgendaStateBadge :state="item.state" />
          </template>
        </SearchPicker>
        <p class="text-xs text-muted-foreground tabular-nums">
          연결한 안건 {{ doc.agendas.length }} / {{ DOC_AGENDAS_MAX }}
        </p>
      </DialogContent>
    </Dialog>
  </aside>
</template>
