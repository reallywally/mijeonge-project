from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
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

# 상태는 셋뿐이다. '미룸'은 상태가 아니라 kind='defer' 인 Entry 다
THREAD_STATES = ("queued", "open", "decided")
ENTRY_KINDS = ("raise", "defer", "decide", "refine", "change", "split")


class Thread(Base):
    __tablename__ = "thread"
    __table_args__ = (
        CheckConstraint(f"state in {THREAD_STATES}", name="state"),
        Index("ix_thread_project_id", "project_id"),
        # 부모는 같은 프로젝트여야 한다 (API.md Q16). 링크 테이블의 복합 FK 도 이 유니크를 본다
        UniqueConstraint("id", "project_id"),
        ForeignKeyConstraint(
            ["parent_thread_id", "project_id"], ["thread.id", "thread.project_id"]
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(16), default="queued")
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    # 다른 안건에서 떼어낸 것이면 그 안건. FK 는 위의 복합 FK 하나뿐이다
    parent_thread_id: Mapped[str | None] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 등록 순서. 화면이 배열 순서를 그대로 쓴다(안건 목록 · 작업 목록에 정렬이 없다) —
    # created_at 은 날짜뿐이라 같은 날 여러 줄의 순서를 못 가린다
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)


class Entry(Base):
    """(회의 × 안건) 한 줄.

    meeting_id 가 null 이면 회의 없이 처리한 줄이다 — nullable 을 지우면 모델이 틀린 것이다.
    """

    __tablename__ = "entry"
    __table_args__ = (
        CheckConstraint(f"kind in {ENTRY_KINDS}", name="kind"),
        Index("ix_entry_thread_id_created_at", "thread_id", "created_at"),
        Index("ix_entry_meeting_id", "meeting_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    thread_id: Mapped[str] = mapped_column(ForeignKey("thread.id", ondelete="CASCADE"))
    meeting_id: Mapped[str | None] = mapped_column(ForeignKey("meeting.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(Text, default="")
    # 왜 그렇게 됐는지
    note: Mapped[str] = mapped_column(Text, default="")
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 등록 순서. 화면이 배열 순서를 그대로 쓴다(안건 목록 · 작업 목록에 정렬이 없다) —
    # created_at 은 날짜뿐이라 같은 날 여러 줄의 순서를 못 가린다
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)

    details: Mapped[list["EntryDetail"]] = relationship(
        back_populates="entry",
        cascade="all, delete-orphan",
        order_by="EntryDetail.sort_order",
        lazy="selectin",
    )


class EntryDetail(Base):
    """결정 안에 함께 적힌 조건별 상세 줄. 프론트는 배열이라 순서가 뜻을 갖는다."""

    __tablename__ = "entry_detail"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    entry_id: Mapped[str] = mapped_column(ForeignKey("entry.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer)

    entry: Mapped[Entry] = relationship(back_populates="details")
