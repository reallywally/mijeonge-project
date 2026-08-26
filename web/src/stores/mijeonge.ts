import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Entry, Meeting, Member, Project, Thread, ThreadRow } from '@/types/domain'

/** 목업 데이터 — 캔버스의 예시와 같은 내용이다. 백엔드가 붙으면 이 파일만 바뀐다. */

const members: Member[] = [
  { id: 'u1', name: '김서연' },
  { id: 'u2', name: '박지훈' },
  { id: 'u3', name: '이도현' },
  { id: 'u4', name: '정하늘' },
]

const project: Project = { id: 'p1', name: '결제 안정화' }

const meetings: Meeting[] = [
  {
    id: 'mt5',
    projectId: 'p1',
    title: '3월 3주차 제품 회의',
    date: '2026-03-19',
    attendeeIds: ['u1', 'u2', 'u3'],
    memos: [
      {
        id: 'mm1',
        text: '결제 실패율이 지난주 0.8%에서 0.6%로 내려왔다. PG사 응답 지연은 3월 15일 이후 없다.',
        promotedThreadId: null,
      },
      { id: 'mm2', text: 'PG사가 5월에 API v3를 낸다고 한다. 아직 문서는 안 나왔다.', promotedThreadId: null },
      { id: 'mm3', text: '이도현이 다음 주 휴가라 이중화 상세는 4월 첫 주에.', promotedThreadId: null },
    ],
  },
  { id: 'mt4', projectId: 'p1', title: '3월 2주차 제품 회의', date: '2026-03-12', attendeeIds: ['u1', 'u2', 'u4'], memos: [] },
  { id: 'mt3', projectId: 'p1', title: '결제 장애 회고', date: '2026-03-08', attendeeIds: ['u2', 'u3', 'u4'], memos: [] },
  { id: 'mt2', projectId: 'p1', title: '1분기 로드맵 점검', date: '2026-03-05', attendeeIds: ['u1', 'u3'], memos: [] },
  { id: 'mt1', projectId: 'p1', title: '재시도 정책 리뷰', date: '2026-02-27', attendeeIds: ['u1', 'u2'], memos: [] },
]

const threads: Thread[] = [
  { id: 't8', projectId: 'p1', title: '결제 실패 안내 문구를 어떤 톤으로 쓸지', state: 'queued', ownerId: null, parentThreadId: null, createdAt: '2026-03-18' },
  { id: 't9', projectId: 'p1', title: 'PG사 이중화 1차 적용 범위', state: 'queued', ownerId: 'u3', parentThreadId: null, createdAt: '2026-03-17' },
  { id: 't1', projectId: 'p1', title: '알림 채널을 하나로 합칠지', state: 'open', ownerId: null, parentThreadId: null, createdAt: '2026-02-20' },
  { id: 't5', projectId: 'p1', title: '배포 시간대를 트래픽이 낮은 새벽으로 옮길지', state: 'open', ownerId: null, parentThreadId: null, createdAt: '2026-01-08' },
  { id: 't4', projectId: 'p1', title: '재시도가 모두 실패했을 때 구독을 자동 해지할지', state: 'decided', ownerId: 'u2', parentThreadId: 't2', createdAt: '2026-03-12' },
  { id: 't2', projectId: 'p1', title: '결제 재시도 정책', state: 'decided', ownerId: 'u1', parentThreadId: null, createdAt: '2026-01-08' },
  { id: 't3', projectId: 'p1', title: '결제 실패 알림 발송 시점', state: 'decided', ownerId: 'u2', parentThreadId: null, createdAt: '2026-03-12' },
  { id: 't6', projectId: 'p1', title: '커넥션 풀 사용률 80% 임계 알림', state: 'decided', ownerId: 'u4', parentThreadId: null, createdAt: '2026-03-08' },
  { id: 't7', projectId: 'p1', title: '롤백 절차 문서화와 온콜 교육', state: 'decided', ownerId: 'u2', parentThreadId: null, createdAt: '2026-03-08' },
]

const entries: Entry[] = [
  // t2 결제 재시도 정책
  { id: 'e1', threadId: 't2', meetingId: 'mt1', kind: 'raise', text: '재시도를 몇 번까지 할지 정해야 한다', detail: [], note: '', ownerId: null, createdAt: '2026-01-08' },
  { id: 'e2', threadId: 't2', meetingId: 'mt1', kind: 'decide', text: '재시도는 결제 건당 최대 3회로 제한한다', detail: [], note: '', ownerId: 'u1', createdAt: '2026-02-27' },
  {
    id: 'e3', threadId: 't2', meetingId: 'mt4', kind: 'change',
    text: '실패 원인에 따라 지수 백오프로 재시도한다',
    detail: ['일반 실패 — 1분 → 10분 → 1시간, 최대 3회', '5xx 응답 — 최대 4회까지', '잔액 부족 — 재시도하지 않고 바로 알림'],
    note: '이전 결정(최대 3회 즉시 재시도)을 대체했습니다.', ownerId: 'u1', createdAt: '2026-03-12',
  },
  { id: 'e4', threadId: 't2', meetingId: 'mt4', kind: 'split', text: '재시도를 모두 소진한 구독의 처리는 따로 안건으로 올렸다', detail: [], note: '약관 확인까지 따로 쫓아다녀야 해서 분리했습니다.', ownerId: null, createdAt: '2026-03-12' },
  { id: 'e5', threadId: 't2', meetingId: 'mt5', kind: 'refine', text: '1시간 시도까지 실패하면 더 재시도하지 않는다', detail: [], note: '', ownerId: 'u1', createdAt: '2026-03-19' },
  // t4 자동 해지 — 회의 밖 처리 포함
  { id: 'e6', threadId: 't4', meetingId: 'mt4', kind: 'raise', text: '재시도가 모두 실패한 구독을 어떻게 할지 물음', detail: [], note: '', ownerId: null, createdAt: '2026-03-12' },
  { id: 'e7', threadId: 't4', meetingId: 'mt4', kind: 'defer', text: '약관 문제가 걸려 정책팀 확인 후로 보류', detail: [], note: '', ownerId: 'u2', createdAt: '2026-03-12' },
  { id: 'e8', threadId: 't4', meetingId: null, kind: 'decide', text: '약관상 걸리는 것이 없어 자동 해지하기로 함', detail: [], note: '정책팀 확인 결과를 담당자가 그대로 반영했습니다.', ownerId: 'u2', createdAt: '2026-03-21' },
  // t1 알림 채널
  { id: 'e9', threadId: 't1', meetingId: 'mt2', kind: 'raise', text: '알림이 채널마다 따로 나가서 사용자가 중복으로 받는다', detail: [], note: '', ownerId: null, createdAt: '2026-02-20' },
  { id: 'e10', threadId: 't1', meetingId: 'mt2', kind: 'defer', text: '범위가 커서 미뤘다', detail: [], note: '작업량 추정이 안 됨.', ownerId: null, createdAt: '2026-03-05' },
  { id: 'e11', threadId: 't1', meetingId: 'mt4', kind: 'defer', text: '이번에도 결론을 내지 못했다', detail: [], note: '전사 알림 구조 문제라는 의견.', ownerId: null, createdAt: '2026-03-12' },
  { id: 'e12', threadId: 't1', meetingId: 'mt5', kind: 'defer', text: '이번에도 결론을 내지 못했다', detail: [], note: '전사 알림 구조를 먼저 확인해야 한다는 의견.', ownerId: null, createdAt: '2026-03-19' },
  // t5 배포 시간대
  { id: 'e13', threadId: 't5', meetingId: 'mt1', kind: 'raise', text: '장애가 배포 직후에 몰린다는 지표가 공유됐다', detail: [], note: '', ownerId: null, createdAt: '2026-01-08' },
  { id: 'e14', threadId: 't5', meetingId: 'mt2', kind: 'defer', text: '이중화 논의에 묻혀 다루지 못했다', detail: [], note: '', ownerId: null, createdAt: '2026-02-13' },
  { id: 'e15', threadId: 't5', meetingId: 'mt3', kind: 'defer', text: '팀별 온콜 부담이 달라 합의하지 못했다', detail: [], note: '', ownerId: null, createdAt: '2026-03-08' },
  { id: 'e16', threadId: 't5', meetingId: 'mt4', kind: 'defer', text: '팀 리드끼리 먼저 이야기하기로', detail: [], note: '', ownerId: null, createdAt: '2026-03-12' },
  // 나머지
  { id: 'e17', threadId: 't3', meetingId: 'mt4', kind: 'decide', text: '3회차 재시도 이후에만 발송한다', detail: [], note: '', ownerId: 'u2', createdAt: '2026-03-12' },
  { id: 'e18', threadId: 't6', meetingId: 'mt3', kind: 'decide', text: '커넥션 풀 사용률 80%에서 알림을 보낸다', detail: [], note: '', ownerId: 'u4', createdAt: '2026-03-08' },
  { id: 'e19', threadId: 't7', meetingId: 'mt3', kind: 'decide', text: '롤백 절차를 문서로 만들고 온콜 교육에 포함한다', detail: [], note: '', ownerId: 'u2', createdAt: '2026-03-08' },
]

function monthDay(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(m)}월 ${Number(d)}일`
}

export const useMijeongeStore = defineStore('mijeonge', () => {
  const allMembers = ref<Member[]>(members)
  const currentProject = ref<Project>(project)
  const allMeetings = ref<Meeting[]>(meetings)
  const allThreads = ref<Thread[]>(threads)
  const allEntries = ref<Entry[]>(entries)

  const memberName = (id: string | null) =>
    id ? (allMembers.value.find((m) => m.id === id)?.name ?? null) : null

  const entriesOfThread = (threadId: string) =>
    allEntries.value
      .filter((e) => e.threadId === threadId)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const rows = computed<ThreadRow[]>(() =>
    allThreads.value.map((thread) => {
      const own = entriesOfThread(thread.id)
      const lastWithMeeting = own.find((e) => e.meetingId !== null)
      return {
        thread,
        ownerName: memberName(thread.ownerId),
        deferCount: own.filter((e) => e.kind === 'defer').length,
        entryCount: own.length,
        lastMeetingLabel: lastWithMeeting ? monthDay(lastWithMeeting.createdAt) : '—',
      }
    }),
  )

  let seq = 0
  function addThread(title: string, ownerId: string | null) {
    seq += 1
    allThreads.value.unshift({
      id: `new${seq}`,
      projectId: currentProject.value.id,
      title,
      state: 'queued',
      ownerId,
      parentThreadId: null,
      createdAt: new Date().toISOString().slice(0, 10),
    })
  }

  return { allMembers, currentProject, allMeetings, allThreads, allEntries, rows, memberName, entriesOfThread, addThread }
})
