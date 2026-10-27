from datetime import date, datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, new_id, trgm_index

TASK_STATUSES = ("todo", "doing", "blocked", "done")
TASK_PRIORITIES = ("low", "normal", "high")
TASK_LINE_KINDS = ("check", "bullet")
# 변경 이력의 칸들 — Postgres 는 jsonb, 검사의 sqlite 는 JSON 으로 선다
HISTORY_CHANGES = JSON().with_variant(JSONB(), "postgresql")


class Task(Base):
    """평평하다 — 계층 대신 한 방향 연관 작업(`TaskRelation`)을 건다 (Q61).
    start · due 가 둘 다 null 이면 기간 미정(간트에 막대가 없다)."""

    __tablename__ = "task"
    __table_args__ = (
        CheckConstraint(f"status in {TASK_STATUSES}", name="status"),
        CheckConstraint(f"priority in {TASK_PRIORITIES}", name="priority"),
        UniqueConstraint("project_id", "key"),
        # 링크 · 선행 · 연관이 같은 프로젝트에서만 서게 복합 FK 가 참조할 유니크 (API.md Q13 · Q16)
        UniqueConstraint("id", "project_id"),
        # 파트도 같은 프로젝트의 것만 단다 (docs/api/part.md)
        ForeignKeyConstraint(["part_id", "project_id"], ["part.id", "part.project_id"]),
        Index("ix_task_project_id_status", "project_id", "status"),
        trgm_index("task", "title"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    # 화면에 보이는 번호 — HW-4
    key: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="todo")
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    start: Mapped[date | None] = mapped_column(Date)
    due: Mapped[date | None] = mapped_column(Date)
    priority: Mapped[str] = mapped_column(String(16), default="normal")
    # null 이면 프로젝트 공통 (docs/api/part.md)
    part_id: Mapped[str | None] = mapped_column(String(36))
    # AI 정리로 [등록] 했으면 그 회의록. 회의록을 지우면 비고 줄은 남는다 (docs/api/minutes.md)
    minutes_id: Mapped[str | None] = mapped_column(
        ForeignKey("minutes.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 등록 순서. 화면이 배열 순서를 그대로 쓴다(안건 목록 · 작업 목록에 정렬이 없다) —
    # created_at 은 날짜뿐이라 같은 날 여러 줄의 순서를 못 가린다
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)

    lines: Mapped[list["TaskLine"]] = relationship(
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="TaskLine.sort_order",
        lazy="selectin",
    )
    # 이 작업이 건 연관 작업 — 건 순서. 걸린 쪽에서는 안 보인다(한 방향, Q61)
    relations: Mapped[list["TaskRelation"]] = relationship(
        primaryjoin="Task.id == TaskRelation.task_id",
        foreign_keys="TaskRelation.task_id",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="(TaskRelation.created_at, TaskRelation.related_id)",
        lazy="selectin",
    )

    @property
    def related_ids(self) -> list[str]:
        return [relation.related_id for relation in self.relations]


class TaskLine(Base):
    """작업 본문 한 줄 — 체크박스 또는 불릿. 배열 순서가 곧 화면 순서다."""

    __tablename__ = "task_line"
    __table_args__ = (
        CheckConstraint(f"kind in {TASK_LINE_KINDS}", name="kind"),
        trgm_index("task_line", "text"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    task_id: Mapped[str] = mapped_column(ForeignKey("task.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(Text)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    # 들여쓰기 깊이
    level: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer)

    task: Mapped[Task] = relationship(back_populates="lines")


class TaskThreadLink(Base):
    """작업 ↔ 안건. 양쪽에서 읽는다 — '안건 상세에서 맵핑 불가'는 화면 규칙이다.

    **양쪽이 같은 프로젝트일 때만 선다** (API.md Q13). project_id 는 그것을 복합 FK 로
    못 박으려고 두는 열이고 JSON 에는 나가지 않는다.
    """

    __tablename__ = "task_thread_link"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "project_id"], ["task.id", "task.project_id"], ondelete="CASCADE"
        ),
        ForeignKeyConstraint(
            ["thread_id", "project_id"], ["thread.id", "thread.project_id"], ondelete="CASCADE"
        ),
    )

    task_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    thread_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36))


class TaskRelation(Base):
    """연관 작업 — `task_id` 가 `related_id` 를 건다. 한 방향이다 (Q61 · docs/api/task-flow.md).

    링크와 같이 같은 프로젝트 안에서만 선다 — 복합 FK 둘. 어느 쪽이 지워져도 줄이 같이 지워진다.
    """

    __tablename__ = "task_relation"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "project_id"], ["task.id", "task.project_id"], ondelete="CASCADE"
        ),
        ForeignKeyConstraint(
            ["related_id", "project_id"], ["task.id", "task.project_id"], ondelete="CASCADE"
        ),
        CheckConstraint("task_id <> related_id", name="not_self"),
        # '나를 건 작업'(챗봇 get_task 의 relatedBy) · cascade 가 걸린 쪽으로 줄을 찾는다
        Index("ix_task_relation_related_id", "related_id"),
        Index("ix_task_relation_project_id", "project_id"),
    )

    task_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    related_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class TaskComment(Base):
    """작업에 붙는 댓글. 작업을 지우면 같이 지워진다.

    작성자는 로그인한 사람이다. 인증 전에 남은 댓글은 작성자가 비어 있을 수 있다.
    """

    __tablename__ = "task_comment"
    __table_args__ = (Index("ix_task_comment_task_id_seq", "task_id", "seq"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    task_id: Mapped[str] = mapped_column(ForeignKey("task.id", ondelete="CASCADE"))
    # 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    author_id: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 한 번도 안 고쳤으면 null — 화면이 '수정됨' 을 이것으로 가른다
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 목록 순서. created_at 은 한 트랜잭션 안에서 같고 시계가 되감길 수 있다 (API.md Q15)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)


class TaskDependency(Base):
    """선행 작업 — `task_id` 를 하려면 `depends_on_id` 가 먼저 (docs/api/task-flow.md).

    링크와 같이 같은 프로젝트 안에서만 선다 — 복합 FK 둘. 막지 않는다: 선행이 안 끝나도
    뒤 작업을 시작 · 완료할 수 있다. 순환은 서비스가 막는다.
    """

    __tablename__ = "task_dependency"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "project_id"], ["task.id", "task.project_id"], ondelete="CASCADE"
        ),
        ForeignKeyConstraint(
            ["depends_on_id", "project_id"], ["task.id", "task.project_id"], ondelete="CASCADE"
        ),
        CheckConstraint("task_id <> depends_on_id", name="not_self"),
        # '이 작업을 기다리는 작업' · cascade 가 선행 쪽으로 줄을 찾는다
        Index("ix_task_dependency_depends_on_id", "depends_on_id"),
        Index("ix_task_dependency_project_id", "project_id"),
    )

    task_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    depends_on_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36))
    created_by: Mapped[str] = mapped_column(ForeignKey("member.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class TaskLog(Base):
    """작업 상태가 바뀐 한 줄. 지우지 않는다 — '진행 중이 된 지 며칠' 의 근거 (API.md Q50).

    마지막 줄(`seq` 가장 큰 것)이 지금 상태가 된 시각이다. `backfilled` 는 마이그레이션이
    지난 작업에 넣은 줄이라 '적어도 이때부터' 로 읽는다.
    """

    __tablename__ = "task_log"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "project_id"], ["task.id", "task.project_id"], ondelete="CASCADE"
        ),
        CheckConstraint(
            f"from_status is null or from_status in {TASK_STATUSES}", name="from_status"
        ),
        CheckConstraint(f"to_status in {TASK_STATUSES}", name="to_status"),
        Index("ix_task_log_task_id_seq", "task_id", "seq"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(String(36))
    task_id: Mapped[str] = mapped_column(String(36))
    # 만들 때 · backfill 은 null
    from_status: Mapped[str | None] = mapped_column(String(16))
    to_status: Mapped[str] = mapped_column(String(16))
    # backfill 은 누가 바꿨는지 모른다. 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    changed_by: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # changed_at 으로 세우지 않는다 — 한 트랜잭션 안에서 같고 시계가 되감길 수 있다 (Q15)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    backfilled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))


class TaskHistory(Base):
    """작업 변경 이력 한 줄 = 요청 하나 (docs/api/history.md · Q59). 화면에 보이기 위한 것이다.

    셈(N일째 · 리포트)은 `task_log` 가 한다 — 이것으로 세지 않는다. `changes` 는 계약의
    `HistoryChange[]` 를 camelCase 그대로 담는다. `backfilled` 는 마이그레이션이 지난 작업에
    넣은 '등록' 줄이라 바꾼 사람이 없다.
    """

    __tablename__ = "task_history"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "project_id"], ["task.id", "task.project_id"], ondelete="CASCADE"
        ),
        Index("ix_task_history_task_id_seq", "task_id", "seq"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(String(36))
    task_id: Mapped[str] = mapped_column(String(36))
    # backfill 은 누가 했는지 모른다. 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    changed_by: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # changed_at 으로 세우지 않는다 — 한 트랜잭션 안에서 같고 시계가 되감길 수 있다 (Q15)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    changes: Mapped[list[dict[str, object]]] = mapped_column(HISTORY_CHANGES)
    backfilled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
