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
from app.models.task import HISTORY_CHANGES

# 지우지 않은 줄의 기본값
FALSE = text("false")

# 상태는 셋뿐이다 — 사람이 직접 고른다 (docs/api/agenda.md)
AGENDA_STATES = ("queued", "open", "decided")


class Agenda(Base):
    __tablename__ = "agenda"
    __table_args__ = (
        CheckConstraint(f"state in {AGENDA_STATES}", name="state"),
        Index("ix_agenda_project_id", "project_id"),
        # 읽는 자리마다 지운 안건을 거른다 — 작업(ix_task_project_id_live)과 같은 부분 인덱스
        Index(
            "ix_agenda_project_id_live",
            "project_id",
            "seq",
            postgresql_where=text("not is_deleted"),
            sqlite_where=text("not is_deleted"),
        ),
        # 링크 · 이력 · 확인 요청 · 테스트 참조의 복합 FK 가 이 유니크를 본다 (API.md Q13)
        UniqueConstraint("id", "project_id"),
        # 파트도 같은 프로젝트의 것만 단다 (docs/api/part.md)
        ForeignKeyConstraint(["part_id", "project_id"], ["part.id", "part.project_id"]),
        trgm_index("agenda", "title"),
        trgm_index("agenda", "description"),
        trgm_index("agenda", "decision"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Text)
    # 배경(왜 지금 정해야 하나). 빈 값은 null 이 아니라 '' 다
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    # 결정내용 — 여러 줄 글. 결정이 언제 어떻게 바뀌었는지는 agenda_history 에만 남는다
    decision: Mapped[str] = mapped_column(Text, default="", server_default="")
    state: Mapped[str] = mapped_column(String(16), default="queued")
    # state 가 decided 로 바뀐 시각. decided 가 아니면 null
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 결정 판 — 확인 요청이 '이 결정' 을 가리키는 자리. 서버만 올린다
    decision_rev: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    # 등록한 사람 — 수정 · 삭제 권한의 근거라 바꾸지 않는다. 기록이 없던 지난 안건은 null.
    # 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    creator_id: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    # 결정 기한. 사람이 고른 날짜라 Task.start · due 와 같이 date 다
    due_date: Mapped[date | None] = mapped_column(Date)
    # null 이면 프로젝트 공통
    part_id: Mapped[str | None] = mapped_column(String(36))
    # AI 정리로 [등록] 했으면 그 회의록. 회의록을 지우면 비고 줄은 남는다 (docs/api/minutes.md)
    minutes_id: Mapped[str | None] = mapped_column(
        ForeignKey("minutes.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 등록 순서. 화면이 배열 순서를 그대로 쓴다(안건 목록 · 작업 목록에 정렬이 없다)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    # 논리 삭제 — 링크 · 확인 요청 · 이력은 그대로 두고 읽는 쪽이 거른다
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, server_default=FALSE)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[str | None] = mapped_column(ForeignKey("member.id"))

    # 참조 — 알아야 하는 사람. 권한 · 리스크와 무관하고 확인 요청이 받는 사람으로 쓴다
    # (docs/api/cc.md · check.md). 프론트는 string[] 이라 순서가 뜻을 갖는다
    cc: Mapped[list["AgendaCc"]] = relationship(
        cascade="all, delete-orphan",
        order_by="AgendaCc.sort_order",
        lazy="selectin",
    )


class AgendaCc(Base):
    """참조 한 사람 (docs/api/cc.md)."""

    __tablename__ = "agenda_cc"
    __table_args__ = (
        # 안건과 같은 프로젝트여야 한다 (Q13 과 같은 방식). 안건을 지우면 같이 지운다
        ForeignKeyConstraint(
            ["agenda_id", "project_id"], ["agenda.id", "agenda.project_id"], ondelete="CASCADE"
        ),
    )

    agenda_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # FK 는 위의 복합 FK 하나뿐이다
    project_id: Mapped[str] = mapped_column(String(36))
    # 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    member_id: Mapped[str] = mapped_column(ForeignKey("member.id"), primary_key=True)
    sort_order: Mapped[int] = mapped_column(Integer)


class AgendaHistory(Base):
    """안건 변경 이력 한 줄 = 요청 하나. `task_history` 와 같은 모양이다 (docs/api/history.md)."""

    __tablename__ = "agenda_history"
    __table_args__ = (
        ForeignKeyConstraint(
            ["agenda_id", "project_id"], ["agenda.id", "agenda.project_id"], ondelete="CASCADE"
        ),
        Index("ix_agenda_history_agenda_id_seq", "agenda_id", "seq"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(String(36))
    agenda_id: Mapped[str] = mapped_column(String(36))
    # backfill 은 누가 했는지 모른다. 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    changed_by: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # changed_at 으로 세우지 않는다 (Q15)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    changes: Mapped[list[dict[str, object]]] = mapped_column(HISTORY_CHANGES)
    backfilled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=FALSE)
    # 회의록 [등록] 이 남긴 줄이면 그 회의록 — 'AI 리스크 분석' 이 다룬 회의를 센다 (API.md Q69).
    # 회의록을 지우면 줄은 남고 출처만 빈다. 2026-11-06 전의 줄은 비어 있다(채우지 않았다)
    minutes_id: Mapped[str | None] = mapped_column(
        ForeignKey("minutes.id", ondelete="SET NULL"), index=True
    )
