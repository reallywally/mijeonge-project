<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FileSpreadsheet, FileText, Loader2, X } from 'lucide-vue-next'
import AgendaStateBadge from '@/components/app/AgendaStateBadge.vue'
import PartField from '@/components/app/PartField.vue'
import SearchPicker from '@/components/app/SearchPicker.vue'
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
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { folderOptions, folderPath } from '@/lib/docFolder'
import { DOC_AGENDAS_MAX, DOC_TITLE_MAX } from '@/lib/document'
import { cn } from '@/lib/utils'
import { useAgendaStore } from '@/stores/agenda'
import { useDocumentStore } from '@/stores/document'
import type { Agenda, DocKind } from '@/types/domain'

/* 새 문서 — 제목 · 종류(글 / 표, 만든 뒤 못 바꾼다) · 파트 · 폴더 · 연결할 안건(여럿, 결정된 안건이 위).
   안건 상세의 [문서에 담기] 가 그 안건을 미리 골라 연다. 폴더는 연 자리가 정한다(폴더 메뉴면 그 폴더, 보던 문서의 폴더,
   아니면 맨 위). 만들면 부모가 그 문서로 간다 */
const props = defineProps<{
  initialTitle?: string
  initialAgendaIds?: string[]
  initialFolderId?: string | null
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ (e: 'created', id: string): void }>()

const agendaStore = useAgendaStore()
const docs = useDocumentStore()

const title = ref('')
const kind = ref<DocKind>('text')
const partId = ref<string | null>(null)
const folderId = ref<string | null>(null)
const agendaIds = ref<string[]>([])
const saving = ref(false)

watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    title.value = props.initialTitle ?? ''
    kind.value = 'text'
    partId.value = null
    folderId.value = props.initialFolderId ?? null
    agendaIds.value = [...(props.initialAgendaIds ?? [])]
  },
  { immediate: true },
)

/* Select 는 빈 값을 못 받는다 — 맨 위는 따로 둔 값으로 */
const ROOT = 'root'
const folderChoices = computed(() => folderOptions(docs.folders))
const folderLabel = computed(() => folderPath(docs.folders, folderId.value))

const byId = computed(() => new Map(agendaStore.agendas.map((a) => [a.id, a] as const)))
const picked = computed(() =>
  agendaIds.value.map((id) => byId.value.get(id)).filter((a): a is Agenda => a !== undefined),
)
/** 고를 안건 — 결정된 것이 위, 그다음 논의중 · 대기 */
const RANK = { decided: 0, open: 1, queued: 2 } as const
const choices = computed(() =>
  agendaStore.agendas
    .filter((a) => !agendaIds.value.includes(a.id))
    .map((a, i) => ({ a, i }))
    .sort((x, y) => RANK[x.a.state] - RANK[y.a.state] || x.i - y.i)
    .map(({ a }) => a),
)
const full = computed(() => agendaIds.value.length >= DOC_AGENDAS_MAX)
const ready = computed(() => title.value.trim().length > 0 && !saving.value)

const KINDS = [
  { key: 'text' as const, label: '글 문서', hint: '워드처럼 — 서식 · .docx', icon: FileText },
  {
    key: 'sheet' as const,
    label: '표 문서',
    hint: '엑셀처럼 — 시트 · 수식 · .xlsx',
    icon: FileSpreadsheet,
  },
]

async function submit() {
  if (!ready.value) return
  saving.value = true
  const id = await docs.create({
    title: title.value,
    kind: kind.value,
    partId: partId.value,
    folderId: folderId.value,
    agendaIds: agendaIds.value,
  })
  saving.value = false
  if (!id) return
  open.value = false
  emit('created', id)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[560px]">
      <DialogHeader>
        <DialogTitle>새 문서</DialogTitle>
        <DialogDescription class="text-pretty">
          여러 안건에서 정한 것을 주제 하나로 모아 적습니다. 종류는 만든 뒤 바꿀 수 없습니다.
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" data-doc-create @submit.prevent="submit">
        <label class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground">제목</span>
          <Input
            v-model="title"
            :maxlength="DOC_TITLE_MAX"
            placeholder="예: 서버 구성"
            data-doc-create-title
          />
        </label>

        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground">종류</span>
          <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="종류">
            <button
              v-for="k in KINDS"
              :key="k.key"
              type="button"
              role="radio"
              :aria-checked="kind === k.key"
              :data-doc-create-kind="k.key"
              :class="
                cn(
                  'flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted',
                  kind === k.key && 'border-primary/35 bg-brand-soft hover:bg-brand-soft',
                )
              "
              @click="kind = k.key"
            >
              <component
                :is="k.icon"
                class="mt-0.5 size-4 shrink-0"
                :class="kind === k.key ? 'text-primary' : 'text-muted-foreground'"
              />
              <span class="flex flex-col gap-0.5">
                <span class="text-sm font-medium">{{ k.label }}</span>
                <span class="text-xs text-muted-foreground">{{ k.hint }}</span>
              </span>
            </button>
          </div>
        </div>

        <dl>
          <PartField v-model="partId" right="canCreate" trigger-class="h-8 w-full text-xs" />
          <div class="flex min-h-9 items-center gap-2">
            <dt class="w-[72px] shrink-0 text-xs text-muted-foreground">폴더</dt>
            <dd class="min-w-0 grow">
              <Select
                :model-value="folderId ?? ROOT"
                @update:model-value="(v) => (folderId = v === ROOT ? null : String(v))"
              >
                <SelectTrigger class="h-8 w-full text-xs" aria-label="폴더" data-doc-create-folder>
                  <span class="truncate" :class="folderId ? '' : 'text-muted-foreground'">{{
                    folderLabel
                  }}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="ROOT">최상위</SelectItem>
                  <SelectItem v-for="f in folderChoices" :key="f.id" :value="f.id">
                    <span :style="{ paddingLeft: `${(f.depth - 1) * 12}px` }">{{ f.name }}</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </dd>
          </div>
        </dl>

        <div class="flex flex-col gap-1.5">
          <span class="flex items-baseline gap-2 text-xs text-muted-foreground">
            연결할 안건
            <span class="tabular-nums">{{ agendaIds.length }}</span>
          </span>
          <SearchPicker
            v-if="!full"
            :items="choices"
            :text="(a) => a.title"
            :key-of="(a) => a.id"
            placeholder="안건 제목으로 찾기 — 결정된 안건이 위"
            empty-label="고를 안건이 없습니다"
            @pick="(a) => agendaIds.push(a.id)"
          >
            <template #item="{ item }">
              <span class="min-w-0 grow truncate">{{ item.title }}</span>
              <AgendaStateBadge :state="item.state" />
            </template>
          </SearchPicker>
          <p v-else class="text-xs text-muted-foreground">
            안건은 {{ DOC_AGENDAS_MAX }}개까지 연결합니다.
          </p>
          <ul v-if="picked.length" class="flex max-h-40 flex-col gap-1 overflow-y-auto">
            <li
              v-for="a in picked"
              :key="a.id"
              class="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1"
              :data-doc-create-agenda="a.id"
            >
              <span class="min-w-0 grow truncate text-xs">{{ a.title }}</span>
              <AgendaStateBadge :state="a.state" />
              <button
                type="button"
                class="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                :aria-label="`${a.title} 빼기`"
                @click="agendaIds = agendaIds.filter((id) => id !== a.id)"
              >
                <X class="size-3.5" />
              </button>
            </li>
          </ul>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" data-doc-create-cancel @click="open = false"
            >취소</Button
          >
          <Button type="submit" :disabled="!ready" data-doc-create-submit>
            <Loader2 v-if="saving" class="animate-spin" />
            만들기
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
