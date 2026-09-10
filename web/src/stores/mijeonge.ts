import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { dayTime, monthDay, today } from '@/lib/date'
import type {
  Entry,
  EntryKind,
  Meeting,
  MeetingDetail,
  MeetingInput,
  MeetingRow,
  MeetingThreadLines,
  Member,
  Project,
  Request,
  RequestComment,
  RequestDetail,
  RequestRow,
  RequestState,
  SpecState,
  SubThreadRow,
  Thread,
  ThreadDetail,
  ThreadEvent,
  ThreadRow,
} from '@/types/domain'

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

const requests: Request[] = [
  { id: 'rq1', projectId: 'p1', title: '결제 실패 데이터 정리', body: '3월 결제 실패 건 데이터 좀 정리해 주실 수 있을까요?\n이번 주 회의에서 재시도 정책 얘기할 때 근거로 쓰려고 합니다.', state: 'doing', requesterId: 'u4', assigneeId: 'u2', dueDate: '2026-03-26', sourceEntryId: 'e3', createdAt: '2026-03-21',
    spec: {
      points: [
        '2026년 3월 1일 ~ 3월 20일 결제 실패 건을 실패 사유별로 센다.',
        'PG사(토스페이먼츠 / 나이스페이)는 나눠서 낸다.',
        '실패한 뒤 재시도로 성공한 건의 비율도 함께 낸다.',
        '3월 26일 회의 전까지 집계표 한 장으로 받는다.',
        '전달 형식은 아직 안 정했다 — 시트로 드릴지 물었고 답이 없다.',
      ],
      confirmed: false, confirmedById: null, confirmedAt: null, fromCommentCount: 7,
    } },
  { id: 'rq2', projectId: 'p1', title: '3월 정산서 숫자 한번 봐주세요', body: '3월 정산서 숫자 한번 봐주세요. 환불 반영이 이상한 것 같습니다.', state: 'doing', requesterId: 'u2', assigneeId: 'u1', dueDate: '2026-03-24', sourceEntryId: null, createdAt: '2026-03-20',
    spec: { points: ['3월 정산서의 환불 반영액이 결제 원장과 맞는지 본다.', '어긋나면 어느 건이 어긋났는지까지 짚어 준다.'], confirmed: true, confirmedById: 'u2', confirmedAt: '2026-03-20', fromCommentCount: 2 } },
  { id: 'rq3', projectId: 'p1', title: '알림 발송 로그 2월치도 필요합니다', body: '알림 발송 로그 2월치도 필요합니다.', state: 'doing', requesterId: 'u1', assigneeId: 'u2', dueDate: '2026-03-27', sourceEntryId: null, createdAt: '2026-03-19',
    spec: { points: ['2월 알림 발송 로그를 채널별로 뽑는다.', '중복 발송으로 보이는 건은 따로 표시한다.'], confirmed: true, confirmedById: 'u1', confirmedAt: '2026-03-19', fromCommentCount: 3 } },
  { id: 'rq4', projectId: 'p1', title: '배포 체크리스트가 최신인지 확인', body: '배포 체크리스트가 지난 분기 것 같은데 한번 봐주실 분 계실까요?', state: 'todo', requesterId: 'u4', assigneeId: null, dueDate: null, sourceEntryId: null, createdAt: '2026-03-22', spec: null },
  { id: 'rq5', projectId: 'p1', title: '온콜 담당표 이번 분기 것 맞는지', body: '온콜 담당표가 이번 분기 것으로 맞는지 확인 부탁드립니다.', state: 'todo', requesterId: 'u3', assigneeId: 'u4', dueDate: '2026-03-25', sourceEntryId: null, createdAt: '2026-03-22', spec: null },
  { id: 'rq6', projectId: 'p1', title: '테스트 계정 정리해 주세요', body: '스테이징 테스트 계정이 너무 많이 쌓였습니다. 정리 부탁드려요.', state: 'todo', requesterId: 'u1', assigneeId: 'u3', dueDate: '2026-03-30', sourceEntryId: null, createdAt: '2026-03-21',
    spec: { points: ['스테이징에 쌓인 테스트 계정 중 3개월 넘게 안 쓴 것을 지운다.', '지우기 전에 목록을 한 번 공유한다.'], confirmed: true, confirmedById: 'u1', confirmedAt: '2026-03-21', fromCommentCount: 1 } },
  { id: 'rq7', projectId: 'p1', title: '구독 해지 사유 코드 목록 뽑아주세요', body: '구독 해지 사유 코드 목록 좀 뽑아주세요. 자동 해지 붙일 때 필요합니다.', state: 'done', requesterId: 'u2', assigneeId: 'u3', dueDate: '2026-03-20', sourceEntryId: 'e8', createdAt: '2026-03-17',
    spec: { points: ['해지 사유 코드와 뜻을 표로 정리한다.', '자동 해지로 붙는 코드가 어느 것인지 표시한다.'], confirmed: true, confirmedById: 'u2', confirmedAt: '2026-03-17', fromCommentCount: 1 } },
  { id: 'rq8', projectId: 'p1', title: 'PG사 계약서 사본 어디 있는지', body: 'PG사 계약서 사본 어디 있는지 아시는 분?', state: 'done', requesterId: 'u1', assigneeId: 'u4', dueDate: '2026-03-18', sourceEntryId: null, createdAt: '2026-03-14',
    spec: { points: ['토스페이먼츠 · 나이스페이 계약서 사본 위치를 알려준다.', '접근 권한이 없으면 권한까지 열어 준다.'], confirmed: true, confirmedById: 'u1', confirmedAt: '2026-03-15', fromCommentCount: 3 } },
]

const requestComments: RequestComment[] = [
  { id: 'rc2', requestId: 'rq1', authorId: 'u2', text: '어떤 데이터를 말씀하시는 걸까요? 실패 로그 원본인지, 사유별로 몇 건인지 세어 놓은 것인지에 따라 작업이 완전히 달라서요.', createdAt: '2026-03-21T10:31' },
  { id: 'rc3', requestId: 'rq1', authorId: 'u4', text: '사유별로 몇 건인지가 궁금해요. 이번 주 회의에서 재시도 정책 얘기할 때 근거로 쓰려고 합니다.', createdAt: '2026-03-21T10:40' },
  { id: 'rc4', requestId: 'rq1', authorId: 'u2', text: '기간은 어떻게 잡을까요? 3월 전체면 PG사가 두 곳 섞여 있는데, 나눠서 드리는 게 나을까요?', createdAt: '2026-03-21T11:02' },
  { id: 'rc5', requestId: 'rq1', authorId: 'u4', text: '3월 1일부터 20일까지요. PG사는 나눠 주시면 좋겠습니다.', createdAt: '2026-03-21T11:15' },
  { id: 'rc6', requestId: 'rq1', authorId: 'u1', text: '실패한 뒤 재시도로 살아난 비율도 같이 보면 좋을 것 같은데요. 그게 있어야 재시도 횟수를 늘릴지 말지 얘기가 됩니다.', createdAt: '2026-03-21T13:47' },
  { id: 'rc7', requestId: 'rq1', authorId: 'u4', text: '그것도 넣어 주세요.', createdAt: '2026-03-21T14:02' },
  { id: 'rc8', requestId: 'rq1', authorId: 'u2', text: '알겠습니다. 형식은 시트로 드리면 될까요?', createdAt: '2026-03-21T14:20' },

  { id: 'rc10', requestId: 'rq2', authorId: 'u1', text: '어느 항목이 이상한가요? 전체를 다 대조하려면 시간이 좀 걸려서요.', createdAt: '2026-03-20T09:22' },
  { id: 'rc11', requestId: 'rq2', authorId: 'u2', text: '환불 반영액만요. 결제 원장이랑 맞는지 보시면 됩니다.', createdAt: '2026-03-20T09:30' },

  { id: 'rc13', requestId: 'rq3', authorId: 'u2', text: '채널별로 나눠 드릴까요?', createdAt: '2026-03-19T11:12' },
  { id: 'rc14', requestId: 'rq3', authorId: 'u1', text: '네, 채널별로요. 중복으로 나간 것 같은 건도 표시해 주시면 좋겠습니다.', createdAt: '2026-03-19T11:20' },
  { id: 'rc15', requestId: 'rq3', authorId: 'u2', text: '알겠습니다.', createdAt: '2026-03-19T11:25' },
  { id: 'rc16', requestId: 'rq3', authorId: 'u1', text: '아 그리고 1월치도 같이 볼 수 있을까요? 2월만 보면 추세를 모르겠어서요.', createdAt: '2026-03-23T09:05' },
  { id: 'rc17', requestId: 'rq3', authorId: 'u2', text: '1월은 로그 보존 기간이 지나서 없을 수도 있습니다. 확인해 볼게요.', createdAt: '2026-03-23T09:40' },


  { id: 'rc20', requestId: 'rq6', authorId: 'u3', text: '3개월 넘게 안 쓴 것 기준으로 지우겠습니다. 지우기 전에 목록 공유할게요.', createdAt: '2026-03-21T15:20' },

  { id: 'rc22', requestId: 'rq7', authorId: 'u3', text: '코드랑 뜻 표로 만들어 드리겠습니다. 자동 해지로 붙는 것도 표시할게요.', createdAt: '2026-03-17T10:15' },

  { id: 'rc24', requestId: 'rq8', authorId: 'u4', text: '법무 드라이브에 있습니다. 두 곳 다 필요하신가요?', createdAt: '2026-03-14T13:30' },
  { id: 'rc25', requestId: 'rq8', authorId: 'u1', text: '네 둘 다요. 그런데 저는 그 드라이브 권한이 없는 것 같습니다.', createdAt: '2026-03-14T14:00' },
  { id: 'rc26', requestId: 'rq8', authorId: 'u4', text: '권한까지 열어 드리겠습니다.', createdAt: '2026-03-15T09:00' },
]

/**
 * 정리하기를 눌렀을 때 나올 내용.
 *
 * 진짜로는 서버가 요청 제목 + 본문 + 댓글 전부 + (있으면) 출처 안건의 줄을 Claude 에 한 번 넘기고
 * 이 불릿 목록을 돌려받는다. 아직 서버가 없어서 목업이 미리 적어 둔 것을 쓴다.
 */
const draftPoints: Record<string, string[]> = {
  rq1: [
    '2026년 3월 1일 ~ 3월 20일 결제 실패 건을 실패 사유별로 센다.',
    'PG사(토스페이먼츠 / 나이스페이)는 나눠서 낸다.',
    '실패한 뒤 재시도로 성공한 건의 비율도 함께 낸다.',
    '3월 26일 회의 전까지 집계표 한 장으로 받는다.',
    '전달 형식은 아직 안 정했다 — 시트로 드릴지 물었고 답이 없다.',
  ],
  rq3: [
    '2월 알림 발송 로그를 채널별로 뽑는다.',
    '중복 발송으로 보이는 건은 따로 표시한다.',
    '1월치도 함께 보고 싶다고 했으나, 보존 기간이 지나 남아 있는지 아직 확인 중이다.',
  ],
  rq4: ['배포 체크리스트가 이번 분기 기준인지 훑어보고, 안 맞는 항목을 알려준다.'],
}

export const useMijeongeStore = defineStore('mijeonge', () => {
  const allMembers = ref<Member[]>(members)
  /** 지금 보고 있는 사람. 로그인이 붙기 전까지 박지훈으로 고정한다. */
  const currentMemberId = ref('u2')
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

  const meetingById = (id: string | null) =>
    id ? (allMeetings.value.find((m) => m.id === id) ?? null) : null

  const entriesOfMeeting = (meetingId: string) =>
    allEntries.value.filter((e) => e.meetingId === meetingId)

  /** 회의 목록. 회의는 늘 최근 것이 위다 — 지난 회의에 뒤늦게 적는 경우가 있어 날짜로 다시 세운다. */
  const meetingRows = computed<MeetingRow[]>(() =>
    allMeetings.value
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((meeting) => {
        const own = entriesOfMeeting(meeting.id)
        return {
          meeting,
          attendeeNames: meeting.attendeeIds
            .map((id) => memberName(id))
            .filter((n): n is string => n !== null),
          threadCount: new Set(own.map((e) => e.threadId)).size,
          decidedCount: own.filter((e) => e.kind === 'decide' || e.kind === 'change').length,
          deferredCount: own.filter((e) => e.kind === 'defer').length,
          dateLabel: monthDay(meeting.date),
        }
      }),
  )

  /**
   * 회의 하나를 한 화면에 필요한 모양으로 조립한다.
   *
   * 회의가 가진 것은 날짜 · 참석자 · 메모뿐이다. 본문에 해당하는 것은 그날 안건에 남긴 줄이라,
   * 그 줄을 안건별로 묶어 준다. 안건 안에서는 남긴 순서를 그대로 둔다.
   */
  function meetingDetail(meetingId: string): MeetingDetail | null {
    const meeting = allMeetings.value.find((m) => m.id === meetingId)
    if (!meeting) return null

    const threads: MeetingThreadLines[] = []
    for (const entry of entriesOfMeeting(meetingId)) {
      const thread = allThreads.value.find((t) => t.id === entry.threadId)
      if (!thread) continue
      let group = threads.find((g) => g.thread.id === thread.id)
      if (!group) {
        group = {
          thread,
          deferCount: allEntries.value.filter((e) => e.threadId === thread.id && e.kind === 'defer').length,
          lines: [],
        }
        threads.push(group)
      }
      group.lines.push({ entry, ownerName: memberName(entry.ownerId) })
    }

    const own = entriesOfMeeting(meetingId)
    return {
      meeting,
      attendeeNames: meeting.attendeeIds
        .map((id) => memberName(id))
        .filter((n): n is string => n !== null),
      threads,
      entryCount: own.length,
      decidedCount: own.filter((e) => e.kind === 'decide' || e.kind === 'change').length,
      deferredCount: own.filter((e) => e.kind === 'defer').length,
      dateLabel: monthDay(meeting.date),
    }
  }

  /**
   * 안건 하나를 한 화면에 필요한 모양으로 조립한다.
   *
   * 이력은 새 줄이 위로 온다. 정렬 기준은 createdAt 이 아니라 "그 줄이 놓이는 날짜"다 —
   * 회의에 붙은 줄은 그 회의의 날짜에 놓인다. 같은 회의에 남긴 줄끼리는 등록한 순서를 뒤집는다.
   */
  function threadDetail(threadId: string): ThreadDetail | null {
    const thread = allThreads.value.find((t) => t.id === threadId)
    if (!thread) return null

    const ordered = allEntries.value
      .map((entry, seqNo) => ({ entry, seqNo }))
      .filter((x) => x.entry.threadId === threadId)
      .map((x) => {
        const meeting = meetingById(x.entry.meetingId)
        return { ...x, meeting, at: meeting?.date ?? x.entry.createdAt }
      })
      .sort((a, b) => b.at.localeCompare(a.at) || b.seqNo - a.seqNo)

    /* 결정 · 변경은 뒤에 온 것이 앞의 것을 대체한다. 위에서부터 첫 줄만 살아 있다. */
    let decisionSeen = false
    const events: ThreadEvent[] = ordered.map((x) => {
      const decides = x.entry.kind === 'decide' || x.entry.kind === 'change'
      const superseded = decides && decisionSeen
      if (decides) decisionSeen = true
      return {
        entry: x.entry,
        meeting: x.meeting,
        at: x.at,
        ownerName: memberName(x.entry.ownerId),
        superseded,
      }
    })

    const decisionAt = events.findIndex((e) => !e.superseded && (e.entry.kind === 'decide' || e.entry.kind === 'change'))
    const decision = decisionAt >= 0 ? events[decisionAt] : null
    /* 결정보다 나중에 붙은 세부 추가는 그 결정의 상세로 올라간다 (오래된 것부터) */
    const refines = decision ? events.slice(0, decisionAt).filter((e) => e.entry.kind === 'refine') : []

    const subThreads: SubThreadRow[] = allThreads.value
      .filter((t) => t.parentThreadId === threadId)
      .map((t) => ({ thread: t, splitAtLabel: `${monthDay(t.createdAt)}에 분리` }))

    return {
      thread,
      ownerName: memberName(thread.ownerId),
      events,
      deferCount: events.filter((e) => e.entry.kind === 'defer').length,
      settled: decision !== null,
      current: decision?.entry.text ?? '',
      detail: decision
        ? [...decision.entry.detail, ...refines.map((e) => e.entry.text).reverse()]
        : [],
      settledLabel: decision ? settledLabel(decision, refines[0] ?? null) : '',
      settledOwnerName: decision ? (decision.ownerName ?? memberName(thread.ownerId)) : null,
      subThreads,
    }
  }

  function settledLabel(decision: ThreadEvent, lastRefine: ThreadEvent | null) {
    const where = decision.meeting
      ? `${monthDay(decision.at)} 회의에서 정해`
      : `${monthDay(decision.at)} · 회의를 다시 잡지 않고 담당자 확인으로 정해`
    return lastRefine ? `${where}지고 ${monthDay(lastRefine.at)}에 세부가 붙음` : `${where}짐`
  }

  let seq = 0
  function nextId(prefix: string) {
    seq += 1
    return `${prefix}${seq}`
  }

  function addThread(title: string, ownerId: string | null) {
    const id = nextId('new')
    allThreads.value.unshift({
      id,
      projectId: currentProject.value.id,
      title,
      state: 'queued',
      ownerId,
      parentThreadId: null,
      createdAt: new Date().toISOString().slice(0, 10),
    })
    return id
  }

  /**
   * 회의 하나를 그 회의에서 안건에 남긴 줄과 함께 저장한다.
   *
   * 회의가 짊어지는 것은 날짜 · 참석자 · 메모뿐이다. 회의록 본문은 없고,
   * 안건에 남긴 줄이 그대로 그 회의의 기록이 된다.
   * 안건 상태는 남긴 줄에서 따라온다 — 결정 · 변경이면 결정됨, 그 밖이면 대기에서 미결정으로.
   */
  function saveMeeting(input: MeetingInput) {
    const meetingId = nextId('nm')

    /* tempId → 실제 id. 하위 안건의 부모도 이 회의에서 등록한 안건일 수 있어 함께 옮긴다. */
    const realId = new Map<string, string>()
    const resolve = (id: string) => realId.get(id) ?? id
    for (const nt of input.newThreads) {
      const id = nextId('nt')
      realId.set(nt.tempId, id)
      allThreads.value.unshift({
        id,
        projectId: currentProject.value.id,
        title: nt.title,
        state: 'queued',
        ownerId: nt.ownerId,
        parentThreadId: nt.parentThreadId ? resolve(nt.parentThreadId) : null,
        createdAt: input.date,
      })
    }

    allMeetings.value.unshift({
      id: meetingId,
      projectId: currentProject.value.id,
      title: input.title,
      date: input.date,
      attendeeIds: input.attendeeIds,
      memos: input.memos.map((m, i) => ({
        id: `${meetingId}-m${i + 1}`,
        text: m.text,
        promotedThreadId: m.promotedTempId ? resolve(m.promotedTempId) : null,
      })),
    })

    for (const e of input.entries) {
      const threadId = resolve(e.threadId)
      allEntries.value.push({
        id: nextId('nme'),
        threadId,
        meetingId,
        kind: e.kind,
        text: e.text,
        detail: e.detail,
        note: e.note,
        ownerId: e.ownerId,
        createdAt: input.date,
      })

      const thread = allThreads.value.find((t) => t.id === threadId)
      if (!thread) continue
      if (e.kind === 'decide' || e.kind === 'change') {
        thread.state = 'decided'
        if (e.ownerId) thread.ownerId = e.ownerId
      } else if (thread.state === 'queued') {
        thread.state = 'open'
      }
    }

    return meetingId
  }


  /**
   * 회의 없이 담당자 확인만으로 처리한 줄. meetingId 가 없어 어느 회의에도 붙지 않는다.
   * 결정으로 남기면 안건 상태와 담당자까지 그 자리에서 바뀐다.
   */
  function addOutsideEntry(
    threadId: string,
    kind: Extract<EntryKind, 'decide' | 'refine' | 'defer'>,
    text: string,
    note: string,
    ownerId: string | null,
  ) {
    seq += 1
    allEntries.value.push({
      id: `ne${seq}`,
      threadId,
      meetingId: null,
      kind,
      text,
      detail: [],
      note,
      ownerId,
      createdAt: new Date().toISOString().slice(0, 10),
    })

    const thread = allThreads.value.find((t) => t.id === threadId)
    if (!thread) return
    if (kind === 'decide') {
      thread.state = 'decided'
      if (ownerId) thread.ownerId = ownerId
    } else if (thread.state === 'queued') {
      thread.state = 'open'
    }
  }

  /* ── 요청 ─────────────────────────────────────────────────────────── */

  const allRequests = ref<Request[]>(requests)
  const allRequestComments = ref<RequestComment[]>(requestComments)

  const commentsOfRequest = (requestId: string) =>
    allRequestComments.value
      .filter((c) => c.requestId === requestId)
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  /**
   * 요청 내용이 어디까지 좁혀졌는가.
   * 정리한 뒤에 댓글이 더 달렸으면 확정이었더라도 다시 정리해야 한다.
   */
  function specStateOf(request: Request, commentCount: number): SpecState {
    if (!request.spec) return 'none'
    if (commentCount > request.spec.fromCommentCount) return 'stale'
    return request.spec.confirmed ? 'confirmed' : 'draft'
  }

  const requestRows = computed<RequestRow[]>(() =>
    allRequests.value.map((request) => {
      const commentCount = commentsOfRequest(request.id).length
      return {
        request,
        requesterName: memberName(request.requesterId) ?? '—',
        assigneeName: memberName(request.assigneeId),
        commentCount,
        specState: specStateOf(request, commentCount),
        dueLabel: request.dueDate ? monthDay(request.dueDate) : '—',
      }
    }),
  )

  function requestDetail(requestId: string): RequestDetail | null {
    const request = allRequests.value.find((r) => r.id === requestId)
    if (!request) return null

    const comments = commentsOfRequest(requestId)
    const sourceEntry = request.sourceEntryId
      ? (allEntries.value.find((e) => e.id === request.sourceEntryId) ?? null)
      : null
    const sourceThread = sourceEntry
      ? (allThreads.value.find((t) => t.id === sourceEntry.threadId) ?? null)
      : null
    const sourceMeeting = meetingById(sourceEntry?.meetingId ?? null)

    return {
      request,
      requesterName: memberName(request.requesterId) ?? '—',
      assigneeName: memberName(request.assigneeId),
      comments: comments.map((comment) => ({
        comment,
        authorName: memberName(comment.authorId) ?? '—',
        atLabel: dayTime(comment.createdAt),
      })),
      specState: specStateOf(request, comments.length),
      staleCount: request.spec ? Math.max(0, comments.length - request.spec.fromCommentCount) : 0,
      dueLabel: request.dueDate ? monthDay(request.dueDate) : '—',
      sourceThread,
      sourceLabel: sourceMeeting
        ? `${monthDay(sourceMeeting.date)} 결정에서 나왔습니다`
        : sourceEntry
          ? '회의 밖에서 정한 것에서 나왔습니다'
          : '',
    }
  }

  /** 제목 한 줄만 있으면 등록된다. 상세 내용은 게시판 본문처럼 요청에 그대로 붙는다. */
  function addRequest(title: string, assigneeId: string | null, body = '') {
    const id = nextId('nrq')
    allRequests.value.unshift({
      id,
      projectId: currentProject.value.id,
      title,
      body: body.trim(),
      state: 'todo',
      requesterId: currentMemberId.value,
      assigneeId,
      dueDate: null,
      sourceEntryId: null,
      spec: null,
      createdAt: today(),
    })
    return id
  }

  function addRequestComment(requestId: string, text: string) {
    allRequestComments.value.push({
      id: nextId('nrc'),
      requestId,
      authorId: currentMemberId.value,
      text,
      createdAt: new Date().toISOString().slice(0, 16),
    })
  }

  /**
   * 오간 댓글을 요청 내용으로 정리한다.
   *
   * 진짜로는 서버가 제목 · 본문 · 댓글을 Claude 에 넘겨 불릿 목록을 받아온다. 여기서는 목업이 미리 적어 둔
   * 것을 쓰고, 없으면 아직 정리할 만큼 이야기가 오가지 않았다고 본다.
   * 무엇을 뽑든 결과는 언제나 초안이다 — 확정은 사람이 한다.
   */
  function summarizeRequest(requestId: string) {
    const request = allRequests.value.find((r) => r.id === requestId)
    if (!request) return
    const comments = commentsOfRequest(requestId)
    const points = draftPoints[requestId] ?? request.spec?.points ?? []
    request.spec = {
      points: points.length ? points : ['아직 정리할 만큼 이야기가 오가지 않았습니다.'],
      confirmed: false,
      confirmedById: null,
      confirmedAt: null,
      fromCommentCount: comments.length,
    }
  }

  /** 확정해야 담당자가 이 내용을 기준으로 일한다. 그전까지 요청은 "내용 정리 중"이다. */
  function confirmRequestSpec(requestId: string) {
    const request = allRequests.value.find((r) => r.id === requestId)
    if (!request?.spec) return
    request.spec.confirmed = true
    request.spec.confirmedById = currentMemberId.value
    request.spec.confirmedAt = today()
    request.spec.fromCommentCount = commentsOfRequest(requestId).length
  }

  function setRequestState(requestId: string, state: RequestState) {
    const request = allRequests.value.find((r) => r.id === requestId)
    if (request) request.state = state
  }

  /**
   * 댓글로 결론이 안 나면 그건 정할 일이라는 신호다. 안건으로 올리고 요청은 접는다.
   * 올라간 안건은 대기 상태로 다음 회의의 후보가 된다.
   */
  function promoteRequestToThread(requestId: string) {
    const request = allRequests.value.find((r) => r.id === requestId)
    if (!request) return null
    const threadId = addThread(request.title, request.assigneeId)
    request.state = 'done'
    return threadId
  }

  return {
    allMembers,
    currentMemberId,
    currentProject,
    allMeetings,
    allThreads,
    allEntries,
    rows,
    memberName,
    meetingById,
    meetingRows,
    meetingDetail,
    entriesOfThread,
    threadDetail,
    addThread,
    saveMeeting,
    addOutsideEntry,
    allRequests,
    allRequestComments,
    requestRows,
    requestDetail,
    addRequest,
    addRequestComment,
    summarizeRequest,
    confirmRequestSpec,
    setRequestState,
    promoteRequestToThread,
  }
})
