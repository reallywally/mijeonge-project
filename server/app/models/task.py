from datetime import date, datetime

from sqlalchemy import (
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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, new_id, trgm_index

TASK_STATUSES = ("todo", "doing", "blocked", "done")
TASK_PRIORITIES = ("low", "normal", "high")
TASK_LINE_KINDS = ("check", "bullet")


class Task(Base):
    """계층으로 쌓인다. start · due 가 둘 다 null 이면 기간 미정(간트에 막대가 없다)."""

    __tablename__ = "task"
    __table_args__ = (
        CheckConstraint(f"status in {TASK_STATUSES}", name="status"),
        CheckConstraint(f"priority in {TASK_PRIORITIES}", name="priority"),
        # 자기 자신을 부모로 두는 것만 DB 가 막는다. 더 긴 고리는 서비스가 막는다
        CheckConstraint("parent_id is null or parent_id <> id", name="parent_not_self"),
        UniqueConstraint("project_id", "key"),
        # 부모는 같은 프로젝트여야 한다 (API.md Q16) — 복합 FK 가 참조할 유니크가 필요하다.
        # 넘어가면 화면에 에러가 안 뜨고 계층만 조용히 틀어진다
        UniqueConstraint("id", "project_id"),
        ForeignKeyConstraint(["parent_id", "project_id"], ["task.id", "task.project_id"]),
        # 파트도 같은 프로젝트의 것만 단다 (docs/api/part.md)
        ForeignKeyConstraint(["part_id", "project_id"], ["part.id", "part.project_id"]),
        Index("ix_task_project_id_status", "project_id", "status"),
        Index("ix_task_parent_id", "parent_id"),
        trgm_index("task", "title"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    # 화면에 보이는 번호 — HW-4
    key: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(Text)
    # FK 는 위의 복합 FK 하나뿐이다 — 부모 id 만으로는 프로젝트를 못 지킨다
    parent_id: Mapped[str | None] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(16), default="todo")
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    start: Mapped[date | None] = mapped_column(Date)
    due: Mapped[date | None] = mapped_column(Date)
    priority: Mapped[str] = mapped_column(String(16), default="normal")
    # null 이면 프로젝트 공통. 계층과 떼어 둔다 — 상위의 파트를 바꿔도 하위는 그대로다
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
    뒤 작업을 시작 · 완료할 수 있다. 상하위 · 순환은 서비스가 막는다.
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
