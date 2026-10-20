from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, Date, DateTime, ForeignKey, Identity, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_id

# Postgres 는 jsonb, 검사의 sqlite 는 JSON 으로 선다
FACTS_TYPE = JSON().with_variant(JSONB(), "postgresql")


class ProjectReport(Base):
    """프로젝트 진행 리포트 한 편 — 기록이라 고치지 않는다 (docs/api/report.md, Q51).

    `facts` 는 만든 때의 계산(ProgressFacts, camelCase 그대로)이다 — 다시 계산하지 않는다.
    """

    __tablename__ = "project_report"
    __table_args__ = (Index("ix_project_report_project_id_seq", "project_id", "seq"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    facts: Mapped[dict[str, Any]] = mapped_column(FACTS_TYPE)
    body: Mapped[str] = mapped_column(Text)
    # 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    created_by: Mapped[str] = mapped_column(ForeignKey("member.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 같은 날 여러 번 만든다 — 순서 · '바로 앞 리포트' 는 이것으로 고른다 (API.md Q15)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
