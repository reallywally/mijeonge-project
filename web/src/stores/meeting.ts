import { defineStore } from 'pinia'
import { computed } from 'vue'
import { monthDay } from '@/lib/date'
import { useDataStore } from '@/stores/data'
import type {
  Entry,
  Meeting,
  MeetingDetail,
  MeetingInput,
  MeetingRow,
  MeetingThreadLines,
  Task,
} from '@/types/domain'

/**
 * 회의. 회의가 짊어지는 것은 날짜 · 참석자 · 녹음뿐이고 회의록 본문은 없다 —
 * 그날 안건에 남긴 줄이 그대로 그 회의의 기록이다.
 *
 * 안건이 하나도 안 붙은 회의(메모만 남긴 주간회의)도 있다. 그 회의는 안건 이력으로는
 * 닿지 않으므로 회의 목록이 유일한 입구다.
 */
export const useMeetingStore = defineStore('meeting', () => {
  const data = useDataStore()

  const meetings = computed<Meeting[]>(() =>
    data.allMeetings.filter((m) => m.projectId === data.currentProjectId),
  )

  const entriesOfMeeting = (meetingId: string): Entry[] =>
    data.allEntries.filter((e) => e.meetingId === meetingId)

  /** 이 회의에 걸어 둔 작업 */
  const tasksOfMeeting = (meetingId: string): Task[] =>
    data.meetingTasks
      .filter((l) => l.meetingId === meetingId)
      .map((l) => data.allTasks.find((t) => t.id === l.taskId))
      .filter((t): t is Task => t !== undefined)

  /** 회의 목록. 늘 최근 것이 위다 — 지난 회의에 뒤늦게 적는 경우가 있어 날짜로 다시 세운다. */
  const rows = computed<MeetingRow[]>(() =>
    meetings.value
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((meeting) => {
        const own = entriesOfMeeting(meeting.id)
        return {
          meeting,
          attendeeNames: meeting.attendeeIds
            .map((id) => data.memberName(id))
            .filter((n): n is string => n !== null),
          threadCount: new Set(own.map((e) => e.threadId)).size,
          decidedCount: own.filter((e) => e.kind === 'decide' || e.kind === 'change').length,
          deferredCount: own.filter((e) => e.kind === 'defer').length,
          memoCount: meeting.memos.length,
          taskCount: tasksOfMeeting(meeting.id).length,
          dateLabel: monthDay(meeting.date),
        }
      }),
  )

  /** 안건 없이 메모만 남은 회의 — 시나리오 4 의 주간회의가 여기 선다 */
  const memoOnlyCount = computed(() => rows.value.filter((r) => r.threadCount === 0).length)

  /**
   * 회의 하나를 한 화면에 필요한 모양으로 조립한다.
   * 그날 안건에 남긴 줄을 안건별로 묶고, 안건 안에서는 남긴 순서를 그대로 둔다.
   */
  function meetingDetail(meetingId: string): MeetingDetail | null {
    const meeting = data.allMeetings.find((m) => m.id === meetingId)
    if (!meeting) return null

    const threads: MeetingThreadLines[] = []
    for (const entry of entriesOfMeeting(meetingId)) {
      const thread = data.allThreads.find((t) => t.id === entry.threadId)
      if (!thread) continue
      let group = threads.find((g) => g.thread.id === thread.id)
      if (!group) {
        group = {
          thread,
          deferCount: data.allEntries.filter((e) => e.threadId === thread.id && e.kind === 'defer')
            .length,
          lines: [],
        }
        threads.push(group)
      }
      group.lines.push({ entry, ownerName: data.memberName(entry.ownerId) })
    }

    const own = entriesOfMeeting(meetingId)
    return {
      meeting,
      attendeeNames: meeting.attendeeIds
        .map((id) => data.memberName(id))
        .filter((n): n is string => n !== null),
      threads,
      entryCount: own.length,
      decidedCount: own.filter((e) => e.kind === 'decide' || e.kind === 'change').length,
      deferredCount: own.filter((e) => e.kind === 'defer').length,
      dateLabel: monthDay(meeting.date),
    }
  }

  /**
   * 회의 하나를 그 회의에서 안건에 남긴 줄과 함께 저장한다.
   *
   * 안건 상태는 남긴 줄에서 따라온다 — 결정 · 변경이면 결정됨, 그 밖이면 대기에서 미결정으로.
   */
  function saveMeeting(input: MeetingInput) {
    const meetingId = data.nextId('nm')

    /* tempId → 실제 id. 하위 안건의 부모도 이 회의에서 등록한 안건일 수 있어 함께 옮긴다. */
    const realId = new Map<string, string>()
    const resolve = (id: string) => realId.get(id) ?? id
    for (const nt of input.newThreads) {
      const id = data.nextId('nt')
      realId.set(nt.tempId, id)
      data.allThreads.unshift({
        id,
        projectId: data.currentProjectId,
        title: nt.title,
        state: 'queued',
        ownerId: nt.ownerId,
        parentThreadId: nt.parentThreadId ? resolve(nt.parentThreadId) : null,
        createdAt: input.date,
      })
    }

    data.allMeetings.unshift({
      id: meetingId,
      projectId: data.currentProjectId,
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
      data.allEntries.push({
        id: data.nextId('nme'),
        threadId,
        meetingId,
        kind: e.kind,
        text: e.text,
        detail: e.detail,
        note: e.note,
        ownerId: e.ownerId,
        createdAt: input.date,
      })

      const thread = data.allThreads.find((t) => t.id === threadId)
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

  /** 회의 상세에서 작업을 걸고 뗀다. 작업 상세의 '연관 회의' 와 같은 링크다. */
  function linkTask(meetingId: string, taskId: string) {
    const already = data.meetingTasks.some((l) => l.meetingId === meetingId && l.taskId === taskId)
    if (!already) data.meetingTasks.push({ meetingId, taskId })
  }

  function unlinkTask(meetingId: string, taskId: string) {
    data.meetingTasks = data.meetingTasks.filter(
      (l) => !(l.meetingId === meetingId && l.taskId === taskId),
    )
  }

  return {
    meetings,
    rows,
    memoOnlyCount,
    entriesOfMeeting,
    tasksOfMeeting,
    meetingDetail,
    saveMeeting,
    linkTask,
    unlinkTask,
  }
})
