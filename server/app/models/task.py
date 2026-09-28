from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, new_id

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
        Index("ix_task_project_id_status", "project_id", "status"),
        Index("ix_task_parent_id", "parent_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    # 화면에 보이는 번호 — HW-4
    key: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(Text)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("task.id"))
    status: Mapped[str] = mapped_column(String(16), default="todo")
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    start: Mapped[date | None] = mapped_column(Date)
    due: Mapped[date | None] = mapped_column(Date)
    priority: Mapped[str] = mapped_column(String(16), default="normal")
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
    __table_args__ = (CheckConstraint(f"kind in {TASK_LINE_KINDS}", name="kind"),)

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
    """작업 ↔ 안건. 양쪽에서 읽는다 — '안건 상세에서 맵핑 불가'는 화면 규칙이다."""

    __tablename__ = "task_thread_link"

    task_id: Mapped[str] = mapped_column(
        ForeignKey("task.id", ondelete="CASCADE"), primary_key=True
    )
    thread_id: Mapped[str] = mapped_column(
        ForeignKey("thread.id", ondelete="CASCADE"), primary_key=True
    )


class MeetingTaskLink(Base):
    __tablename__ = "meeting_task_link"

    meeting_id: Mapped[str] = mapped_column(
        ForeignKey("meeting.id", ondelete="CASCADE"), primary_key=True
    )
    task_id: Mapped[str] = mapped_column(
        ForeignKey("task.id", ondelete="CASCADE"), primary_key=True
    )
