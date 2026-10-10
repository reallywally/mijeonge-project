import { toast } from 'vue-sonner'
import { messageOf } from '@/api/client'

/** 쓰기 실패를 알린다 — 서버의 message 는 그대로 띄울 수 있는 한국어 한 줄이다 */
export function toastError(e: unknown) {
  toast.error(messageOf(e))
}
