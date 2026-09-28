"""첫 시드 — `web/src/fixtures/*.ts` 를 그대로 옮긴다.

화면이 목업일 때와 똑같이 보이는 것이 목표다(비교가 곧 검증이다).
id 도 픽스처의 값(`p1` · `u3` · `k4` …)을 그대로 쓴다 — 목업 화면과 한 줄씩 대조할 수 있게.
새로 만드는 레코드는 서버가 uuid 를 붙인다(`app/models/base.py` 의 `new_id`).

    uv run python -m scripts.seed

돌릴 때마다 도메인 테이블을 비우고 다시 넣는다.
"""

import asyncio
from datetime import date
from typing import Protocol

from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine, session_factory
from app.models import (
    Entry,
    EntryDetail,
    Meeting,
    MeetingAttendee,
    MeetingMemo,
    MeetingTaskLink,
    Member,
    Project,
    Task,
    TaskLine,
    TaskThreadLink,
    Thread,
)
from app.time import at_day_start as at

# 픽스처의 createdAt 은 날짜뿐이다. 저장은 timestamptz 라 `at` 이 그날 0시(KST)로 앉힌다


def d(day: str | None) -> date | None:
    return date.fromisoformat(day) if day else None


def projects() -> list[Project]:
    # last_task_no 는 픽스처가 이미 써 버린 마지막 번호다 — 다음 작업이 HW-22 · PAS-3 로 나온다
    return [
        Project(id="p1", name="한화손보 차세대", key_prefix="HW", last_task_no=21),
        Project(id="p2", name="삼성생명 PAS", key_prefix="PAS", last_task_no=2),
        Project(id="p3", name="경영지원 파트", key_prefix="MG", last_task_no=0),
    ]


def members() -> list[Member]:
    return [
        Member(id="u1", name="김서연"),
        Member(id="u2", name="박지훈"),
        Member(id="u3", name="이도현"),
        Member(id="u4", name="정하늘"),
    ]


def thread(
    id_: str, title: str, state: str, owner: str | None, created: str, project: str = "p1"
) -> Thread:
    return Thread(
        id=id_,
        project_id=project,
        title=title,
        state=state,
        owner_id=owner,
        parent_thread_id=None,
        created_at=at(created),
    )


def threads() -> list[Thread]:
    return [
        # 시나리오 1 — 개발 환경 설정 작업에서 갈라져 나온 둘
        thread("t1", "서버 OS 결정", "decided", "u3", "2026-09-08"),
        thread("t2", "DB 결정", "decided", "u3", "2026-09-08"),
        thread("t3", "사내망에서 외부 모델 호출 허용 범위", "open", "u1", "2026-09-09"),
        thread("t4", "개발 서버 백업 주기", "queued", None, "2026-09-10"),
        # 시나리오 2 — 두 번 미뤄진 안건
        thread("t5", "보험료 산출 기간계 API 호출 in · out 정의", "open", "u4", "2026-09-07"),
        # 시나리오 3 — 회의만으로 끝난 안건
        thread(
            "t6",
            "일정 조율 — 전체 일정을 미룰지, 테스트 기간을 줄일지",
            "decided",
            "u1",
            "2026-09-14",
        ),
        thread("t7", "가상비서 tool 만드는 순서", "queued", "u4", "2026-09-12"),
        thread("t8", "AI 심사 학습 데이터 범위", "queued", "u1", "2026-09-12"),
        thread("t9", "공통 코드 체계 확정", "queued", "u2", "2026-09-15"),
        # 다른 프로젝트 — 프로젝트를 바꾸면 화면이 갈리는지 보려고 둔다
        thread("t10", "이관 범위 확정", "queued", "u2", "2026-09-16", project="p2"),
    ]


def meeting(
    id_: str, title: str, day: str, attendees: list[str], memos: list[tuple[str, str, str | None]]
) -> Meeting:
    return Meeting(
        id=id_,
        project_id="p1",
        title=title,
        date=date.fromisoformat(day),
        created_at=at(day),
        attendees=[MeetingAttendee(meeting_id=id_, member_id=m) for m in attendees],
        memos=[
            MeetingMemo(
                id=mid, meeting_id=id_, text=text, promoted_thread_id=promoted, sort_order=i
            )
            for i, (mid, text, promoted) in enumerate(memos)
        ],
    )


def meetings() -> list[Meeting]:
    return [
        meeting(
            "m1",
            "9월 1주차 주간회의",
            "2026-09-04",
            ["u1", "u2", "u3"],
            [
                ("mm1", "킥오프 이후 첫 주다. 설계 산출물 목록은 다음 주에 공유하기로 했다.", None),
                ("mm2", "개발 장비는 9월 둘째 주에 들어온다.", None),
                ("mm3", "정하늘이 9월 말 휴가다.", None),
            ],
        ),
        meeting(
            "m2",
            "기간계 API in · out 회의",
            "2026-09-07",
            ["u1", "u2", "u4"],
            [("mm4", "기간계 담당자가 이 자리에 없었다. 다음에는 부르기로 했다.", None)],
        ),
        meeting(
            "m3",
            "개발 환경 확정 회의",
            "2026-09-10",
            ["u1", "u2", "u3", "u4"],
            [
                (
                    "mm5",
                    "서버는 9월 9일에 발급됐다. OS 는 PM 이 우분투 최신 버전으로 정했다고 전달받아"
                    " 안건에는 회의 밖 줄로 적어 두었다.",
                    None,
                ),
                ("mm6", "방화벽은 정보보안팀에 따로 신청해야 한다. 양식은 사내 포털 > 보안.", None),
                ("mm7", "개발 서버 백업 주기는 기간계와 맞추자는 이야기가 나왔다.", "t4"),
            ],
        ),
        meeting(
            "m4",
            "9월 2주차 주간회의",
            "2026-09-11",
            ["u1", "u2", "u3", "u4"],
            [
                ("mm8", "데이터 설계는 9월 14일에 끝난다.", None),
                ("mm9", "가상비서 tool01 은 붙였고 tool02 를 하는 중이다.", None),
                ("mm10", "기간계 이슈로 보험료 산출 API 는 아직 못 들어갔다.", None),
                ("mm11", "다음 주에 일정을 한 번 손봐야 할 것 같다.", None),
            ],
        ),
        meeting(
            "m5",
            "기간계 API in · out 재회의",
            "2026-09-14",
            ["u1", "u4"],
            [("mm12", "기간계 업무 정의 일정을 PM 이 확인해 주기로 했다.", None)],
        ),
        meeting(
            "m6",
            "일정 조율 회의",
            "2026-09-15",
            ["u1", "u2", "u3", "u4"],
            [
                (
                    "mm13",
                    "오픈 일정은 고객사와 이미 공유된 날짜라 건드릴 수 없다는 전제에서 시작했다.",
                    None,
                )
            ],
        ),
    ]


def entry(
    id_: str,
    thread_id: str,
    meeting_id: str | None,
    kind: str,
    text: str,
    detail: list[str],
    note: str,
    owner: str | None,
    created: str,
) -> Entry:
    return Entry(
        id=id_,
        thread_id=thread_id,
        meeting_id=meeting_id,
        kind=kind,
        text=text,
        note=note,
        owner_id=owner,
        created_at=at(created),
        details=[
            EntryDetail(id=f"{id_}d{i}", entry_id=id_, text=t, sort_order=i)
            for i, t in enumerate(detail)
        ],
    )


def entries() -> list[Entry]:
    return [
        # 시나리오 1 — 회의 밖 처리. 공유가 안 됐을 뿐 이미 정해져 있던 것
        entry(
            "e1",
            "t1",
            None,
            "decide",
            "우분투 최신 버전으로 한다",
            [],
            "PM 에게 전달받아 이도현이 정리했다. 회의로 다루지 않았다.",
            "u3",
            "2026-09-09",
        ),
        # 시나리오 2 — 첫 번째 미룸
        entry(
            "e2",
            "t5",
            "m2",
            "defer",
            "이번 회의에서는 정하지 못했다",
            [],
            "기간계 업무 정의가 안 돼 in · out 을 정할 수 없다. 다음 주 월요일에 다시 본다.",
            "u4",
            "2026-09-07",
        ),
        # 시나리오 1 — 회의에서 정한 것
        entry(
            "e3",
            "t2",
            "m3",
            "decide",
            "mysql 을 쓴다",
            [
                "postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺀다",
                "supabase 는 비용 때문에 뺀다",
            ],
            "",
            "u3",
            "2026-09-10",
        ),
        entry(
            "e4",
            "t3",
            "m3",
            "defer",
            "이번 회의에서는 정하지 못했다",
            [],
            "정보보안팀 확인이 먼저다. 다음 회의 후보로 올려 둔다.",
            "u1",
            "2026-09-10",
        ),
        # 시나리오 2 — 두 번째 미룸
        entry(
            "e5",
            "t5",
            "m5",
            "defer",
            "여전히 업무 정의가 없어 또 미룬다",
            [],
            "두 번째 미룸이다. 다음에는 기간계 담당자를 회의에 부르기로 했다.",
            "u4",
            "2026-09-14",
        ),
        # 시나리오 3
        entry(
            "e6",
            "t6",
            "m6",
            "decide",
            "전체 일정은 그대로 두고 테스트 기간만 2주 줄인다",
            ["늘어난 개발 기간은 그대로 둔다", "통합 테스트를 3주에서 1주로 줄인다"],
            "일정을 미루면 오픈 일정이 밀린다는 데에 이견이 없었다.",
            "u1",
            "2026-09-15",
        ),
    ]


# 개발 환경 설정(HW-4)의 본문 — 체크박스와 불릿
ENV_BODY = [
    ("l1", "check", "서버 신청서 제출", True, 0),
    ("l2", "check", "우분투 최신 버전 설치", True, 0),
    ("l3", "check", "mysql 설치와 계정 발급", False, 0),
    ("l4", "check", "개발자 접속 계정 4개 만들기", False, 0),
    ("l5", "bullet", "방화벽은 정보보안팀에 따로 신청해야 한다 (사내 포털 > 보안)", False, 1),
    ("l6", "bullet", "백업 정책은 기간계와 같은 주기로 맞추기로 했다", False, 1),
    ("l7", "check", "CI 러너 붙이기", False, 0),
]


def task(
    id_: str,
    key: str,
    title: str,
    parent: str | None,
    status: str,
    owner: str | None,
    start: str | None,
    due: str | None,
    lines: list[tuple[str, str, str, bool, int]] | None = None,
    project: str = "p1",
) -> Task:
    return Task(
        id=id_,
        project_id=project,
        key=key,
        title=title,
        parent_id=parent,
        status=status,
        owner_id=owner,
        start=d(start),
        due=d(due),
        priority="normal",
        created_at=at("2026-09-04"),
        lines=[
            TaskLine(
                id=lid, task_id=id_, kind=kind, text=text, done=done, level=level, sort_order=i
            )
            for i, (lid, kind, text, done, level) in enumerate(lines or [])
        ],
    )


def tasks() -> list[Task]:
    return [
        task("k1", "HW-1", "설계", None, "doing", None, "2026-09-07", "2026-09-22"),
        task("k2", "HW-2", "데이터 설계", "k1", "done", "u1", "2026-09-07", "2026-09-14"),
        task("k3", "HW-3", "프로그램 설계", "k1", "doing", "u2", "2026-09-15", "2026-09-22"),
        task(
            "k4",
            "HW-4",
            "개발 환경 설정",
            None,
            "doing",
            "u3",
            "2026-09-08",
            "2026-09-15",
            ENV_BODY,
        ),
        task("k5", "HW-5", "개발", None, "todo", None, "2026-09-16", "2026-10-04"),
        task("k6", "HW-6", "AI Biz", "k5", "todo", None, "2026-09-16", "2026-10-04"),
        task("k7", "HW-7", "가상비서", "k6", "doing", "u4", "2026-09-16", "2026-09-25"),
        task("k8", "HW-8", "tool01", "k7", "done", "u4", "2026-09-16", "2026-09-18"),
        task("k9", "HW-9", "tool02", "k7", "doing", "u4", "2026-09-19", "2026-09-21"),
        task("k10", "HW-10", "tool03", "k7", "todo", None, "2026-09-22", "2026-09-23"),
        task("k11", "HW-11", "tool04", "k7", "todo", None, "2026-09-24", "2026-09-25"),
        task("k12", "HW-12", "AI 심사", "k6", "todo", None, "2026-09-23", "2026-09-30"),
        task("k13", "HW-13", "모델링", "k12", "todo", "u1", "2026-09-23", "2026-09-30"),
        task("k14", "HW-14", "상품 추천", "k6", "todo", None, "2026-09-26", "2026-10-04"),
        task("k15", "HW-15", "기존 상품 분석", "k14", "todo", "u2", "2026-09-26", "2026-09-29"),
        task("k16", "HW-16", "모델링", "k14", "todo", None, "2026-09-30", "2026-10-04"),
        task("k17", "HW-17", "챗봇", "k5", "todo", None, "2026-09-28", "2026-10-04"),
        # 시나리오 2 — 안건이 안 정해져 멈췄고 기간도 못 잡았다
        task("k18", "HW-18", "보험료 산출 기간계 API 개발", "k5", "blocked", "u4", None, None),
        # 개발 환경 설정의 하위 작업
        task(
            "k19",
            "HW-19",
            "서버 발급받고 접속 확인",
            "k4",
            "done",
            "u3",
            "2026-09-08",
            "2026-09-09",
        ),
        task(
            "k20",
            "HW-20",
            "DB 설치와 초기 스키마 반영",
            "k4",
            "doing",
            "u3",
            "2026-09-10",
            "2026-09-12",
        ),
        task("k21", "HW-21", "개발자 계정 배포", "k4", "todo", "u1", "2026-09-12", "2026-09-15"),
        # 다른 프로젝트
        task(
            "x1",
            "PAS-1",
            "현행 분석",
            None,
            "doing",
            "u2",
            "2026-09-14",
            "2026-09-30",
            project="p2",
        ),
        task(
            "x2",
            "PAS-2",
            "이관 대상 목록 만들기",
            "x1",
            "todo",
            "u2",
            "2026-09-21",
            "2026-09-30",
            project="p2",
        ),
    ]


# 작업 ↔ 안건. 작업을 하다가 정해야 했던 것들이다
TASK_THREAD_LINKS = [
    ("k4", "t1"),  # 개발 환경 설정 ↔ 서버 OS 결정
    ("k4", "t2"),  # 개발 환경 설정 ↔ DB 결정
    ("k18", "t5"),  # 기간계 API ↔ in · out 정의
    ("k13", "t8"),  # 모델링 ↔ 학습 데이터 범위
    ("k3", "t9"),  # 프로그램 설계 ↔ 공통 코드 체계
]

# 회의 ↔ 작업. 그 회의에서 정해진 것이 어느 작업을 움직이는지
MEETING_TASK_LINKS = [
    ("m3", "k4"),
    ("m2", "k18"),
    ("m5", "k18"),
    ("m6", "k1"),
    ("m6", "k5"),
    ("m6", "k18"),
]


async def clear(session: AsyncSession) -> None:
    """자식부터 지운다. FK 가 CASCADE 라도 순서를 눈에 보이게 둔다."""
    for model in (
        MeetingTaskLink,
        TaskThreadLink,
        TaskLine,
        Task,
        EntryDetail,
        Entry,
        MeetingMemo,
        MeetingAttendee,
        Meeting,
        Thread,
        Member,
        Project,
    ):
        await session.execute(delete(model))


class Ordered(Protocol):
    seq: int


def in_order[T: Ordered](rows: list[T]) -> list[T]:
    """등록 순서(seq)를 픽스처의 배열 순서로 박는다.

    화면이 배열 순서를 그대로 쓰기 때문에(안건 목록 · 작업 목록에 정렬이 없다) 여기서
    어긋나면 목업과 다른 순서로 그려진다. Postgres 의 Identity 는 `by default` 라 값을
    직접 넣을 수 있고, 넣은 뒤에는 `advance_identity` 로 다음 번호를 밀어 준다.
    """
    for number, row in enumerate(rows, start=1):
        row.seq = number
    return rows


async def advance_identity(session: AsyncSession) -> None:
    """직접 넣은 seq 뒤로 자동 번호를 민다. 안 밀면 다음 INSERT 가 1 번부터 부딪힌다.

    세 번째 인자(is_called)를 같이 준다 — 행이 없을 때 1 로만 밀면 다음이 2 번이 되어 1 번을
    건너뛴다. 빈 테이블에서는 is_called=false 라야 다음이 1 번이다.
    """
    if session.get_bind().dialect.name != "postgresql":
        return  # sqlite 는 Identity 를 무시한다 — 테스트는 늘 seq 를 직접 넣는다
    for table in ("thread", "entry", "meeting", "task"):
        await session.execute(
            text(
                f"select setval(pg_get_serial_sequence('{table}', 'seq'),"
                f" coalesce((select max(seq) from {table}), 1),"
                f" (select count(*) from {table}) > 0)"
            )
        )


async def seed(session: AsyncSession) -> None:
    """세션을 받는다 — 테스트가 다른 DB 를 물릴 수 있게."""
    await clear(session)
    session.add_all(projects())
    session.add_all(members())
    await session.flush()
    session.add_all(in_order(threads()))
    session.add_all(in_order(meetings()))
    await session.flush()
    session.add_all(in_order(entries()))
    session.add_all(in_order(tasks()))
    await session.flush()
    await advance_identity(session)
    session.add_all(
        [TaskThreadLink(task_id=t, thread_id=h) for t, h in TASK_THREAD_LINKS]
        + [MeetingTaskLink(meeting_id=m, task_id=t) for m, t in MEETING_TASK_LINKS]
    )
    await session.commit()


async def run() -> None:
    async with session_factory() as session:
        await seed(session)

    counts = {
        "project": len(projects()),
        "member": len(members()),
        "thread": len(threads()),
        "meeting": len(meetings()),
        "entry": len(entries()),
        "task": len(tasks()),
        "link": len(TASK_THREAD_LINKS) + len(MEETING_TASK_LINKS),
    }
    print("시드 완료 — " + " · ".join(f"{k} {v}" for k, v in counts.items()))
    await engine.dispose()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
