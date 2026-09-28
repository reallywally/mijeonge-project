from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
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


class Meeting(Base):
    """회의가 짊어지는 것은 날짜 · 참석자뿐이다. 회의록 본문은 없다 — Entry 가 그 기록이다."""

    __tablename__ = "meeting"
    __table_args__ = (
        Index("ix_meeting_project_id_date", "project_id", "date"),
        # meeting_task_link 의 복합 FK 가 본다 (API.md Q13)
        UniqueConstraint("id", "project_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Text)
    date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 등록 순서. 화면이 배열 순서를 그대로 쓴다(안건 목록 · 작업 목록에 정렬이 없다) —
    # created_at 은 날짜뿐이라 같은 날 여러 줄의 순서를 못 가린다
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)

    attendees: Mapped[list["MeetingAttendee"]] = relationship(
        back_populates="meeting",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    memos: Mapped[list["MeetingMemo"]] = relationship(
        back_populates="meeting",
        cascade="all, delete-orphan",
        order_by="MeetingMemo.sort_order",
        lazy="selectin",
    )


class MeetingAttendee(Base):
    __tablename__ = "meeting_attendee"

    meeting_id: Mapped[str] = mapped_column(
        ForeignKey("meeting.id", ondelete="CASCADE"), primary_key=True
    )
    member_id: Mapped[str] = mapped_column(
        ForeignKey("member.id", ondelete="CASCADE"), primary_key=True
    )

    meeting: Mapped[Meeting] = relationship(back_populates="attendees")


class MeetingMemo(Base):
    """안건에 붙지 않는 줄. 나중에 안건으로 올리면 promoted_thread_id 가 찬다."""

    __tablename__ = "meeting_memo"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    meeting_id: Mapped[str] = mapped_column(ForeignKey("meeting.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(Text)
    promoted_thread_id: Mapped[str | None] = mapped_column(ForeignKey("thread.id"))
    sort_order: Mapped[int] = mapped_column(Integer)

    meeting: Mapped[Meeting] = relationship(back_populates="memos")
