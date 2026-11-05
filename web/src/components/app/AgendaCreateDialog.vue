<script setup lang="ts">
import { ref, watch } from 'vue'
import { ChevronRight, FolderClosed } from 'lucide-vue-next'
import AgendaFields from '@/components/app/AgendaFields.vue'
import AgendaPropertyPanel from '@/components/app/AgendaPropertyPanel.vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogDescription, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { useDataStore } from '@/stores/data'
import { useAgendaStore } from '@/stores/agenda'
import type { AgendaState } from '@/types/domain'

/* 안건 추가 — 안건 상세와 같은 모양의 팝업이다. 왼쪽 제목 · 설명 · 결정내용, 오른쪽 속성 패널(상태 · 결정 기한 ·
   담당자 · 파트). 상세는 고치는 즉시 들어가지만 여기는 아직 안건이 없으니 적어 두었다가 '만들기'로 한꺼번에 넣는다.
   만들면 바로 그 안건의 상세로 넘어간다.
   작업 상세 · 추가에서도 띄운다 — 찾던 제목을 채워 열고(initialTitle), 만들면 그 작업에 건다(부모 몫).
   그때는 linkNote 로 어디에 걸리는지 알리고, 한 건만 만들므로 '계속 추가' 를 숨긴다. */
const props = defineProps<{ initialTitle?: string; linkNote?: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ (e: 'created', id: string): void }>()

const data = useDataStore()
const agendaStore = useAgendaStore()

const title = ref('')
const description = ref('')
const decision = ref('')
const state = ref<AgendaState>('queued')
/* 결정 기한은 'YYYY-MM-DD' 또는 빈 문자열(속성 패널과 같은 모양). 파트는 안 고르면 공통 */
const dueDate = ref('')
const ownerId = ref<string | null>(null)
const partId = ref<string | null>(null)
const keepOpen = ref(false)
const saving = ref(false)

const fields = ref<InstanceType<typeof AgendaFields> | null>(null)
const focusTitle = () => fields.value?.focusTitle()

function resetForm() {
  title.value = props.initialTitle ?? ''
  description.value = ''
  decision.value = ''
  state.value = 'queued'
  dueDate.value = ''
  ownerId.value = null
  partId.value = null
}

watch(
  open,
  (isOpen) => {
    if (isOpen) resetForm()
  },
  { immediate: true },
)

async function submit() {
  if (saving.value) return
  if (!title.value.trim()) {
    focusTitle()
    return
  }
  saving.value = true
  const id = await agendaStore.addAgenda({
    title: title.value,
    description: description.value,
    decision: decision.value,
    state: state.value,
    dueDate: dueDate.value || null,
    ownerId: ownerId.value,
    partId: partId.value,
  })
  saving.value = false
  /* 실패는 스토어가 알렸다 — 폼을 그대로 두어 다시 누를 수 있게 한다 */
  if (!id) return
  /* 만들고 계속 추가 — 폼만 비우고 팝업은 열어 둔다 */
  if (keepOpen.value && !props.linkNote) {
    resetForm()
    focusTitle()
    return
  }
  emit('created', id)
}

/* 어디서든 ⌘/Ctrl + Enter 로 만든다 */
function onKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogScrollContent
      class="max-w-[1100px] gap-0 p-0"
      @open-auto-focus.prevent="focusTitle"
      @keydown="onKeydown"
    >
      <div class="flex items-center gap-2 border-b border-border px-[22px] py-3.5 pr-[60px]">
        <FolderClosed class="size-3.5 text-muted-foreground" />
        <span class="text-xs text-muted-foreground">{{ data.currentProject?.name }}</span>
        <ChevronRight class="size-3 text-muted-foreground" />
        <span class="text-xs text-muted-foreground">안건</span>
        <ChevronRight class="size-3 text-muted-foreground" />
        <DialogTitle class="text-xs font-normal">안건 추가</DialogTitle>
      </div>

      <div class="flex items-stretch">
        <div class="flex min-w-0 grow flex-col px-[22px] pt-4 pb-6">
          <AgendaFields
            ref="fields"
            v-model:title="title"
            v-model:description="description"
            v-model:decision="decision"
          >
            <template #under-title>
              <DialogDescription class="text-xs text-muted-foreground">
                제목만 있어도 됩니다. 나머지는 아는 만큼만 적고, 상세에서 언제든 고칩니다.
              </DialogDescription>
              <p v-if="linkNote" class="text-xs font-medium text-primary" data-agenda-link-note>
                {{ linkNote }}
              </p>
            </template>
          </AgendaFields>
        </div>

        <AgendaPropertyPanel
          v-model:state="state"
          v-model:due-date="dueDate"
          v-model:owner-id="ownerId"
          v-model:part-id="partId"
        />
      </div>

      <div class="flex items-center gap-2.5 border-t border-border bg-muted/50 px-5 py-3">
        <label v-if="!linkNote" class="flex items-center gap-2">
          <Checkbox :model-value="keepOpen" @update:model-value="(v) => (keepOpen = v === true)" />
          <span class="text-xs text-muted-foreground">만들고 계속 추가</span>
        </label>
        <div class="grow" />
        <span class="text-xs text-muted-foreground">{{
          title.trim() ? '⌘ / Ctrl + Enter' : '제목을 적어야 만들 수 있습니다'
        }}</span>
        <Button variant="outline" size="sm" @click="open = false">취소</Button>
        <Button size="sm" :disabled="!title.trim() || saving" @click="submit">
          {{ saving ? '만드는 중…' : linkNote ? '만들고 연결' : '만들기' }}
        </Button>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
