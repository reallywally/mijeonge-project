<script setup lang="ts">
import { ref, watch } from 'vue'
import { ChevronRight, FolderClosed } from 'lucide-vue-next'
import ThreadFields from '@/components/app/ThreadFields.vue'
import ThreadPropertyPanel from '@/components/app/ThreadPropertyPanel.vue'
import ThreadStateBadge from '@/components/app/ThreadStateBadge.vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogDescription, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { useDataStore } from '@/stores/data'
import { useThreadStore } from '@/stores/thread'

/* 안건 추가 — 안건 상세와 같은 모양의 팝업이다. 상세는 고치는 즉시 들어가지만 여기는 아직 안건이 없으니
   골라 두었다가 '만들기'로 한꺼번에 넣는다. 만들면 바로 그 안건의 상세로 넘어간다 — 거기서 결정을 남긴다. */
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ (e: 'created', id: string): void }>()

const data = useDataStore()
const threadStore = useThreadStore()

const title = ref('')
const description = ref('')
/* 후보는 한 줄에 하나 — 줄로 나누는 건 만들 때 한다 */
const options = ref('')
const dueDate = ref('')
const ownerId = ref<string | null>(null)
const keepOpen = ref(false)

const fields = ref<InstanceType<typeof ThreadFields> | null>(null)
const focusTitle = () => fields.value?.focusTitle()

function resetForm() {
  title.value = ''
  description.value = ''
  options.value = ''
  dueDate.value = ''
  ownerId.value = null
}

watch(
  open,
  (isOpen) => {
    if (isOpen) resetForm()
  },
  { immediate: true },
)

function submit() {
  if (!title.value.trim()) {
    focusTitle()
    return
  }
  const id = threadStore.addThread({
    title: title.value,
    description: description.value,
    options: options.value.split('\n'),
    dueDate: dueDate.value || null,
    ownerId: ownerId.value,
  })
  /* 만들고 계속 추가 — 폼만 비우고 팝업은 열어 둔다 */
  if (keepOpen.value) {
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
          <ThreadFields
            ref="fields"
            v-model:title="title"
            v-model:description="description"
            v-model:options="options"
          >
            <template #under-title>
              <DialogDescription class="text-xs text-muted-foreground">
                제목만 있어도 됩니다. 나머지는 아는 만큼만 적고, 상세에서 언제든 고칩니다.
              </DialogDescription>
            </template>
          </ThreadFields>
        </div>

        <ThreadPropertyPanel v-model:due-date="dueDate" v-model:owner-id="ownerId">
          <template #top>
            <div class="flex items-center gap-2">
              <ThreadStateBadge state="queued" />
              <span class="text-xs text-muted-foreground">만들면 대기로 들어갑니다</span>
            </div>
          </template>
        </ThreadPropertyPanel>
      </div>

      <div class="flex items-center gap-2.5 border-t border-border bg-muted/50 px-5 py-3">
        <label class="flex items-center gap-2">
          <Checkbox :model-value="keepOpen" @update:model-value="(v) => (keepOpen = v === true)" />
          <span class="text-xs text-muted-foreground">만들고 계속 추가</span>
        </label>
        <div class="grow" />
        <span class="text-xs text-muted-foreground">{{
          title.trim() ? '⌘ / Ctrl + Enter' : '제목을 적어야 만들 수 있습니다'
        }}</span>
        <Button variant="outline" size="sm" @click="open = false">취소</Button>
        <Button size="sm" :disabled="!title.trim()" @click="submit">만들기</Button>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
