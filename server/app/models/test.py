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

from app.models.base import Base, new_id
from app.models.task import HISTORY_CHANGES

TEST_STATUSES = ("draft", "ready", "testing", "pass", "fail", "blocked")


class TestCase(Base):
    """기능 · 시나리오 테스트 하나 — 작업과 따로 둔다 (docs/api/test.md · Q55).

    상태 기록(셈의 근거)은 없다 — 마지막으로 바뀐 때 · 누가만 남는다 (Q54).
    덮어쓴 앞 값은 화면용 변경 이력(`TestHistory`)에 남는다 (Q59).
    """

    # 이름이 Test 로 시작해도 pytest 가 검사 클래스로 줍지 않게
    __test__ = False
    __tablename__ = "test_case"
    __table_args__ = (
        CheckConstraint(f"status in {TEST_STATUSES}", name="status"),
        CheckConstraint("parent_id is null or parent_id <> id", name="parent_not_self"),
        # 서비스가 지키는 규칙의 안전망 — 메모가 다른 상태에 남지 않게
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
    content: Mapped[str] = mapped_column(Text, default="", server_default="")
    test_data: Mapped[str] = mapped_column(Text, default="", server_default="")
    parent_id: Mapped[str | None] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(16), default="draft", server_default="draft")
    status_changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    status_changed_by: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    result_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    start: Mapped[date | None] = mapped_column(Date)
    due: Mapped[date | None] = mapped_column(Date)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    part_id: Mapped[str | None] = mapped_column(String(36))
    # 마지막으로 기준을 확인했을 때 닿는 안건들의 결정 바뀜(agenda_history) seq 최댓값 (Q15)
    basis_seq: Mapped[int | None] = mapped_column(BigInteger)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    # 참조 — 알아야 하는 사람. 권한 · 신호와 무관하다 (docs/api/cc.md). 순서가 뜻을 갖는다
    cc: Mapped[list["TestCc"]] = relationship(
        cascade="all, delete-orphan",
        order_by="TestCc.sort_order",
        lazy="selectin",
    )


class TestCc(Base):
    """참조 한 사람 (docs/api/cc.md). 안건의 `AgendaCc` 와 같은 모양."""

    __test__ = False
    __tablename__ = "test_cc"
    __table_args__ = (
        ForeignKeyConstraint(
            ["test_id", "project_id"],
            ["test_case.id", "test_case.project_id"],
            ondelete="CASCADE",
        ),
    )

    test_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # FK 는 위의 복합 FK 하나뿐이다
    project_id: Mapped[str] = mapped_column(String(36))
    # 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    member_id: Mapped[str] = mapped_column(ForeignKey("member.id"), primary_key=True)
    sort_order: Mapped[int] = mapped_column(Integer)


class TestComment(Base):
    """조치 내역 한 줄 — 작업 댓글(`TaskComment`)과 같은 모양 (docs/api/test-comment.md).

    테스트를 지우면 같이 지워진다. 이력 · 신호 · 기준에는 닿지 않는다.
    """

    __test__ = False
    __tablename__ = "test_comment"
    __table_args__ = (Index("ix_test_comment_test_id_seq", "test_id", "seq"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    test_id: Mapped[str] = mapped_column(ForeignKey("test_case.id", ondelete="CASCADE"))
    # 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    author_id: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 한 번도 안 고쳤으면 null
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 목록 순서 — created_at 으로 세우지 않는다 (API.md Q15)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)


class TestRef(Base):
    """참조 태그 — 작업이나 안건 하나. 같은 프로젝트 것만 건다 (check_request 와 같은 방식).

    작업 · 안건을 지우면 태그 줄만 지워지고 테스트는 남는다.
    """

    __test__ = False
    __tablename__ = "test_ref"
    __table_args__ = (
        CheckConstraint("(task_id is null) <> (agenda_id is null)", name="one_target"),
        ForeignKeyConstraint(
            ["test_id", "project_id"],
            ["test_case.id", "test_case.project_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["task_id", "project_id"], ["task.id", "task.project_id"], ondelete="CASCADE"
        ),
        ForeignKeyConstraint(
            ["agenda_id", "project_id"], ["agenda.id", "agenda.project_id"], ondelete="CASCADE"
        ),
        UniqueConstraint("test_id", "task_id"),
        UniqueConstraint("test_id", "agenda_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    test_id: Mapped[str] = mapped_column(String(36))
    project_id: Mapped[str] = mapped_column(String(36))
    task_id: Mapped[str | None] = mapped_column(String(36))
    agenda_id: Mapped[str | None] = mapped_column(String(36))


class TestHistory(Base):
    """테스트 변경 이력 한 줄 = 요청 하나 (docs/api/history.md · Q59). `TaskHistory` 와 같은 모양.

    셈(며칠째 · 신호)에는 쓰지 않는다 — 지금 상태의 시각은 `status_changed_at` 이 정답이다.
    """

    __test__ = False
    __tablename__ = "test_history"
    __table_args__ = (
        ForeignKeyConstraint(
            ["test_id", "project_id"],
            ["test_case.id", "test_case.project_id"],
            ondelete="CASCADE",
        ),
        Index("ix_test_history_test_id_seq", "test_id", "seq"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(String(36))
    test_id: Mapped[str] = mapped_column(String(36))
    # backfill 은 누가 했는지 모른다. 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    changed_by: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # changed_at 으로 세우지 않는다 (Q15)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    changes: Mapped[list[dict[str, object]]] = mapped_column(HISTORY_CHANGES)
    backfilled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
