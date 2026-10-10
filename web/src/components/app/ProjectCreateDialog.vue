<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
import { taskKeyPrefixError } from '@/lib/project'
import { useDataStore } from '@/stores/data'

/* 프로젝트 등록 — 목록 위 팝업. 접두사는 선택이고, 비우면 겹치지 않는 값이 붙는다 (API.md Q20) */
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ (e: 'created', id: string): void }>()

const data = useDataStore()

const name = ref('')
const prefix = ref('')
const saving = ref(false)

watch(open, (isOpen) => {
  if (isOpen) {
    name.value = ''
    prefix.value = ''
  }
})

const takenPrefixes = computed(() => data.allProjects.map((p) => p.taskKeyPrefix))
const prefixError = computed(() => taskKeyPrefixError(prefix.value, takenPrefixes.value))

/** 비워 두면 자동으로 붙을 값까지 미리 보여 준다 — 저장하고 놀라지 않게.
    서버가 만드는 값은 임의라 미리 맞힐 수 없어 '자동' 으로만 적는다 (API.md Q21) */
const keyPreview = computed(() => {
  const typed = prefix.value.trim().toUpperCase()
  if (prefixError.value) return ''
  const value = typed || data.suggestTaskKeyPrefix()
  return value ? `${value}-1` : null
})

const canSubmit = computed(
  () => name.value.trim() !== '' && prefixError.value === null && !saving.value,
)

/* 팝업을 여기서 닫지 않는다 — 주소가 팝업을 여닫으므로 만든 뒤 어디로 갈지는 화면이 정한다 */
async function submit() {
  if (!canSubmit.value) return
  saving.value = true
  const id = await data.addProject(name.value.trim(), prefix.value)
  saving.value = false
  if (id) emit('created', id)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>프로젝트 추가</DialogTitle>
        <DialogDescription class="text-pretty">
          가장 큰 단위입니다. 작업 · 안건은 모두 프로젝트 하나 안에서만 돕니다.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3.5 py-1">
        <div class="flex flex-col gap-2">
          <Label>이름</Label>
          <Input v-model="name" placeholder="예: 한화손보 차세대" @keyup.enter="submit" />
        </div>

        <div class="flex flex-col gap-2">
          <Label>작업 키 접두사 (선택)</Label>
          <Input
            v-model="prefix"
            placeholder="예: HW — 비우면 자동으로 붙습니다"
            class="w-[220px] uppercase"
            @keyup.enter="submit"
          />
          <p v-if="prefixError" class="text-xs leading-relaxed text-destructive">
            {{ prefixError }}
          </p>
          <p
            v-else-if="keyPreview"
            class="text-xs leading-relaxed text-muted-foreground text-pretty"
          >
            대화에서 작업을 한 마디로 가리키는 값입니다. 첫 작업이
            <span class="font-medium text-foreground">{{ keyPreview }}</span> 로 섭니다.
          </p>
          <p v-else class="text-xs leading-relaxed text-muted-foreground text-pretty">
            대화에서 작업을 한 마디로 가리키는 값입니다. 비워 두면 저장할 때 자동으로 붙습니다.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">취소</Button>
        <Button :disabled="!canSubmit" @click="submit">{{
          saving ? '저장하는 중…' : '저장'
        }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
