<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { ImageUp, Loader2, Trash2 } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import MemberAvatar from '@/components/app/MemberAvatar.vue'
import PasswordChangeForm from '@/components/app/PasswordChangeForm.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AVATAR_ACCEPT, AvatarPrepError, prepareAvatar } from '@/lib/avatar'
import { myProjectRoleLabel, systemRoleLabel } from '@/lib/member'
import { toastError } from '@/lib/notify'
import { orderProjects, projectStatusLabel } from '@/lib/project'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'

/* 마이페이지 — 내 정보를 보고, 프로필 사진을 걸고, 비밀번호를 바꾼다 (docs/api/me.md).
   이름 · 이메일 · 역할은 관리자가 바꾼다 — 여기서는 읽기만. 사진은 올리기 전에 화면이 256×256 으로 줄인다 */
const auth = useAuthStore()
const data = useDataStore()

const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref<'upload' | 'remove' | null>(null)

/* 부여받은 프로젝트만 — 시스템 관리자가 다 보는 것은 부여가 아니다. 지운 프로젝트는 목록에 없어 빠진다 */
const myProjects = computed(() => {
  const roles = auth.me?.projectRoles ?? {}
  return orderProjects(data.allProjects.filter((p) => p.id in roles)).map((p) => ({
    project: p,
    role: roles[p.id],
  }))
})

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  /* 같은 파일을 다시 골라도 change 가 오게 비운다 */
  input.value = ''
  if (!file || busy.value) return
  busy.value = 'upload'
  try {
    await auth.uploadAvatar(await prepareAvatar(file))
    toast.success('프로필 사진을 걸었습니다.')
  } catch (err) {
    if (err instanceof AvatarPrepError) toast.error(err.message)
    else toastError(err)
  } finally {
    busy.value = null
  }
}

async function removePhoto() {
  if (busy.value) return
  busy.value = 'remove'
  try {
    await auth.removeAvatar()
    toast.success('프로필 사진을 지웠습니다.')
  } catch (err) {
    toastError(err)
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <AppShell>
    <div class="flex h-11 shrink-0 items-center gap-2.5 border-b border-border bg-card px-6">
      <span class="text-xs font-medium text-muted-foreground">마이페이지</span>
    </div>

    <div v-if="auth.me" class="flex min-h-0 grow overflow-y-auto px-6 pt-6">
      <div class="flex w-full max-w-[720px] flex-col gap-4 pb-[26px]">
        <header class="flex flex-col gap-2.5">
          <h1 class="text-[22px] font-bold tracking-[-0.025em]">마이페이지</h1>
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            이름 · 이메일 · 역할은 관리자가 바꿉니다. 여기서는 프로필 사진과 비밀번호를 바꿀 수
            있습니다.
          </p>
        </header>

        <section
          class="flex flex-col gap-4 rounded-lg border border-border bg-card px-5 py-4 shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
          data-profile
        >
          <h2 class="text-sm font-semibold">프로필</h2>
          <div class="flex items-start gap-5">
            <MemberAvatar :name="auth.me.name" :src="auth.me.avatarUrl" :size="96" tone="brand" />
            <div class="flex min-w-0 grow flex-col gap-3">
              <dl class="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt class="text-muted-foreground">이름</dt>
                <dd class="font-medium" data-profile-name>{{ auth.me.name }}</dd>
                <dt class="text-muted-foreground">이메일</dt>
                <dd class="truncate" data-profile-email>{{ auth.me.email }}</dd>
                <dt class="text-muted-foreground">시스템 역할</dt>
                <dd data-profile-role>{{ systemRoleLabel(auth.me.systemRole) }}</dd>
              </dl>
              <div class="flex flex-wrap items-center gap-2">
                <input
                  ref="fileInput"
                  type="file"
                  :accept="AVATAR_ACCEPT"
                  class="hidden"
                  data-avatar-input
                  @change="onPick"
                />
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="busy !== null"
                  data-avatar-upload
                  @click="fileInput?.click()"
                >
                  <Loader2 v-if="busy === 'upload'" class="animate-spin" />
                  <ImageUp v-else />
                  {{ auth.me.avatarUrl ? '사진 바꾸기' : '사진 올리기' }}
                </Button>
                <Button
                  v-if="auth.me.avatarUrl"
                  variant="ghost"
                  size="sm"
                  :disabled="busy !== null"
                  data-avatar-remove
                  @click="removePhoto"
                >
                  <Loader2 v-if="busy === 'remove'" class="animate-spin" />
                  <Trash2 v-else />
                  사진 지우기
                </Button>
                <span class="text-xs text-muted-foreground">
                  png · jpeg · webp · gif — 가운데를 정사각형으로 잘라 줄여 올립니다.
                </span>
              </div>
            </div>
          </div>
        </section>

        <section
          class="flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-4 shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
          data-my-projects
        >
          <h2 class="text-sm font-semibold">내 프로젝트</h2>
          <ul v-if="myProjects.length > 0" class="flex flex-col">
            <li
              v-for="r in myProjects"
              :key="r.project.id"
              class="flex h-10 items-center gap-2 border-b border-border text-sm last:border-b-0"
              :data-my-project="r.project.id"
            >
              <span
                class="min-w-0 grow truncate"
                :class="r.project.status === 'closed' ? 'text-muted-foreground' : ''"
              >
                {{ r.project.name
                }}<span
                  v-if="r.project.status !== 'active'"
                  class="ml-1 text-xs text-muted-foreground"
                  >· {{ projectStatusLabel(r.project.status) }}</span
                >
              </span>
              <Badge :variant="r.role === 'admin' ? 'default' : 'secondary'" data-my-project-role>{{
                myProjectRoleLabel(r.role)
              }}</Badge>
            </li>
          </ul>
          <p v-else class="text-sm text-muted-foreground">
            {{
              auth.systemAdmin
                ? '부여받은 프로젝트가 없습니다. 시스템 관리자는 모든 프로젝트를 봅니다.'
                : '부여받은 프로젝트가 없습니다 — 관리자에게 요청하세요.'
            }}
          </p>
        </section>

        <section
          class="flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-4 shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
          data-my-password
        >
          <div class="flex flex-col gap-1">
            <h2 class="text-sm font-semibold">비밀번호 바꾸기</h2>
            <p class="text-xs text-muted-foreground text-pretty">
              바꾸면 이 브라우저 말고 다른 곳에 로그인된 세션은 모두 끊깁니다.
            </p>
          </div>
          <PasswordChangeForm id-prefix="pw-page" class="max-w-[360px]">
            <template #actions="{ canSubmit, saving, submit }">
              <div>
                <Button type="button" :disabled="!canSubmit" data-password-submit @click="submit">
                  <Loader2 v-if="saving" class="animate-spin" />
                  비밀번호 바꾸기
                </Button>
              </div>
            </template>
          </PasswordChangeForm>
        </section>
      </div>
    </div>
  </AppShell>
</template>
