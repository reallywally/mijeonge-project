from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_id

# Postgres 는 jsonb, 검사의 sqlite 는 JSON 으로 선다
JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")
ANALYSIS_TITLE_MAX = 100


class RiskAnalysis(Base):
    """AI 리스크 분석 한 편 (docs/api/risk-analysis.md).

    분석이 끝나면 임시(`saved_at` null)로 남고, 돌린 사람이 [저장] 하면 게시판에 오른다.
    글 · 근거 칩 · 스냅샷(`facts`)은 기록이라 고치지 않는다 — 제목만 바뀐다.
    """

    __tablename__ = "risk_analysis"
    __table_args__ = (
        # 게시판 번호 — 임시(null)는 여럿이어도 된다
        UniqueConstraint("project_id", "seq"),
        # 오래된 임시 줄을 지울 때 · '바로 앞 저장 분석' 을 찾을 때
        Index("ix_risk_analysis_saved_at_created_at", "saved_at", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    seq: Mapped[int | None] = mapped_column(Integer)
    title: Mapped[str | None] = mapped_column(String(ANALYSIS_TITLE_MAX))
    body: Mapped[str] = mapped_column(Text)
    refs: Mapped[list[dict[str, Any]]] = mapped_column(JSON_TYPE)
    facts: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("member.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    saved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    title_edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
