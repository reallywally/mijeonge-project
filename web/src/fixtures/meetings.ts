import type { Meeting } from '@/types/domain'

/**
 * 회의. 회의가 짊어지는 것은 날짜 · 참석자 · 녹음뿐이고, 회의록 본문은 없다.
 * 안건에 남긴 줄(Entry)이 그대로 그 회의의 기록이다.
 *
 * 안건이 하나도 안 붙은 회의(주간회의)가 둘 있다 — 시나리오 4. 이 회의들은
 * 안건 이력으로는 닿지 않으므로 회의 목록이 유일한 입구다.
 */

export const meetings: Meeting[] = [
  {
    id: 'm1',
    projectId: 'p1',
    title: '9월 1주차 주간회의',
    date: '2026-09-04',
    attendeeIds: ['u1', 'u2', 'u3'],
    memos: [
      {
        id: 'mm1',
        text: '킥오프 이후 첫 주다. 설계 산출물 목록은 다음 주에 공유하기로 했다.',
        promotedThreadId: null,
      },
      { id: 'mm2', text: '개발 장비는 9월 둘째 주에 들어온다.', promotedThreadId: null },
      { id: 'mm3', text: '정하늘이 9월 말 휴가다.', promotedThreadId: null },
    ],
  },
  {
    id: 'm2',
    projectId: 'p1',
    title: '기간계 API in · out 회의',
    date: '2026-09-07',
    attendeeIds: ['u1', 'u2', 'u4'],
    memos: [
      {
        id: 'mm4',
        text: '기간계 담당자가 이 자리에 없었다. 다음에는 부르기로 했다.',
        promotedThreadId: null,
      },
    ],
  },
  {
    id: 'm3',
    projectId: 'p1',
    title: '개발 환경 확정 회의',
    date: '2026-09-10',
    attendeeIds: ['u1', 'u2', 'u3', 'u4'],
    memos: [
      {
        id: 'mm5',
        text: '서버는 9월 9일에 발급됐다. OS 는 PM 이 우분투 최신 버전으로 정했다고 전달받아 안건에는 회의 밖 줄로 적어 두었다.',
        promotedThreadId: null,
      },
      {
        id: 'mm6',
        text: '방화벽은 정보보안팀에 따로 신청해야 한다. 양식은 사내 포털 > 보안.',
        promotedThreadId: null,
      },
      {
        id: 'mm7',
        text: '개발 서버 백업 주기는 기간계와 맞추자는 이야기가 나왔다.',
        promotedThreadId: 't4',
      },
    ],
  },
  {
    id: 'm4',
    projectId: 'p1',
    title: '9월 2주차 주간회의',
    date: '2026-09-11',
    attendeeIds: ['u1', 'u2', 'u3', 'u4'],
    memos: [
      { id: 'mm8', text: '데이터 설계는 9월 14일에 끝난다.', promotedThreadId: null },
      {
        id: 'mm9',
        text: '가상비서 tool01 은 붙였고 tool02 를 하는 중이다.',
        promotedThreadId: null,
      },
      {
        id: 'mm10',
        text: '기간계 이슈로 보험료 산출 API 는 아직 못 들어갔다.',
        promotedThreadId: null,
      },
      { id: 'mm11', text: '다음 주에 일정을 한 번 손봐야 할 것 같다.', promotedThreadId: null },
    ],
  },
  {
    id: 'm5',
    projectId: 'p1',
    title: '기간계 API in · out 재회의',
    date: '2026-09-14',
    attendeeIds: ['u1', 'u4'],
    memos: [
      {
        id: 'mm12',
        text: '기간계 업무 정의 일정을 PM 이 확인해 주기로 했다.',
        promotedThreadId: null,
      },
    ],
  },
  {
    id: 'm6',
    projectId: 'p1',
    title: '일정 조율 회의',
    date: '2026-09-15',
    attendeeIds: ['u1', 'u2', 'u3', 'u4'],
    memos: [
      {
        id: 'mm13',
        text: '오픈 일정은 고객사와 이미 공유된 날짜라 건드릴 수 없다는 전제에서 시작했다.',
        promotedThreadId: null,
      },
    ],
  },
]
