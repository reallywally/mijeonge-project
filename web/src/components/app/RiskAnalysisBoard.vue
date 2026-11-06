<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Loader2 } from 'lucide-vue-next'
import MemberAvatar from '@/components/app/MemberAvatar.vue'
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
import { useDataStore } from '@/stores/data'
import { useRiskAnalysisStore } from '@/stores/riskAnalysis'
import type { RiskAnalysisListItem } from '@/types/domain'

/* 리스크 화면의 '저장한 분석' 탭 — 번호 · 제목 · 작성자 · 저장일 · 리스크(높음 / 전체, 세 종류 합). 최신이 위, 50개씩 [더 보기].
   받는 것은 리스크 화면이 맡는다(탭 이름에 수를 띄워야 해서) — 여기는 그리기만 (docs/api/risk-analysis.md '화면') */
const data = useDataStore()
const analyses = useRiskAnalysisStore()
const router = useRouter()

/** 짚은 줄 — 세 종류 합 (risk-dashboard.md). 높음도 세 종류 합으로 온다 */
const totalOf = (a: RiskAnalysisListItem) => a.agendaCount + a.taskCount + a.testCount

const authorName = (id: string | null) =>
  id ? (data.memberName(id) ?? '알 수 없음') : '알 수 없음'
</script>

<template>
  <section class="flex flex-col gap-2.5" role="tabpanel" aria-label="저장한 분석">
    <p
      v-if="analyses.error"
      class="rounded-lg border border-destructive/40 px-[17px] py-3 text-sm text-destructive"
      role="alert"
    >
      {{ analyses.error }}
    </p>

    <div
      v-if="!analyses.loaded && analyses.loading"
      class="flex h-[110px] items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2 class="size-4 animate-spin" />
      저장한 분석을 받는 중입니다.
    </div>

    <div
      v-else
      class="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
    >
      <Table>
        <TableHeader>
          <TableRow class="bg-muted/60 hover:bg-muted/60">
            <TableHead class="h-10 w-[64px] text-xs font-medium text-muted-foreground"
              >번호</TableHead
            >
            <TableHead class="h-10 text-xs font-medium text-muted-foreground">제목</TableHead>
            <TableHead class="h-10 w-[132px] text-xs font-medium text-muted-foreground"
              >작성자</TableHead
            >
            <TableHead class="h-10 w-[120px] text-xs font-medium text-muted-foreground"
              >저장일</TableHead
            >
            <TableHead class="h-10 w-[120px] text-right text-xs font-medium text-muted-foreground"
              >리스크</TableHead
            >
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="a in analyses.list"
            :key="a.id"
            class="h-12 cursor-pointer"
            :data-analysis-row="a.id"
            @click="router.push(`/risks/analyses/${a.id}`)"
          >
            <TableCell class="text-sm text-muted-foreground tabular-nums">{{ a.seq }}</TableCell>
            <TableCell class="min-w-0">
              <button
                type="button"
                class="min-w-0 truncate text-left text-sm underline-offset-4 hover:underline"
                data-analysis-title
              >
                {{ a.title }}
              </button>
            </TableCell>
            <TableCell>
              <span class="flex min-w-0 items-center gap-2 text-sm" data-analysis-author>
                <MemberAvatar
                  :name="authorName(a.createdBy)"
                  :src="data.memberAvatar(a.createdBy)"
                />
                <span class="truncate">{{ authorName(a.createdBy) }}</span>
              </span>
            </TableCell>
            <TableCell class="text-sm text-muted-foreground">{{ dayTime(a.savedAt) }}</TableCell>
            <TableCell
              class="text-right text-sm"
              :title="`작업 ${a.taskCount} · 안건 ${a.agendaCount} · 테스트 ${a.testCount}건`"
              data-analysis-counts
            >
              <span
                :class="a.highCount > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'"
                >높음 {{ a.highCount }}</span
              >
              <span class="text-muted-foreground"> / 전체 {{ totalOf(a) }}</span>
            </TableCell>
          </TableRow>
          <TableRow v-if="analyses.list.length === 0" class="hover:bg-transparent">
            <TableCell
              colspan="5"
              class="h-[110px] text-center text-sm text-muted-foreground"
              data-analysis-empty
            >
              저장한 분석이 없습니다 — 지금 리스크 탭에서 분석하고 [저장] 하세요
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div v-if="analyses.hasMore" class="flex justify-center">
      <Button
        variant="outline"
        :disabled="analyses.loadingMore"
        data-analysis-more
        @click="analyses.loadMore()"
      >
        <Loader2 v-if="analyses.loadingMore" class="size-4 animate-spin" />
        더 보기
      </Button>
    </div>
  </section>
</template>
