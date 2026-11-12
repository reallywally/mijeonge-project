<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { routerKey } from 'vue-router'
import { FilePlus2, FileSpreadsheet, FileText, TriangleAlert } from 'lucide-vue-next'
import DocCreateDialog from '@/components/app/DocCreateDialog.vue'
import SearchPicker from '@/components/app/SearchPicker.vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DOC_AGENDAS_MAX, DOC_KIND_LABEL } from '@/lib/document'
import { useDocumentStore } from '@/stores/document'
import type { Agenda, ProjectDocSummary } from '@/types/domain'

/* 안건 상세의 '실린 문서' — 이 안건이 연결된 문서 칩(누르면 그 문서), [문서에 담기]: 기존 문서를 골라 연결하거나
   이 안건을 담은 새 문서를 만든다. 문서 목록은 받아 둔 것에서 찾는다 — 아직 안 받았으면 한 번 받는다 */
const props = defineProps<{ agenda: Agenda }>()

const docs = useDocumentStore()
/* 라우터 없이 띄우는 곳(부품 검사)도 있어 RouterLink 대신 있으면 쓴다 */
const router = inject(routerKey, null)
onMounted(() => docs.ensureLoaded())

const linked = computed(() => docs.docsOfAgenda(props.agenda.id))
/** 담을 수 있는 문서 — 아직 안 담았고, 고칠 수 있고, 50개가 안 찬 것 */
const choices = computed(() =>
  docs.list.filter(
    (d) =>
      !d.agendas.some((l) => l.agendaId === props.agenda.id) &&
      d.agendas.length < DOC_AGENDAS_MAX &&
      docs.canEdit(d),
  ),
)
const changedHere = (d: ProjectDocSummary) => docs.changedOf(d).includes(props.agenda.id)

const pickOpen = ref(false)
const createOpen = ref(false)
const newTitle = ref('')

async function pick(d: ProjectDocSummary) {
  if (await docs.linkAgenda(d.id, props.agenda.id)) pickOpen.value = false
}

function createNew(title: string) {
  newTitle.value = title || props.agenda.title
  pickOpen.value = false
  createOpen.value = true
}

function openDoc(id: string) {
  void router?.push(`/documents/${id}`)
}
</script>

<template>
  <div class="flex flex-col gap-1.5 px-0.5" data-agenda-docs>
    <div class="flex items-center gap-2">
      <span class="w-[72px] shrink-0 text-xs text-muted-foreground">실린 문서</span>
      <span class="grow" />
      <button
        type="button"
        class="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        data-agenda-docs-add
        @click="pickOpen = true"
      >
        <FilePlus2 class="size-3" />
        문서에 담기
      </button>
    </div>
    <div v-if="linked.length" class="flex flex-wrap gap-1.5">
      <button
        v-for="d in linked"
        :key="d.id"
        type="button"
        class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border bg-background px-1.5 py-0.5 text-xs hover:bg-accent"
        :class="changedHere(d) ? 'border-status-warn/60' : 'border-border'"
        :title="changedHere(d) ? `${d.title} — 이 안건의 결정이 바뀐 뒤 아직 확인 안 함` : d.title"
        :data-agenda-doc="d.id"
        @click="openDoc(d.id)"
      >
        <component
          :is="d.kind === 'text' ? FileText : FileSpreadsheet"
          class="size-3 shrink-0 text-muted-foreground"
          :aria-label="DOC_KIND_LABEL[d.kind]"
        />
        <span class="truncate">{{ d.title }}</span>
        <TriangleAlert v-if="changedHere(d)" class="size-3 shrink-0 text-status-warn" />
      </button>
    </div>
    <p v-else class="text-xs text-muted-foreground">아직 담은 문서가 없습니다.</p>

    <Dialog v-model:open="pickOpen">
      <DialogContent class="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>문서에 담기</DialogTitle>
          <DialogDescription class="text-pretty">
            '{{ agenda.title }}' 을 담을 문서를 고르세요. 연결만 하고, 본문에 넣는 것은 문서 화면의
            [본문에 넣기] 로 합니다.
          </DialogDescription>
        </DialogHeader>
        <SearchPicker
          data-agenda-docs-dialog
          :items="choices"
          :text="(d) => d.title"
          :key-of="(d) => d.id"
          placeholder="문서 제목으로 찾기 · 없으면 새로 만들기"
          empty-label="문서 제목을 적어 새로 만들기"
          :create-label="(q) => `'${q}' 새 문서로 담기…`"
          @pick="pick"
          @create="createNew"
        >
          <template #item="{ item }">
            <component
              :is="item.kind === 'text' ? FileText : FileSpreadsheet"
              class="size-3.5 shrink-0 text-muted-foreground"
            />
            <span class="min-w-0 grow truncate">{{ item.title }}</span>
          </template>
        </SearchPicker>
        <Button
          variant="outline"
          size="sm"
          class="self-start"
          data-agenda-docs-new
          @click="createNew('')"
        >
          <FilePlus2 class="size-3.5" />
          이 안건을 담은 새 문서
        </Button>
      </DialogContent>
    </Dialog>

    <DocCreateDialog
      v-model:open="createOpen"
      :initial-title="newTitle"
      :initial-agenda-ids="[agenda.id]"
      @created="openDoc"
    />
  </div>
</template>
