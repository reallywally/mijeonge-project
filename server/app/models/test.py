from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
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
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, new_id

TEST_STATUSES = ("draft", "ready", "testing", "pass", "fail", "blocked")
TEST_LEVELS = ("functional", "integration", "acceptance")


class TestCase(Base):
    """기능 · 시나리오 테스트 하나 — 작업과 따로 둔다 (docs/api/test.md · Q55).

    상태 이력은 없다 — 마지막으로 바뀐 때 · 누가만 남는다 (Q54).
    """

    # 이름이 Test 로 시작해도 pytest 가 검사 클래스로 줍지 않게
    __test__ = False
    __tablename__ = "test_case"
    __table_args__ = (
        CheckConstraint(f"status in {TEST_STATUSES}", name="status"),
        CheckConstraint(f"level is null or level in {TEST_LEVELS}", name="level"),
        CheckConstraint("parent_id is null or parent_id <> id", name="parent_not_self"),
        # 서비스가 지키는 규칙의 안전망 — 실패 단계 · 메모가 다른 상태에 남지 않게
        CheckConstraint(
            "failed_step is null or (status = 'fail' and failed_step >= 1)", name="failed_step"
        ),
        CheckConstraint("result_note = '' or status in ('fail', 'blocked')", name="result_note"),
        UniqueConstraint("project_id", "key"),
        UniqueConstraint("id", "project_id"),
        # 상위를 지우면 하위가 고아가 되지 않게 cascade 를 두지 않는다 — 서비스가 409 로 막는다
        ForeignKeyConstraint(["parent_id", "project_id"], ["test_case.id", "test_case.project_id"]),
        ForeignKeyConstraint(["part_id", "project_id"], ["part.id", "part.project_id"]),
        Index("ix_test_case_project_id_seq", "project_id", "seq"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    # HW-T12
    key: Mapped[str] = mapped_column(String(32))
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    title: Mapped[str] = mapped_column(Text)
    purpose: Mapped[str] = mapped_column(Text, default="", server_default="")
    precondition: Mapped[str] = mapped_column(Text, default="", server_default="")
    test_data: Mapped[str] = mapped_column(Text, default="", server_default="")
    parent_id: Mapped[str | None] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(16), default="draft", server_default="draft")
    status_changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    status_changed_by: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    failed_step: Mapped[int | None] = mapped_column(Integer)
    result_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    level: Mapped[str | None] = mapped_column(String(16))
    start: Mapped[date | None] = mapped_column(Date)
    due: Mapped[date | None] = mapped_column(Date)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    part_id: Mapped[str | None] = mapped_column(String(36))
    # 마지막으로 기준을 확인했을 때 닿는 안건들의 Entry seq 최댓값 — 시각이 아니라 seq 로 본다 (Q15)
    basis_seq: Mapped[int | None] = mapped_column(BigInteger)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    steps: Mapped[list["TestStep"]] = relationship(
        cascade="all, delete-orphan",
        order_by="TestStep.sort_order",
        lazy="selectin",
    )


class TestStep(Base):
    """행동 ↔ 기대 결과 짝. 배열 순서가 단계 순서다."""

    __test__ = False
    __tablename__ = "test_step"
    __table_args__ = (UniqueConstraint("test_id", "sort_order"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    test_id: Mapped[str] = mapped_column(ForeignKey("test_case.id", ondelete="CASCADE"))
    sort_order: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(Text)
    expected: Mapped[str] = mapped_column(Text, default="", server_default="")


class TestRef(Base):
    """참조 태그 — 작업이나 안건 하나. 같은 프로젝트 것만 건다 (check_request 와 같은 방식).

    작업 · 안건을 지우면 태그 줄만 지워지고 테스트는 남는다.
    """

    __test__ = False
    __tablename__ = "test_ref"
    __table_args__ = (
        CheckConstraint("(task_id is null) <> (thread_id is null)", name="one_target"),
        ForeignKeyConstraint(
            ["test_id", "project_id"],
            ["test_case.id", "test_case.project_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["task_id", "project_id"], ["task.id", "task.project_id"], ondelete="CASCADE"
        ),
        ForeignKeyConstraint(
            ["thread_id", "project_id"], ["thread.id", "thread.project_id"], ondelete="CASCADE"
        ),
        UniqueConstraint("test_id", "task_id"),
        UniqueConstraint("test_id", "thread_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    test_id: Mapped[str] = mapped_column(String(36))
    project_id: Mapped[str] = mapped_column(String(36))
    task_id: Mapped[str | None] = mapped_column(String(36))
    thread_id: Mapped[str | None] = mapped_column(String(36))
