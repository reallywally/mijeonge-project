<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import PasswordChangeForm from '@/components/app/PasswordChangeForm.vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/* 내 비밀번호 바꾸기 — 내 이름 메뉴에서 연다. 칸과 보내기는 마이페이지와 같은 PasswordChangeForm 이다.
   닫으면 창 안이 내려가 다시 열 때 칸이 비어 있다 */
const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>비밀번호 바꾸기</DialogTitle>
        <DialogDescription class="text-pretty">
          바꾸면 이 브라우저 말고 다른 곳에 로그인된 세션은 모두 끊깁니다.
        </DialogDescription>
      </DialogHeader>

      <PasswordChangeForm id-prefix="pw-dialog" class="py-1" @changed="open = false">
        <template #actions="{ canSubmit, saving, submit }">
          <DialogFooter class="pt-1">
            <Button type="button" variant="outline" @click="open = false">취소</Button>
            <Button type="button" :disabled="!canSubmit" @click="submit">
              <Loader2 v-if="saving" class="animate-spin" />
              바꾸기
            </Button>
          </DialogFooter>
        </template>
      </PasswordChangeForm>
    </DialogContent>
  </Dialog>
</template>
