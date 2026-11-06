<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ImageOff, KeyRound, Loader2, Pencil, Plus, RotateCcw } from 'lucide-vue-next'
import AdminShell from '@/components/app/AdminShell.vue'
import MemberAccountDialog from '@/components/app/MemberAccountDialog.vue'
import MemberAvatar from '@/components/app/MemberAvatar.vue'
import MemberPasswordDialog from '@/components/app/MemberPasswordDialog.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { dayTime } from '@/lib/date'
import { byMemberNo, systemRoleLabel } from '@/lib/member'
import { useAdminStore } from '@/stores/admin'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import type { MemberAccount } from '@/types/domain'

/* 사용자 관리 — 시스템 관리자만 (라우터 가드 · 메뉴가 같은 판단을 쓴다, 막는 것은 서버다).
   사용자는 지우지 않고 끈다. 프로젝트 부여는 프로젝트 관리에서 한다.
   사진은 멤버 목록(data)에서 본다 — 관리용 모양(MemberAccount)에는 없다. 남의 사진은 지우기만 한다(올려 주지 않는다) */
const admin = useAdminStore()
const auth = useAuthStore()
const data = useDataStore()

onMounted(() => {
  void admin.load()
})

/* 관리자끼리 번호로 부르니 번호 순으로 놓는다 — 새로 등록한 사람이 맨 아래에 선다 */
const rows = computed(() => [...admin.accounts].sort(byMemberNo))

const activeCount = computed(() => admin.accounts.filter((a) => a.active).length)

const editing = ref<MemberAccount | null>(null)
const accountOpen = ref(false)
const passwordFor = ref<MemberAccount | null>(null)
const passwordOpen = ref(false)

function openCreate() {
  editing.value = null
  accountOpen.value = true
}

function openEdit(account: MemberAccount) {
  editing.value = account
  accountOpen.value = true
}

function openPassword(account: MemberAccount) {
  passwordFor.value = account
  passwordOpen.value = true
}

/* 사진 지우기는 되돌릴 수 없다 — 그 줄에서 한 번 더 묻는다 */
const removingAvatarOf = ref<string | null>(null)
const avatarBusy = ref(false)

async function removeAvatar(memberId: string) {
  avatarBusy.value = true
  await admin.removeAvatar(memberId)
  avatarBusy.value = false
  removingAvatarOf.value = null
}
</script>

<template>
  <AdminShell>
    <div class="flex h-11 shrink-0 items-center gap-2.5 border-b border-border bg-card px-6">
      <span class="text-xs font-medium text-muted-foreground">사용자 관리</span>
      <span class="text-xs text-muted-foreground">
        총 {{ admin.accounts.length }}명 · 활성 {{ activeCount }}명
      </span>
    </div>

    <div class="flex min-h-0 grow overflow-y-auto px-6 pt-6">
      <div class="flex w-full flex-col gap-4 pb-[26px]">
        <header class="flex items-start gap-4">
          <div class="flex min-w-0 grow flex-col gap-2.5">
            <h1 class="text-[22px] font-bold tracking-[-0.025em]">사용자 관리</h1>
            <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
              로그인할 사람을 등록하고 시스템 역할을 정합니다. 떠난 사람은 지우지 않고 끕니다 —
              맡았던 작업 · 남긴 댓글이 그 사람을 가리킵니다.
            </p>
          </div>
          <Button class="shrink-0" @click="openCreate">
            <Plus class="size-4" />
            사용자 등록
          </Button>
        </header>

        <div
          class="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
        >
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/60 hover:bg-muted/60">
                <TableHead
                  class="h-10 w-[64px] text-right text-xs font-medium text-muted-foreground"
                  >번호</TableHead
                >
                <TableHead class="h-10 text-xs font-medium text-muted-foreground">이름</TableHead>
                <TableHead class="h-10 text-xs font-medium text-muted-foreground">이메일</TableHead>
                <TableHead class="h-10 w-[128px] text-xs font-medium text-muted-foreground"
                  >시스템 역할</TableHead
                >
                <TableHead class="h-10 w-[72px] text-xs font-medium text-muted-foreground"
                  >활성</TableHead
                >
                <TableHead class="h-10 w-[150px] text-xs font-medium text-muted-foreground"
                  >마지막 로그인</TableHead
                >
                <TableHead class="h-10 w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="a in rows"
                :key="a.id"
                :data-member-id="a.id"
                class="h-12"
                :class="a.active ? '' : 'text-muted-foreground'"
              >
                <TableCell data-member-no class="text-right font-mono text-xs tabular-nums">{{
                  a.no
                }}</TableCell>
                <TableCell class="text-sm">
                  <span class="flex items-center gap-2">
                    <MemberAvatar :name="a.name" :src="data.memberAvatar(a.id)" :size="24" />
                    <span class="truncate" :class="a.active ? 'font-medium' : ''">{{
                      a.name
                    }}</span>
                    <Badge v-if="a.id === auth.me?.id" variant="secondary">나</Badge>
                  </span>
                </TableCell>
                <TableCell class="text-sm">
                  <span class="flex items-center gap-2">
                    <span v-if="a.email" class="truncate">{{ a.email }}</span>
                    <span v-else class="text-muted-foreground">없음</span>
                    <Badge v-if="!a.hasPassword" variant="outline" title="로그인할 수 없습니다">
                      비밀번호 없음
                    </Badge>
                  </span>
                </TableCell>
                <TableCell class="text-sm">{{ systemRoleLabel(a.systemRole) }}</TableCell>
                <TableCell class="text-sm">
                  <Badge v-if="a.active" variant="secondary">활성</Badge>
                  <span v-else class="text-xs">비활성</span>
                </TableCell>
                <TableCell class="text-sm text-muted-foreground">
                  {{ a.lastLoginAt ? dayTime(a.lastLoginAt) : '—' }}
                </TableCell>
                <TableCell class="text-right">
                  <div v-if="removingAvatarOf === a.id" class="flex justify-end gap-1">
                    <Button
                      variant="destructive"
                      size="xs"
                      :disabled="avatarBusy"
                      data-avatar-remove-confirm
                      @click="removeAvatar(a.id)"
                    >
                      <Loader2 v-if="avatarBusy" class="animate-spin" />
                      사진 지우기
                    </Button>
                    <Button variant="ghost" size="xs" @click="removingAvatarOf = null">취소</Button>
                  </div>
                  <div v-else class="flex justify-end gap-0.5">
                    <Button
                      v-if="data.memberAvatar(a.id)"
                      variant="ghost"
                      size="icon"
                      class="size-8"
                      :aria-label="`${a.name} 사진 지우기`"
                      title="사진 지우기"
                      data-avatar-remove
                      @click="removingAvatarOf = a.id"
                    >
                      <ImageOff class="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8"
                      :aria-label="`${a.name} 수정`"
                      title="수정"
                      @click="openEdit(a)"
                    >
                      <Pencil class="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8"
                      :aria-label="`${a.name} 비밀번호 걸기`"
                      title="비밀번호 새로 걸기"
                      :disabled="!a.email"
                      @click="openPassword(a)"
                    >
                      <KeyRound class="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              <TableRow v-if="admin.accounts.length === 0" class="hover:bg-transparent">
                <TableCell colspan="7" class="h-[110px] text-center text-sm text-muted-foreground">
                  <span
                    v-if="admin.status === 'loading' || admin.status === 'idle'"
                    class="inline-flex items-center gap-1.5"
                  >
                    <Loader2 class="size-3.5 animate-spin" />
                    불러오는 중…
                  </span>
                  <span v-else-if="admin.status === 'error'" class="inline-flex items-center gap-2">
                    {{ admin.loadError }}
                    <Button variant="outline" size="sm" @click="admin.load()">
                      <RotateCcw class="size-3.5" />
                      다시 불러오기
                    </Button>
                  </span>
                  <span v-else>등록된 사용자가 없습니다.</span>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <p class="text-xs text-muted-foreground text-pretty">
          이메일이 없는 사람은 비밀번호를 걸 수 없습니다 — 먼저 수정에서 이메일을 넣어 주세요.
        </p>
      </div>
    </div>

    <MemberAccountDialog v-model:open="accountOpen" :account="editing" />
    <MemberPasswordDialog v-model:open="passwordOpen" :account="passwordFor" />
  </AdminShell>
</template>
