"""첫 시드 — `web/src/fixtures/*.ts` 를 그대로 옮긴다.

화면이 목업일 때와 똑같이 보이는 것이 목표다(비교가 곧 검증이다).
id 도 픽스처의 값(`p1` · `u3` · `k4` …)을 그대로 쓴다 — 목업 화면과 한 줄씩 대조할 수 있게.
새로 만드는 레코드는 서버가 uuid 를 붙인다(`app/models/base.py` 의 `new_id`).

    uv run python -m scripts.seed

돌릴 때마다 도메인 테이블을 비우고 다시 넣는다.
"""

import asyncio
from dataclasses import dataclass, field
from datetime import date
from functools import cache
from typing import Protocol

from argon2 import PasswordHasher
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine, session_factory
from app.models import (
    AuthIdentity,
    AuthSession,
    CheckRequest,
    Entry,
    EntryDetail,
    Member,
    Minutes,
    Part,
    PartMember,
    Project,
    ProjectMember,
    ProjectReport,
    RiskSetting,
    Task,
    TaskComment,
    TaskDependency,
    TaskLine,
    TaskLog,
    TaskThreadLink,
    TestCase,
    TestRef,
    TestStep,
    Thread,
    ThreadCc,
    ThreadOption,
)
from app.services.auth import PASSWORD
from app.services.check import recipient_loads
from app.time import at, today_kst

# createdAt 은 픽스처의 값을 그대로 쓴다 — 계약대로 ISO 8601 UTC(`…Z`) 다.


def d(day: str | None) -> date | None:
    return date.fromisoformat(day) if day else None


def projects() -> list[Project]:
    # last_task_no 는 픽스처가 이미 써 버린 마지막 번호다 — 다음 작업이 HW-23 · PAS-3 로 나온다
    return [
        Project(
            id="p1",
            name="한화손보 차세대",
            task_key_prefix="HW",
            last_task_no=22,
            # 시드 테스트가 HW-T1 ~ T8 을 썼다 — 다음은 HW-T9
            next_test_no=9,
        ),
        Project(id="p2", name="삼성생명 PAS", task_key_prefix="PAS", last_task_no=2),
        Project(id="p3", name="경영지원 파트", task_key_prefix="MG", last_task_no=0),
    ]


# 개발용 계정 (docs/api/auth.md '테이블'). 운영 DB 에 시드를 돌리지 않는다
DEV_ADMIN_EMAIL = "admin@innoflow.local"
DEV_PASSWORD = "innoflow-admin"


def members() -> list[Member]:
    return [
        Member(id="admin", name="관리자", email=DEV_ADMIN_EMAIL, system_role="admin"),
        Member(id="u1", name="김서연", email="u1@innoflow.local"),
        Member(id="u2", name="박지훈", email="u2@innoflow.local"),
        Member(id="u3", name="이도현", email="u3@innoflow.local"),
        Member(id="u4", name="정하늘", email="u4@innoflow.local"),
    ]


@cache
def _dev_password_hash() -> str:
    # argon2 는 일부러 느리다 — 시드를 여러 번 돌리는 테스트가 매번 다시 계산하지 않게 한 번만
    return PasswordHasher().hash(DEV_PASSWORD)


def identities() -> list[AuthIdentity]:
    return [
        AuthIdentity(
            member_id=member.id,
            provider=PASSWORD,
            subject=member.email,
            password_hash=_dev_password_hash(),
        )
        for member in members()
        if member.email is not None
    ]


def grants() -> list[ProjectMember]:
    """리비전 0008 과 같다 — 프로젝트마다 u1 ~ u4 를 user 로. 관리자는 부여 없이 다 본다.

    u1 만 p1 의 관리자다 — 프로젝트 관리자 화면을 개발에서 열어 볼 수 있게.
    """
    return [
        ProjectMember(
            project_id=project.id,
            member_id=member_id,
            role="admin" if (project.id, member_id) == ("p1", "u1") else "user",
        )
        for project in projects()
        for member_id in ("u1", "u2", "u3", "u4")
    ]


# 파트 — docs/api/part.md '시드 · 목업' 표 그대로. 프론트 목업이 같은 id 와 소속을 쓴다.
# 표에 없는 작업 · 안건은 공통(null)이다. p2 · p3 에는 파트가 없다(전환이 숨는 경우)
PARTS = [("pt1", "인프라"), ("pt2", "AI"), ("pt3", "기간계 연동")]
PART_MEMBERS = [("pt1", "u3"), ("pt2", "u1"), ("pt2", "u4"), ("pt3", "u2")]
TASK_PARTS = {
    **dict.fromkeys(("k4", "k19", "k20", "k21", "k22"), "pt1"),
    **dict.fromkeys((f"k{n}" for n in range(6, 17)), "pt2"),
    "k18": "pt3",
}
# 참조 — docs/api/check.md '시드 · 목업' 표 그대로. 표에 없는 안건은 []
THREAD_CC = {"t1": ["u1"], "t2": ["u2", "u4"], "t6": ["u2"]}
THREAD_PARTS = {
    **dict.fromkeys(("t1", "t2", "t4"), "pt1"),
    **dict.fromkeys(("t3", "t7", "t8"), "pt2"),
    "t5": "pt3",
}


def parts() -> list[Part]:
    return [Part(id=id_, project_id="p1", name=name) for id_, name in PARTS]


def part_members() -> list[PartMember]:
    return [PartMember(part_id=part_id, member_id=member_id) for part_id, member_id in PART_MEMBERS]


def thread(
    id_: str,
    title: str,
    state: str,
    owner: str | None,
    created: str,
    project: str = "p1",
    description: str = "",
    options: tuple[str, ...] = (),
    due: str | None = None,
) -> Thread:
    return Thread(
        id=id_,
        project_id=project,
        title=title,
        description=description,
        state=state,
        owner_id=owner,
        due_date=d(due),
        parent_thread_id=None,
        part_id=THREAD_PARTS.get(id_),
        created_at=at(created),
        options=[
            ThreadOption(id=f"{id_}o{i + 1}", thread_id=id_, text=text, sort_order=i)
            for i, text in enumerate(options)
        ],
        cc=[
            ThreadCc(thread_id=id_, project_id=project, member_id=member_id, sort_order=i)
            for i, member_id in enumerate(THREAD_CC.get(id_, []))
        ],
    )


def threads() -> list[Thread]:
    return [
        # 시나리오 1 — 개발 환경 설정 작업에서 갈라져 나온 둘
        thread(
            "t1",
            "서버 OS 결정",
            "decided",
            "u3",
            "2026-09-08T00:30:00Z",
            description=(
                "개발 환경 설정 작업에서 서버 OS가 정해지지 않아 서버 구성을 시작하지 못하고 있다."
            ),
            options=("우분투", "록키", "CentOS"),
            due="2026-09-12",
        ),
        thread(
            "t2",
            "DB 결정",
            "decided",
            "u3",
            "2026-09-08T00:35:00Z",
            description=(
                "개발 환경 설정 작업의 DB 선택. 기존 솔루션과의 호환성과 비용을 같이 봐야 한다."
            ),
            options=("PostgreSQL", "MySQL", "Supabase"),
            due="2026-09-15",
        ),
        thread(
            "t3",
            "사내망에서 외부 모델 호출 허용 범위",
            "open",
            "u1",
            "2026-09-09T02:10:00Z",
            description=(
                "가상비서가 외부 LLM API를 불러야 하는데 "
                "사내망 보안 정책상 어디까지 허용되는지 정해지지 않았다."
            ),
            options=("전면 허용", "비식별 데이터만 허용", "사내 모델만 사용"),
            due="2026-09-30",
        ),
        thread("t4", "개발 서버 백업 주기", "queued", None, "2026-09-10T06:20:00Z"),
        # 시나리오 2 — 두 번 미뤄진 안건
        thread(
            "t5",
            "보험료 산출 기간계 API 호출 in · out 정의",
            "open",
            "u4",
            "2026-09-07T00:10:00Z",
            description=(
                "보험료 산출 기간계 API 개발 중 호출에 필요한 in · out 정의가 없어 개발이 멈췄다. "
                "기간계 업무 정의가 먼저 나와야 한다."
            ),
            due="2026-10-19",
        ),
        # 시나리오 3 — 회의만으로 끝난 안건
        thread(
            "t6",
            "일정 조율 — 전체 일정을 미룰지, 테스트 기간을 줄일지",
            "decided",
            "u1",
            "2026-09-14T01:00:00Z",
        ),
        thread("t7", "가상비서 tool 만드는 순서", "queued", "u4", "2026-09-12T05:40:00Z"),
        thread("t8", "AI 심사 학습 데이터 범위", "queued", "u1", "2026-09-12T05:45:00Z"),
        thread("t9", "공통 코드 체계 확정", "queued", "u2", "2026-09-15T00:20:00Z"),
        # 다른 프로젝트 — 프로젝트를 바꾸면 화면이 갈리는지 보려고 둔다
        thread("t10", "이관 범위 확정", "queued", "u2", "2026-09-16T01:05:00Z", project="p2"),
    ]


def entry(
    id_: str,
    thread_id: str,
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
    # 화면은 이력 줄의 날짜를 createdAt 의 KST 날짜로 찍는다(예전에는 회의 날짜였다).
    # 회의에 붙어 있던 e2 · e3 · e4 · e5 · e6 은 KST 로 그 회의 날짜와 이미 같아 그대로 둔다
    return [
        # 시나리오 1 — 회의 밖 처리. 공유가 안 됐을 뿐 이미 정해져 있던 것
        entry(
            "e1",
            "t1",
            "decide",
            "우분투 최신 버전으로 한다",
            [],
            "PM 에게 전달받아 이도현이 정리했다. 회의로 다루지 않았다.",
            "u3",
            "2026-09-09T02:00:00Z",
        ),
        # 시나리오 2 — 첫 번째 미룸
        entry(
            "e2",
            "t5",
            "defer",
            "이번 회의에서는 정하지 못했다",
            [],
            "기간계 업무 정의가 안 돼 in · out 을 정할 수 없다. 다음 주 월요일에 다시 본다.",
            "u4",
            "2026-09-07T07:30:00Z",
        ),
        # 시나리오 1 — 회의에서 정한 것
        entry(
            "e3",
            "t2",
            "decide",
            "mysql 을 쓴다",
            [
                "postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺀다",
                "supabase 는 비용 때문에 뺀다",
            ],
            "",
            "u3",
            "2026-09-10T06:05:00Z",
        ),
        entry(
            "e4",
            "t3",
            "defer",
            "이번 회의에서는 정하지 못했다",
            [],
            "정보보안팀 확인이 먼저다. 다음 회의 후보로 올려 둔다.",
            "u1",
            "2026-09-10T06:08:00Z",
        ),
        # 시나리오 2 — 두 번째 미룸
        entry(
            "e5",
            "t5",
            "defer",
            "여전히 업무 정의가 없어 또 미룬다",
            [],
            "두 번째 미룸이다. 다음에는 기간계 담당자를 회의에 부르기로 했다.",
            "u4",
            "2026-09-14T07:10:00Z",
        ),
        # 시나리오 3
        entry(
            "e6",
            "t6",
            "decide",
            "전체 일정은 그대로 두고 테스트 기간만 2주 줄인다",
            ["늘어난 개발 기간은 그대로 둔다", "통합 테스트를 3주에서 1주로 줄인다"],
            "일정을 미루면 오픈 일정이 밀린다는 데에 이견이 없었다.",
            "u1",
            "2026-09-15T07:00:00Z",
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
        part_id=TASK_PARTS.get(id_),
        created_at=at("2026-09-04T00:20:00Z"),
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
        # 결정 병목 리스크 — DB 는 이미 정해졌는데(t2) 막힘을 안 풀어 둔 작업(decidedButBlocked)
        task("k22", "HW-22", "스테이징 DB 구성", "k4", "blocked", "u3", "2026-10-13", "2026-10-20"),
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
# 픽스처의 링크는 전부 한화손보 차세대(p1) 안에서 선다
TASK_THREAD_LINKS = [
    ("k4", "t1"),  # 개발 환경 설정 ↔ 서버 OS 결정
    ("k4", "t2"),  # 개발 환경 설정 ↔ DB 결정
    ("k18", "t5"),  # 기간계 API ↔ in · out 정의
    ("k13", "t8"),  # 모델링 ↔ 학습 데이터 범위
    ("k3", "t9"),  # 프로그램 설계 ↔ 공통 코드 체계
    ("k22", "t2"),  # 스테이징 DB 구성 ↔ DB 결정 — 정해졌는데 막힘
]


# 선행 작업 (뒤 작업, 선행 작업) — docs/api/task-flow.md '시드 · 목업'
TASK_DEPENDENCIES = [
    ("k20", "k19"),  # 서버가 있어야 DB 를 설치한다
    ("k21", "k20"),  # DB 가 떠야 계정을 만든다
    ("k22", "k20"),  # 개발 DB 구성을 본떠 스테이징을 만든다
]
# 지어 둔 사람 — 개발 환경 설정(k4) 담당
DEPENDENCY_BY = "u3"

# 리포트 시연용으로 오래 둔 상태 — (작업, 앞 상태, 지금 상태, 바뀐 시각)
DEMO_STATUS_CHANGES = [
    # 계획은 09-10 ~ 09-12 사흘 — 리포트의 '오래 걸림'
    ("k20", "todo", "doing", "2026-10-08T00:00:00Z"),
    ("k22", "todo", "blocked", "2026-10-13T00:00:00Z"),
]


def dependencies() -> list[TaskDependency]:
    return [
        TaskDependency(
            task_id=task_id,
            depends_on_id=depends_on_id,
            project_id="p1",
            created_by=DEPENDENCY_BY,
            created_at=at("2026-09-04T00:30:00Z"),
        )
        for task_id, depends_on_id in TASK_DEPENDENCIES
    ]


def demo_log(task: Task, from_status: str, to_status: str, changed_at: str) -> TaskLog:
    return TaskLog(
        project_id=task.project_id,
        task_id=task.id,
        from_status=from_status,
        to_status=to_status,
        changed_by=task.owner_id,
        changed_at=at(changed_at),
        backfilled=False,
    )


def task_logs() -> list[TaskLog]:
    """작업마다 등록 → 지금 상태. 시연용 둘은 등록(todo) 줄 뒤에 오래된 바뀜을 하나 더 둔다.

    그 밖은 작업의 start(없으면 등록 시각)에 지금 상태로 한 줄. 시드는 backfill 이 아니다.
    """
    demo = {row[0]: row for row in DEMO_STATUS_CHANGES}
    rows: list[TaskLog] = []
    for task in tasks():
        if task.id in demo:
            _, before, after, changed_at = demo[task.id]
            rows.append(
                TaskLog(
                    project_id=task.project_id,
                    task_id=task.id,
                    from_status=None,
                    to_status=before,
                    changed_by=task.owner_id,
                    changed_at=task.created_at,
                    backfilled=False,
                )
            )
            rows.append(demo_log(task, before, after, changed_at))
            continue
        since = at(f"{task.start.isoformat()}T00:00:00Z") if task.start else task.created_at
        rows.append(
            TaskLog(
                project_id=task.project_id,
                task_id=task.id,
                from_status=None,
                to_status=task.status,
                changed_by=task.owner_id,
                changed_at=since,
                backfilled=False,
            )
        )
    return rows


def comments() -> list[TaskComment]:
    """`fixtures/comments.ts` — 작업마다 오래된 것부터."""
    rows = [
        (
            "cm1",
            "k4",
            "u1",
            "방화벽 신청서는 제가 올려 두었습니다.\n승인까지 이틀 정도 걸린다고 합니다.",
            "2026-09-09T01:12:00Z",
            None,
        ),
        (
            "cm2",
            "k4",
            "u3",
            "확인했습니다. 승인 나면 계정 네 개 바로 만들겠습니다.",
            "2026-09-09T02:40:00Z",
            "2026-09-09T02:45:00Z",
        ),
        (
            "cm3",
            "k18",
            "u4",
            "in · out 정의 안건이 정해져야 시작할 수 있습니다.",
            "2026-09-15T05:00:00Z",
            None,
        ),
    ]
    return [
        TaskComment(
            id=id_,
            task_id=task_id,
            author_id=author_id,
            body=body,
            created_at=at(created),
            edited_at=at(edited) if edited else None,
        )
        for id_, task_id, author_id, body, created, edited in rows
    ]


# 확인 요청 — docs/api/check.md '시드 · 목업' 표 그대로. 프론트 목업이 같은 id 를 쓴다.
# (id, 안건, 결정, 보낸, 받는, createdAt, confirmedAt).
# c1 ~ c3 은 t2 의 결정 e3 으로 한 번에 보낸 것이다
CHECKS = [
    ("c1", "t2", "e3", "u1", "u3", "2026-10-14T01:00:00Z", None),
    ("c2", "t2", "e3", "u1", "u2", "2026-10-14T01:00:00Z", "2026-10-14T05:00:00Z"),
    ("c3", "t2", "e3", "u1", "u4", "2026-10-14T01:00:00Z", None),
    ("c4", "t1", "e1", "u3", "u1", "2026-10-15T00:30:00Z", None),
]


async def checks(session: AsyncSession) -> list[CheckRequest]:
    """부하는 목업에 없다 — 넣는 그 시각의 작업 · 안건으로 센다. 작업 · 안건을 먼저 넣는다."""
    loads = await recipient_loads(
        session, "p1", sorted({row[4] for row in CHECKS}), today=today_kst()
    )
    return [
        CheckRequest(
            id=id_,
            project_id="p1",
            thread_id=thread_id,
            entry_id=entry_id,
            sender_id=sender,
            recipient_id=recipient,
            created_at=at(created),
            confirmed_at=at(confirmed) if confirmed else None,
            load_open_tasks=loads[recipient].open_tasks,
            load_blocked_tasks=loads[recipient].blocked_tasks,
            load_due_soon_tasks=loads[recipient].due_soon_tasks,
            load_open_threads=loads[recipient].open_threads,
        )
        for id_, thread_id, entry_id, sender, recipient, created, confirmed in CHECKS
    ]


# 회의록 — docs/api/minutes.md '시드 · 목업'. 본문은 화면의 예시 회의록
# (`web/src/fixtures/minutes.ts` 의 MINUTES_EXAMPLE) 글자 그대로다. 출처를 단 줄은 없다.
# 줄 끝의 `\` 는 긴 줄을 코드에서만 나눈 것이다 — 글에는 줄바꿈이 없다(test_seed 가 대조한다)
MINUTES_EXAMPLE = """\
[한화손보 차세대] 주간 회의록

일시: 2026년 10월 16일(금) 14:00 ~ 15:00
장소: 본사 7층 소회의실
참석: 김서연, 박지훈, 이도현, 정하늘 / 기간계팀 최 선임(일부 참석)
작성: 정하늘

1. 지난 회의 후속
- 개발 서버 우분투 설치, 개발자 계정 배포 끝남(이도현).

2. 사내망 외부 모델 호출 허용 범위
- 정보보안팀 회신이 아직 없어 이번 회의에서도 정하지 못함.
- 다음 주 수요일 보안 검토 회의 결과를 보고 다시 논의하기로 함(담당 김서연).

3. 운영 DB 구성
- MySQL 로 정한 대로 운영 DB 도 같은 버전으로 구성.
- 계정 · 권한은 이도현 님이 10월 21일까지 표로 만들어 공유하기로 함.

4. 가상비서 대화 로그 보관 기간
- 대화 로그에 고객 개인정보가 섞일 수 있어 보관 기간을 정해야 한다는 의견.
- 후보는 30일 / 90일 / 1년. 법무 검토 의견을 받아 10월 30일까지 정하기로 함. 담당은 정하늘 님.
- 정하늘 님이 다음 주 목요일까지 지금 쌓이고 있는 대화 로그 현황을 조사해 오기로 함.

5. 기간계 테스트 데이터 마스킹
- 통합 테스트에 쓸 기간계 데이터를 어디까지 가릴지 논의. \
전 항목 마스킹 vs 주민번호 · 연락처만 마스킹.
- 기간계팀 마스킹 기준 문서를 받은 뒤 다시 보기로 하고 이번에는 보류. \
문서는 박지훈 님이 기간계팀에 요청해 둠.

6. 기타
- 통합 테스트 시나리오 초안은 최 선임이 10월 28일까지 공유해 주기로 함.

다음 회의: 2026년 10월 23일(금) 14:00
"""


def minutes() -> list[Minutes]:
    # 회의(14:00 ~ 15:00 KST)가 끝나고 적은 것으로 둔다
    written = at("2026-10-16T06:30:00Z")
    return [
        Minutes(
            id="m1",
            project_id="p1",
            title="10월 셋째 주 주간 회의",
            meeting_date=d("2026-10-16"),
            body=MINUTES_EXAMPLE,
            summary="",
            author_id="u1",
            created_at=written,
            updated_at=written,
        )
    ]


# 테스트 — docs/api/test.md '시드 · 목업' 표. 값은 `web/src/fixtures/tests.ts` 그대로다.
# 오늘을 2026-10-15 로 두면 표의 신호가 나온다.
# 담당 = 바꾼 사람 = 만든 사람, 바뀐 시각은 그날 12:00 KST.
# 태그 — T2 ↔ 작업 k4(t1 · t2 에 걸려 있다), T3 ↔ 안건 t3, T4 ↔ 안건 t2, T6 ↔ 작업 k21.
# basis_seq 는 서버 규칙(닿는 안건의 Entry seq 최댓값)이다 — T4 만 결정 e3(seq 3) 앞인 2 로 둬서
# '기준 바뀜' 이 난다. 시드에 change 줄이 없어 decide 줄로 대신한다(목업과 같다)
TEST_CREATED = "2026-09-30T01:00:00Z"


def noon(day: str) -> str:
    return f"{day}T03:00:00Z"


@dataclass
class SeedTest:
    title: str
    owner: str
    status: str
    changed_at: str = TEST_CREATED
    parent: str | None = None
    purpose: str = ""
    precondition: str = ""
    test_data: str = ""
    steps: list[tuple[str, str]] = field(default_factory=list)
    refs: list[tuple[str, str]] = field(default_factory=list)
    failed_step: int | None = None
    note: str = ""
    level: str | None = "functional"
    start: str | None = None
    due: str | None = None
    part: str | None = None
    basis: int | None = None


SEED_TESTS: list[SeedTest] = [
    SeedTest(
        "로그인 시나리오",
        "u2",
        "draft",
        level="acceptance",
        purpose="사내 계정으로 들어오는 길을 처음부터 끝까지 따라간다.",
    ),
    SeedTest(
        "올바른 계정으로 로그인",
        "u2",
        "pass",
        noon("2026-10-10"),
        parent="tc1",
        start="2026-10-08",
        due="2026-10-10",
        purpose="발급받은 계정으로 들어갈 수 있는지 본다.",
        precondition="개발 서버가 떠 있고 계정이 발급돼 있다.",
        test_data="dev01 / 발급 메일의 임시 비밀번호",
        steps=[
            ("로그인 화면을 연다", ""),
            ("dev01 과 임시 비밀번호를 넣고 [로그인]", "대시보드가 열리고 이름이 보인다"),
        ],
        refs=[("task", "k4")],
        # k4 로 닿는 t1 · t2 의 최댓값 e3
        basis=3,
    ),
    SeedTest(
        "비밀번호 5회 틀림 잠금",
        "u2",
        "testing",
        noon("2026-10-03"),
        parent="tc1",
        start="2026-10-06",
        due="2026-10-08",
        purpose="비밀번호를 거푸 틀리면 계정이 잠기는지 본다.",
        steps=[
            ("틀린 비밀번호로 네 번 로그인한다", "매번 남은 횟수가 보인다"),
            ("다섯 번째로 틀린다", "계정이 잠겼다는 안내가 뜬다"),
        ],
        refs=[("thread", "t3")],
        # t3 에는 미룸 e4 뿐이다
        basis=4,
    ),
    SeedTest(
        "비밀번호 변경 주기",
        "u4",
        "ready",
        noon("2026-10-01"),
        parent="tc1",
        start="2026-10-13",
        due="2026-10-17",
        purpose="정해 둔 주기가 지난 계정은 비밀번호를 바꾸게 하는지 본다.",
        steps=[("주기가 지난 계정으로 로그인한다", "비밀번호 바꾸기 화면으로 간다")],
        refs=[("thread", "t2")],
        # 테스트를 쓸 때 본 기준 뒤로 t2 에 결정 e3(seq 3) 이 생겼다
        basis=2,
    ),
    SeedTest(
        "계정 배포 시나리오",
        "u3",
        "draft",
        level="integration",
        part="pt1",
        purpose="개발자 계정을 만들어 나눠 주고 권한을 거르는 흐름.",
    ),
    SeedTest(
        "개발자 계정 일괄 생성",
        "u3",
        "blocked",
        noon("2026-10-02"),
        parent="tc5",
        note="DB 설치(HW-20)가 안 끝나 계정을 만들 DB 가 없다.",
        level="integration",
        part="pt1",
        steps=[
            ("계정 목록 파일을 올린다", ""),
            ("[한 번에 만들기]", "네 계정이 모두 만들어지고 메일이 나간다"),
        ],
        refs=[("task", "k21")],
    ),
    SeedTest(
        "권한 없는 계정 접근 차단",
        "u1",
        "fail",
        noon("2026-10-05"),
        parent="tc5",
        failed_step=2,
        note="관리 화면 주소를 직접 치면 열린다.",
        start="2026-10-14",
        due="2026-10-20",
        part="pt1",
        steps=[
            ("일반 계정으로 로그인한다", ""),
            ("관리 화면 주소를 직접 연다", "권한이 없다는 화면이 뜬다"),
        ],
    ),
    SeedTest(
        "계정 목록 내려받기",
        "u4",
        "testing",
        noon("2026-10-14"),
        parent="tc5",
        level=None,
        part="pt1",
        steps=[("[계정 목록 내려받기]", "모든 계정이 담긴 CSV 가 받아진다")],
    ),
]


def test_cases() -> list[TestCase]:
    """HW-T1 ~ T8, id 는 tc1 ~ tc8. 상위가 늘 앞에 있다."""
    return [
        TestCase(
            id=f"tc{no}",
            project_id="p1",
            key=f"HW-T{no}",
            title=row.title,
            purpose=row.purpose,
            precondition=row.precondition,
            test_data=row.test_data,
            parent_id=row.parent,
            status=row.status,
            status_changed_at=at(row.changed_at),
            status_changed_by=row.owner,
            failed_step=row.failed_step,
            result_note=row.note,
            level=row.level,
            start=d(row.start),
            due=d(row.due),
            owner_id=row.owner,
            part_id=row.part,
            basis_seq=row.basis,
            created_by=row.owner,
            created_at=at(TEST_CREATED),
            steps=[
                TestStep(id=f"tc{no}s{i}", sort_order=i, action=action, expected=expected)
                for i, (action, expected) in enumerate(row.steps)
            ],
        )
        for no, row in enumerate(SEED_TESTS, start=1)
    ]


def test_refs() -> list[TestRef]:
    return [
        TestRef(
            id=f"tc{no}r{i}",
            test_id=f"tc{no}",
            project_id="p1",
            task_id=target if kind == "task" else None,
            thread_id=target if kind == "thread" else None,
        )
        for no, row in enumerate(SEED_TESTS, start=1)
        for i, (kind, target) in enumerate(row.refs)
    ]


async def clear(session: AsyncSession) -> None:
    """자식부터 지운다. FK 가 CASCADE 라도 순서를 눈에 보이게 둔다."""
    for model in (
        TestRef,
        TestStep,
        TestCase,
        ProjectReport,
        CheckRequest,
        RiskSetting,
        TaskComment,
        TaskThreadLink,
        TaskDependency,
        TaskLog,
        TaskLine,
        Task,
        EntryDetail,
        Entry,
        ThreadOption,
        ThreadCc,
        Thread,
        Minutes,
        PartMember,
        Part,
        AuthSession,
        AuthIdentity,
        ProjectMember,
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
    for table in (
        "thread",
        "entry",
        "task",
        "task_comment",
        "check_request",
        "minutes",
        "task_log",
        "test_case",
    ):
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
    session.add_all(identities())
    session.add_all(grants())
    session.add_all(parts())
    await session.flush()
    session.add_all(part_members())
    session.add_all(in_order(threads()))
    await session.flush()
    session.add_all(in_order(entries()))
    session.add_all(in_order(tasks()))
    await session.flush()
    session.add_all(in_order(comments()))
    session.add_all(in_order(task_logs()))
    session.add_all(dependencies())
    await session.flush()
    session.add_all(in_order(await checks(session)))
    session.add_all(in_order(minutes()))
    await session.flush()
    session.add_all(
        [TaskThreadLink(task_id=t, thread_id=h, project_id="p1") for t, h in TASK_THREAD_LINKS]
    )
    # 상위가 먼저 들어가야 복합 FK 가 선다 — 한 줄씩 넣는다
    for row in in_order(test_cases()):
        session.add(row)
        await session.flush()
    session.add_all(test_refs())
    await session.flush()
    await advance_identity(session)
    await session.commit()


async def run() -> None:
    async with session_factory() as session:
        await seed(session)

    counts = {
        "project": len(projects()),
        "member": len(members()),
        "grant": len(grants()),
        "part": len(PARTS),
        "thread": len(threads()),
        "entry": len(entries()),
        "task": len(tasks()),
        "comment": len(comments()),
        "link": len(TASK_THREAD_LINKS),
        "dependency": len(TASK_DEPENDENCIES),
        "task_log": len(task_logs()),
        "check": len(CHECKS),
        "minutes": len(minutes()),
        "test": len(SEED_TESTS),
    }
    print("시드 완료 — " + " · ".join(f"{k} {v}" for k, v in counts.items()))
    print(f"개발용 로그인 — {DEV_ADMIN_EMAIL} · u1~u4@innoflow.local / 비밀번호 {DEV_PASSWORD}")
    await engine.dispose()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
