import { useAdminStore } from '@/stores/admin'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { useCheckStore } from '@/stores/check'
import { useCommentStore } from '@/stores/comment'
import { useDataStore } from '@/stores/data'
import { useMinutesStore } from '@/stores/minutes'
import { useMinutesDraftStore } from '@/stores/minutesDraft'
import { usePartStore } from '@/stores/part'
import { useReportStore } from '@/stores/report'
import { useRiskStore } from '@/stores/risk'

/**
 * 로그아웃 · 세션 끝남 — 들고 있던 것을 전부 비운다. 다른 사람이 같은 브라우저로 들어올 수 있다.
 * 챗봇은 받는 중인 요청까지 끊는다. 스토어가 늘면 여기에 한 줄 더한다.
 */
export function clearSession() {
  useChatStore().reset()
  useCommentStore().clear()
  useAdminStore().clear()
  usePartStore().clear()
  useRiskStore().clear()
  useReportStore().clear()
  useCheckStore().clear()
  useMinutesDraftStore().reset()
  useMinutesStore().clear()
  useDataStore().clear()
  useAuthStore().clear()
}
