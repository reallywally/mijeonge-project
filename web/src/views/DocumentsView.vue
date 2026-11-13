<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FileSpreadsheet, FileText, Files } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import DocCreateDialog from '@/components/app/DocCreateDialog.vue'
import DocDetail from '@/components/app/DocDetail.vue'
import DocTree from '@/components/app/DocTree.vue'
import { dayTime } from '@/lib/date'
import { folderPath } from '@/lib/docFolder'
import { DOC_KIND_LABEL } from '@/lib/document'
import { useDataStore } from '@/stores/data'
import { useDocumentStore } from '@/stores/document'

/* 문서 — /documents 와 /documents/:documentId 가 같은 틀이다. 왼쪽 폴더 트리, 오른쪽 고른 문서.
   안 골랐으면 오른쪽은 안내 + 최근 고친 문서 (docs/api/document.md '트리 + 상세') */
const route = useRoute()
const router = useRouter()
const data = useDataStore()
const docs = useDocumentStore()

watch(
  () => data.currentProjectId,
  () => void docs.load(),
  { immediate: true },
)

const documentId = computed(() =>
  typeof route.params.documentId === 'string' && route.params.documentId
    ? route.params.documentId
    : null,
)

/** 최근 고친 문서 — 목록이 고친 때 늦은 순이다 */
const recent = computed(() => docs.visibleList.slice(0, 6))
const KIND_ICON = { text: FileText, sheet: FileSpreadsheet }

function open(id: string) {
  void router.push({ path: `/documents/${id}`, query: route.query })
}

/* 새 문서 — 폴더 메뉴에서 열면 그 폴더, 문서를 보는 중이면 그 문서의 폴더가 기본 */
const createOpen = ref(false)
const createFolderId = ref<string | null>(null)
function newDoc(folderId: string | null) {
  const viewing = documentId.value
    ? (docs.byId[documentId.value] ?? docs.list.find((d) => d.id === documentId.value))
    : undefined
  createFolderId.value = folderId ?? viewing?.folderId ?? null
  createOpen.value = true
}
</script>

<template>
  <AppShell>
    <div class="flex min-h-0 grow">
      <DocTree :selected-id="documentId" @new-doc="newDoc" />

      <DocDetail v-if="documentId" :key="documentId" :document-id="documentId" />

      <div v-else class="flex min-w-0 grow flex-col overflow-y-auto px-8 pt-10 pb-8" data-doc-empty>
        <div class="mx-auto flex w-full max-w-[560px] flex-col gap-6">
          <div class="flex flex-col items-center gap-2.5 text-center">
            <Files class="size-8 text-muted-foreground" />
            <h1 class="text-lg font-semibold">왼쪽에서 문서를 고르세요</h1>
            <p class="text-[13px] leading-relaxed text-muted-foreground text-pretty">
              여러 안건에서 정한 것을 주제 하나로 모아 '지금 정해진 모습' 을 한 장으로 적습니다.
              폴더로 묶고, 끌어서 옮길 수 있습니다. 연결한 안건의 결정이 바뀌면 알려 줍니다.
            </p>
          </div>

          <section v-if="recent.length" class="flex flex-col gap-2">
            <h2 class="text-xs font-medium text-muted-foreground">최근 고친 문서</h2>
            <ul class="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
              <li
                v-for="d in recent"
                :key="d.id"
                class="border-b border-border last:border-b-0"
                :data-doc-recent="d.id"
              >
                <button
                  type="button"
                  class="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-accent"
                  @click="open(d.id)"
                >
                  <component
                    :is="KIND_ICON[d.kind]"
                    class="size-4 shrink-0 text-muted-foreground"
                    :aria-label="DOC_KIND_LABEL[d.kind]"
                  />
                  <span class="flex min-w-0 grow flex-col">
                    <span class="truncate text-sm">{{ d.title }}</span>
                    <span class="truncate text-xs text-muted-foreground">{{
                      folderPath(docs.folders, d.folderId)
                    }}</span>
                  </span>
                  <span class="shrink-0 text-xs text-muted-foreground"
                    >{{ data.memberName(d.updatedBy) ?? '—' }} · {{ dayTime(d.updatedAt) }}</span
                  >
                </button>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>

    <DocCreateDialog
      v-model:open="createOpen"
      :initial-folder-id="createFolderId"
      @created="open"
    />
  </AppShell>
</template>
