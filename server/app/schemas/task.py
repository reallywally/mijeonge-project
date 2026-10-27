from datetime import date
from typing import Annotated, Literal

from pydantic import AfterValidator, StringConstraints
from pydantic_core import PydanticCustomError

from app.schemas.base import Schema, Utc

# 입력에서만 좁힌다 — 화면이 보낸 값이 셋 넷 중 하나인지 경계에서 걸러야 400 이 아니라 422 로 나간다
TaskStatusIn = Literal["todo", "doing", "blocked", "done"]
TaskPriorityIn = Literal["low", "normal", "high"]
TaskLineKindIn = Literal["check", "bullet"]
# 한 작업이 걸 수 있는 연관 작업 수 — 중복을 뺀 뒤 센다 (Q61)
RELATED_MAX = 20


def _unique_related(ids: list[str]) -> list[str]:
    """중복은 한 번으로 친다(처음 나온 순서). 뺀 뒤에도 넘치면 422 `relatedIds`."""
    unique = list(dict.fromkeys(ids))
    if len(unique) > RELATED_MAX:
        raise PydanticCustomError("too_long", f"연관 작업은 {RELATED_MAX}개까지입니다.")
    return unique


RelatedIds = Annotated[list[str], AfterValidator(_unique_related)]


class TaskLineOut(Schema):
    id: str
    kind: str
    text: str
    done: bool
    level: int


class TaskOut(Schema):
    id: str
    project_id: str
    key: str
    title: str
    # 이 작업이 건 연관 작업 — 건 순서(created_at → related_id). 한 방향이다 (Q61)
    related_ids: list[str]
    body: list[TaskLineOut]
    status: str
    owner_id: str | None
    # 둘 다 null 이면 기간 미정이다
    start: date | None
    due: date | None
    priority: str
    # null 이면 프로젝트 공통 (docs/api/part.md)
    part_id: str | None
    created_at: Utc
    # 댓글 본문은 안 싣는다 — 목록 · 칸반이 개수만 찍고, 본문은 상세가 따로 받는다
    comment_count: int
    # AI 정리로 등록한 회의록. 손으로 만든 것은 null (docs/api/minutes.md)
    minutes_id: str | None = None
    # 지금 상태가 된 시각 — task_log 의 마지막 줄. 모든 작업에 줄이 있어 null 이 아니다
    status_changed_at: Utc
    # 그 줄이 마이그레이션의 backfill 이면 true — 실제로는 더 오래됐을 수 있다 (task-flow.md)
    status_since_backfill: bool


class TaskLineIn(Schema):
    """본문 한 줄. 등록(POST)에서는 id 를 받지 않는다 — 서버가 새로 붙인다.
    수정(PATCH)은 id 를 실을 수 있는 `TaskLinePatchIn` 을 쓴다."""

    kind: TaskLineKindIn
    text: str
    done: bool = False
    level: int = 0


class TaskLinePatchIn(TaskLineIn):
    """본문 교체용 한 줄. 이 작업의 기존 줄 id 면 유지한다 — 저장 응답으로 id 가 바뀌면
    편집 중인 화면의 포커스와 키가 흔들린다. 없거나 모르는 id 면 서버가 새로 붙인다."""

    id: str | None = None


class TaskCreate(Schema):
    """`domain.ts` 의 TaskInput. key 는 서버가 발번한다. 연관 작업은 등록 뒤 상세에서 건다 (Q61)."""

    title: str
    body: list[TaskLineIn] = []
    status: TaskStatusIn = "todo"
    owner_id: str | None = None
    start: date | None = None
    due: date | None = None
    priority: TaskPriorityIn = "normal"
    thread_ids: list[str] = []
    # 안 보내거나 null 이면 공통 (Q61 — 상위를 따르는 규칙은 없어졌다)
    part_id: str | None = None


class TaskPatch(Schema):
    """부분 수정. 안 보낸 것과 null 로 보낸 것을 가르려고 `exclude_unset` 으로 읽는다 —
    `{"ownerId": null}`(담당자 지우기)이 무시되면 화면이 조용히 안 먹는다."""

    title: str | None = None
    # 보내면 통째로 갈아끼운다(exclude_unset 으로 가른다). null 은 422 — 빈 값은 [] 다
    related_ids: RelatedIds = []
    status: TaskStatusIn | None = None
    owner_id: str | None = None
    # 한쪽만 채우는 것도 받는다. '둘 다 있을 때만'은 간트 화면의 규칙이지 모델의 제약이 아니다
    start: date | None = None
    due: date | None = None
    priority: TaskPriorityIn | None = None
    # null 로 보내면 공통
    part_id: str | None = None
    # 보내면 본문을 통째로 갈아끼운다. 기본값은 '안 보냄' 표시일 뿐이고(exclude_unset 으로 가른다),
    # 본문의 빈 값은 [] 라 null 은 타입에서 422 로 걸린다 (API.md '빈 값은 null 이 아니다')
    body: list[TaskLinePatchIn] = []


# 초안 하나에 담을 수 있는 작업 수 (API.md '작업 초안')
PROPOSAL_MAX = 20


class ProposedTask(Schema):
    """챗봇 초안의 한 줄 — `domain.ts` 의 ProposedTask. 일괄 등록도 이것을 그대로 받는다.

    검사 규칙(개수 · tempId · 빈 제목 · 기간)은 여기 두지 않는다 — 몇 번째의 어느 칸인지
    `tasks.1.title` 로 짚어야 해서 `services/task.py` 의 `proposal_problems` 가 본다.
    초안은 평평하다 — 초안 안끼리의 묶음은 없다 (Q61)."""

    temp_id: str
    # 이미 있는 작업과 관련된 초안이면 그 작업 id — 등록하면 새 작업이 그 작업을 연관으로 건다
    related_id: str | None = None
    title: str
    owner_id: str | None = None
    start: date | None = None
    due: date | None = None
    priority: TaskPriorityIn = "normal"


class BatchTaskIn(ProposedTask):
    """일괄 등록의 한 줄 — 초안에 `partId` 를 더한 것. 초안(`ProposedTask`) 자체에는 두지 않는다 —
    챗봇이 내는 모양(`proposal` 이벤트)이 그대로 남게. 안 보내면 공통이다."""

    part_id: str | None = None


class TaskBatchInput(Schema):
    tasks: list[BatchTaskIn]


class TaskBatchResult(Schema):
    # 요청 순서 그대로
    tasks: list[TaskOut]
    task_id_by_temp_id: dict[str, str]


class TaskLinePatch(Schema):
    done: bool


class TaskThreadLinkOut(Schema):
    task_id: str
    thread_id: str


class TaskDependencyOut(Schema):
    # 뒤 작업
    task_id: str
    # 먼저 끝나야 하는 작업
    depends_on_id: str


class DependencySuggestionOut(Schema):
    task_id: str
    depends_on_id: str
    # 왜 — 한 문장
    reason: str


class DependencySuggestionsOut(Schema):
    suggestions: list[DependencySuggestionOut]
    # 완료 아닌 작업이 많아 앞에서 잘랐으면 true
    truncated: bool


# 앞뒤 공백을 떼고 비면 422 다(string_too_short)
CommentBody = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class TaskCommentOut(Schema):
    id: str
    task_id: str
    author_id: str | None
    body: str
    created_at: Utc
    # 한 번도 안 고쳤으면 null
    edited_at: Utc | None


class TaskCommentCreate(Schema):
    # 작성자는 로그인한 사람이다 — authorId 를 실어 와도 받지 않는다(모르는 키는 버린다)
    body: CommentBody


class TaskCommentPatch(Schema):
    body: CommentBody
