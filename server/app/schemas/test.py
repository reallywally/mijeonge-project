from datetime import date
from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from app.schemas.base import Schema, Utc

TestStatus = Literal["draft", "ready", "testing", "pass", "fail", "blocked"]
# 순서가 곧 signals 배열의 순서다 (계약의 신호 표)
TestSignal = Literal[
    "longRunning", "overdue", "notStarted", "longBlocked", "failedIdle", "basisChanged"
]
TestRefKind = Literal["task", "thread"]

TEXT_MAX = 4000
STEPS_MAX = 50
REFS_MAX = 20

TestTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
TestText = Annotated[str, StringConstraints(max_length=TEXT_MAX)]


class TestStepOut(Schema):
    action: str
    expected: str


class TestStepIn(Schema):
    # 앞뒤 공백을 떼고 비면 422 — `steps.2.action` 으로 짚는다
    action: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=TEXT_MAX)
    ]
    expected: TestText = ""


class TestRefOut(Schema):
    kind: TestRefKind
    id: str


class TestRefIn(Schema):
    kind: TestRefKind
    id: str


TestSteps = Annotated[list[TestStepIn], Field(max_length=STEPS_MAX)]


class TestCaseOut(Schema):
    id: str
    project_id: str
    key: str
    title: str
    parent_id: str | None
    purpose: str
    precondition: str
    test_data: str
    steps: list[TestStepOut]
    refs: list[TestRefOut]
    status: str
    status_changed_at: Utc
    status_changed_by: str | None
    # 서버가 센다 — 오늘(KST) − 상태가 바뀐 날(KST)
    status_days: int
    failed_step: int | None
    result_note: str
    start: date | None
    due: date | None
    owner_id: str | None
    part_id: str | None
    signals: list[TestSignal]
    changed_entry_ids: list[str]
    created_by: str | None
    created_at: Utc


class TestCreate(Schema):
    """`TestInput`. status 는 받지 않는다 — 늘 draft 로 들어간다."""

    title: TestTitle
    parent_id: str | None = None
    purpose: TestText = ""
    precondition: TestText = ""
    test_data: TestText = ""
    steps: TestSteps = []
    # 개수(20) 는 400 `TEST_REF_LIMIT` 이라 서비스가 본다
    refs: list[TestRefIn] = []
    start: date | None = None
    due: date | None = None
    owner_id: str | None = None
    # 안 보내면 상위 테스트의 파트를 따른다 — `model_fields_set` 으로 가른다
    part_id: str | None = None


class TestPatch(Schema):
    """보낸 키만 바꾼다 — `exclude_unset` 으로 읽는다.

    null 을 못 받는 칸(title · 글 칸 · steps)은 타입을 좁혀 두고 기본값만 '안 보냄' 표시로 둔다 —
    기본값은 검사하지 않으니 null 을 보내면 422 다.
    """

    title: TestTitle = ""
    parent_id: str | None = None
    purpose: TestText = ""
    precondition: TestText = ""
    test_data: TestText = ""
    steps: TestSteps = []
    start: date | None = None
    due: date | None = None
    owner_id: str | None = None
    part_id: str | None = None


class TestStatusInput(Schema):
    status: TestStatus
    # fail 일 때만 쓴다. 범위(1 ~ 단계 수)는 서비스가 본다
    failed_step: int | None = None
    # fail · blocked 면 필수. 그 밖엔 버린다
    note: TestText = ""
