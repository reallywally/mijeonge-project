from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, text
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.models.base import Base
from app.time import now

# 문턱값 일곱의 범위 (risk.md '기준 설정' · risk-dashboard.md '기준').
# 스키마와 CHECK 가 같은 값을 본다
RISK_RANGES: dict[str, tuple[int, int]] = {
    "due_soon_days": (1, 30),
    "stale_days": (1, 90),
    "high_score": (2, 30),
    "medium_score": (1, 29),
    "churn_days": (1, 90),
    "churn_count": (2, 50),
    "slip_count": (1, 10),
}


class RiskSetting(Base):
    """프로젝트의 리스크 기준. 바꾼 프로젝트만 줄이 있고, 없으면 `config.py` 의 기본값이다."""

    __tablename__ = "risk_setting"
    __table_args__ = (
        *(
            CheckConstraint(f"{column} between {low} and {high}", name=f"{column}_range")
            for column, (low, high) in RISK_RANGES.items()
        ),
        # 둘이 같으면 medium 이 사라진다
        CheckConstraint("high_score > medium_score", name="high_above_medium"),
    )

    project_id: Mapped[str] = mapped_column(
        ForeignKey("project.id", ondelete="CASCADE"), primary_key=True
    )
    due_soon_days: Mapped[int] = mapped_column(Integer)
    stale_days: Mapped[int] = mapped_column(Integer)
    high_score: Mapped[int] = mapped_column(Integer)
    medium_score: Mapped[int] = mapped_column(Integer)
    # 흔들림 기준(2026-11-06) — 이행 전 줄이 기본값을 갖게 server_default 를 둔다
    churn_days: Mapped[int] = mapped_column(
        Integer, server_default=text(str(settings.risk_churn_days))
    )
    churn_count: Mapped[int] = mapped_column(
        Integer, server_default=text(str(settings.risk_churn_count))
    )
    slip_count: Mapped[int] = mapped_column(
        Integer, server_default=text(str(settings.risk_slip_count))
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
