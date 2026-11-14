<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useDocumentStore } from '@/stores/document'

/* 문서 지우기 확인 — 문서 메뉴와 트리 메뉴가 같이 쓴다. 지운 뒤 어디로 갈지는 부른 쪽이 정한다 */
const props = defineProps<{ documentId: string | null }>()
const emit = defineEmits<{ (e: 'removed', documentId: string): void }>()
const open = defineModel<boolean>('open', { required: true })

const docs = useDocumentStore()
const title = computed(() => {
  const id = props.documentId
  if (!id) return ''
  return (docs.byId[id] ?? docs.list.find((d) => d.id === id))?.title ?? ''
})

const removing = ref(false)
async function remove() {
  const id = props.documentId
  if (!id || removing.value) return
  removing.value = true
  const name = title.value
  const ok = await docs.remove(id)
  removing.value = false
  if (!ok) return
  open.value = false
  toast.success(`'${name}' 문서를 지웠습니다.`)
  emit('removed', id)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle class="text-pretty">'{{ title }}' 문서를 지울까요?</DialogTitle>
        <DialogDescription class="text-pretty"
          >본문과 안건 연결이 함께 지워지고 되돌릴 수 없습니다. 안건은 그대로
          남습니다.</DialogDescription
        >
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="open = false">취소</Button>
        <Button variant="destructive" :disabled="removing" data-doc-remove-confirm @click="remove">
          <Loader2 v-if="removing" class="animate-spin" />
          지우기
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
