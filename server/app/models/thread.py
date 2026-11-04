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
)
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, new_id, trgm_index
from app.models.task import HISTORY_CHANGES

# Entry 에 `text` 칸이 있어 sqlalchemy 의 text 는 sql_text 로 들인다. 지우지 않은 줄의 기본값
FALSE = sql_text("false")

# 상태는 셋뿐이다. '미룸'은 상태가 아니라 kind='defer' 인 Entry 다
THREAD_STATES = ("queued", "open", "decided")
ENTRY_KINDS = ("raise", "defer", "decide", "refine", "change", "split")


class Thread(Base):
    __tablename__ = "thread"
    __table_args__ = (
        CheckConstraint(f"state in {THREAD_STATES}", name="state"),
        Index("ix_thread_project_id", "project_id"),
        # 읽는 자리마다 지운 안건을 거른다 — 작업(ix_task_project_id_live)과 같은 부분 인덱스
        Index(
            "ix_thread_project_id_live",
            "project_id",
            "seq",
            postgresql_where=sql_text("not is_deleted"),
            sqlite_where=sql_text("not is_deleted"),
        ),
        # 부모는 같은 프로젝트여야 한다 (API.md Q16). 링크 테이블의 복합 FK 도 이 유니크를 본다
        UniqueConstraint("id", "project_id"),
        ForeignKeyConstraint(
            ["parent_thread_id", "project_id"], ["thread.id", "thread.project_id"]
        ),
        # 파트도 같은 프로젝트의 것만 단다 (docs/api/part.md)
        ForeignKeyConstraint(["part_id", "project_id"], ["part.id", "part.project_id"]),
        trgm_index("thread", "title"),
        trgm_index("thread", "description"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Text)
    # 배경(왜 지금 정해야 하나). 빈 값은 null 이 아니라 '' 다
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    state: Mapped[str] = mapped_column(String(16), default="queued")
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    # 등록한 사람 — 수정 · 삭제 권한의 근거라 바꾸지 않는다. 기록이 없던 지난 안건은 null.
    # 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    creator_id: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    # 결정 기한. 사람이 고른 날짜라 Task.start · due 와 같이 date 다
    due_date: Mapped[date | None] = mapped_column(Date)
    # 다른 안건에서 떼어낸 것이면 그 안건. FK 는 위의 복합 FK 하나뿐이다
    parent_thread_id: Mapped[str | None] = mapped_column(String(36))
    # null 이면 프로젝트 공통
    part_id: Mapped[str | None] = mapped_column(String(36))
    # AI 정리로 [등록] 했으면 그 회의록. 회의록을 지우면 비고 줄은 남는다 (docs/api/minutes.md)
    minutes_id: Mapped[str | None] = mapped_column(
        ForeignKey("minutes.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 등록 순서. 화면이 배열 순서를 그대로 쓴다(안건 목록 · 작업 목록에 정렬이 없다) —
    # created_at 은 날짜뿐이라 같은 날 여러 줄의 순서를 못 가린다
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    # 논리 삭제 — 이력 줄 · 후보 · 참조 · 링크 · 확인 요청은 그대로 두고 읽는 쪽이 거른다
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, server_default=FALSE)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[str | None] = mapped_column(ForeignKey("member.id"))

    options: Mapped[list["ThreadOption"]] = relationship(
        back_populates="thread",
        cascade="all, delete-orphan",
        order_by="ThreadOption.sort_order",
        lazy="selectin",
    )
    # 참조 — 결정을 같이 알아야 할 사람. 확인 요청이 받는 사람으로 쓴다 (docs/api/check.md)
    cc: Mapped[list["ThreadCc"]] = relationship(
        cascade="all, delete-orphan",
        order_by="ThreadCc.sort_order",
        lazy="selectin",
    )


class ThreadOption(Base):
    """후보 선택지 한 줄. 프론트는 string[] 이라 순서가 뜻을 갖는다."""

    __tablename__ = "thread_option"
    __table_args__ = (trgm_index("thread_option", "text"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    thread_id: Mapped[str] = mapped_column(ForeignKey("thread.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer)

    thread: Mapped[Thread] = relationship(back_populates="options")


class ThreadCc(Base):
    """참조 한 사람. 프론트는 string[] 이라 순서가 뜻을 갖는다."""

    __tablename__ = "thread_cc"
    __table_args__ = (
        # 안건과 같은 프로젝트여야 한다 (Q13 · Q16 과 같은 방식). 안건을 지우면 같이 지운다
        ForeignKeyConstraint(
            ["thread_id", "project_id"], ["thread.id", "thread.project_id"], ondelete="CASCADE"
        ),
    )

    thread_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # FK 는 위의 복합 FK 하나뿐이다
    project_id: Mapped[str] = mapped_column(String(36))
    # 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    member_id: Mapped[str] = mapped_column(ForeignKey("member.id"), primary_key=True)
    sort_order: Mapped[int] = mapped_column(Integer)


class DecisionItem(Base):
    """결정 항목 — 안건 안에서 따로 정하는 것 하나. 상태는 두지 않고 이력에서 센다."""

    __tablename__ = "decision_item"
    __table_args__ = (
        # 안건과 같은 프로젝트여야 한다 (Q13 · Q16 과 같은 방식). 안건을 지우면 같이 지운다
        ForeignKeyConstraint(
            ["thread_id", "project_id"], ["thread.id", "thread.project_id"], ondelete="CASCADE"
        ),
        # 이력 줄의 복합 FK 가 이 유니크를 본다 — 다른 안건의 항목에 줄이 달리지 않게
        UniqueConstraint("id", "thread_id"),
        Index(
            "ix_decision_item_thread_id_live",
            "thread_id",
            "sort_order",
            postgresql_where=sql_text("not is_deleted"),
            sqlite_where=sql_text("not is_deleted"),
        ),
        trgm_index("decision_item", "title"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    # FK 는 위의 복합 FK 하나뿐이다
    project_id: Mapped[str] = mapped_column(String(36))
    thread_id: Mapped[str] = mapped_column(String(36))
    title: Mapped[str] = mapped_column(Text)
    # 등록한 사람. 이행으로 만든 지난 항목은 null
    creator_id: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 안건 안의 화면 순서 — 지금은 등록 순으로만 붙는다
    sort_order: Mapped[int] = mapped_column(Integer)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    # 논리 삭제 — 그 항목의 줄은 이력에 남고 안건 상태 계산에서만 빠진다
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, server_default=FALSE)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[str | None] = mapped_column(ForeignKey("member.id"))


class Entry(Base):
    """안건 이력 한 줄. 결정 · 미룸이 남는 유일한 자리다."""

    __tablename__ = "entry"
    __table_args__ = (
        CheckConstraint(f"kind in {ENTRY_KINDS}", name="kind"),
        # 항목은 같은 안건의 것만 단다. item_id 가 null 이면 걸리지 않는다
        ForeignKeyConstraint(
            ["item_id", "thread_id"], ["decision_item.id", "decision_item.thread_id"]
        ),
        Index("ix_entry_thread_id_created_at", "thread_id", "created_at"),
        trgm_index("entry", "text"),
        trgm_index("entry", "note"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    thread_id: Mapped[str] = mapped_column(ForeignKey("thread.id", ondelete="CASCADE"))
    # 이 줄이 다루는 결정 항목. decide · change · refine 은 늘 달리고,
    # defer 는 null 이면 안건 전체다.
    # FK 는 위의 복합 FK 하나뿐이다
    item_id: Mapped[str | None] = mapped_column(String(36), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(Text, default="")
    # 왜 그렇게 됐는지
    note: Mapped[str] = mapped_column(Text, default="")
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    # 줄을 남긴 사람 — 그 줄을 고치고 지울 수 있다. 기록이 없던 지난 줄은 null
    creator_id: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    # AI 정리로 [등록] 했으면 그 회의록. 회의록을 지우면 비고 줄은 남는다 (docs/api/minutes.md)
    minutes_id: Mapped[str | None] = mapped_column(
        ForeignKey("minutes.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 등록 순서. 화면이 배열 순서를 그대로 쓴다(안건 목록 · 작업 목록에 정렬이 없다) —
    # created_at 은 날짜뿐이라 같은 날 여러 줄의 순서를 못 가린다
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    # 논리 삭제 — 지운 줄은 안건 상태 · 결정 · 검색 어디서도 빠진다
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, server_default=FALSE)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[str | None] = mapped_column(ForeignKey("member.id"))

    details: Mapped[list["EntryDetail"]] = relationship(
        back_populates="entry",
        cascade="all, delete-orphan",
        order_by="EntryDetail.sort_order",
        lazy="selectin",
    )


class EntryDetail(Base):
    """결정 안에 함께 적힌 조건별 상세 줄. 프론트는 배열이라 순서가 뜻을 갖는다."""

    __tablename__ = "entry_detail"
    __table_args__ = (trgm_index("entry_detail", "text"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    entry_id: Mapped[str] = mapped_column(ForeignKey("entry.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer)

    entry: Mapped[Entry] = relationship(back_populates="details")


class ThreadHistory(Base):
    """안건 변경 이력 한 줄 = 요청 하나. `task_history` 와 같은 모양이다 (docs/api/history.md)."""

    __tablename__ = "thread_history"
    __table_args__ = (
        ForeignKeyConstraint(
            ["thread_id", "project_id"], ["thread.id", "thread.project_id"], ondelete="CASCADE"
        ),
        Index("ix_thread_history_thread_id_seq", "thread_id", "seq"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(String(36))
    thread_id: Mapped[str] = mapped_column(String(36))
    # backfill 은 누가 했는지 모른다. 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    changed_by: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # changed_at 으로 세우지 않는다 (Q15)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    changes: Mapped[list[dict[str, object]]] = mapped_column(HISTORY_CHANGES)
    backfilled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=FALSE)
