from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_id
from app.models.risk_analysis import JSON_TYPE


class AgendaImpact(Base):
    """AI 영향도 분석 한 편 (docs/api/impact.md). 그 안건 · 그 결정 판에 묶여 늘 남는다.

    판정 · `before` 는 기록이라 고치지 않는다 — 반영하면 그 줄의 `appliedAt` 과 반영한 값만 바뀐다.
    """

    __tablename__ = "agenda_impact"
    __table_args__ = (
        # 안건과 같은 프로젝트여야 한다 (Q13 과 같은 방식). 논리 삭제면 줄은 남고 읽는 쪽이 거른다
        ForeignKeyConstraint(
            ["agenda_id", "project_id"], ["agenda.id", "agenda.project_id"], ondelete="CASCADE"
        ),
        # '가장 최근 분석' — Postgres 는 오름차순 색인을 거꾸로 읽는다
        Index("ix_agenda_impact_agenda_id_created_at", "agenda_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    # FK 는 위의 복합 FK 하나뿐이다
    project_id: Mapped[str] = mapped_column(String(36))
    agenda_id: Mapped[str] = mapped_column(String(36))
    decision_rev: Mapped[int] = mapped_column(Integer)
    decision_before: Mapped[str | None] = mapped_column(Text)
    decision_after: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text)
    # { tasks, tests, conflicts } — 계약의 모양 그대로(camelCase)
    result: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("member.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
