"""리스크 기준(`RiskSettings`) — 읽기 · 바꾸기 (`risk.md` '기준 설정' · `risk-dashboard.md` '기준').

리스크 계산(`services/risk.py`)과 테스트 신호(`services/test.py`)가 같이 읽는다.
리스크가 테스트 신호를 다시 쓰므로 둘 사이 import 고리가 생기지 않게 따로 둔다.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_settings
from app.errors import ApiError
from app.models import RiskSetting
from app.schemas.risk import RiskSettings
from app.time import now


def default_settings() -> RiskSettings:
    return RiskSettings(
        due_soon_days=app_settings.risk_due_soon_days,
        stale_days=app_settings.risk_stale_days,
        high_score=app_settings.risk_high_score,
        medium_score=app_settings.risk_medium_score,
        churn_days=app_settings.risk_churn_days,
        churn_count=app_settings.risk_churn_count,
        slip_count=app_settings.risk_slip_count,
    )


async def load_settings(session: AsyncSession, project_id: str) -> RiskSettings:
    row = await session.get(RiskSetting, project_id)
    return default_settings() if row is None else RiskSettings.model_validate(row)


async def save_settings(
    session: AsyncSession, project_id: str, payload: RiskSettings
) -> RiskSettings:
    """일곱 값을 통째로 덮는다(upsert). 부분 수정은 없다."""
    if payload.high_score <= payload.medium_score:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "요청 값이 올바르지 않습니다.",
            {"highScore": "medium 점수보다 커야 합니다."},
        )
    row = await session.get(RiskSetting, project_id)
    if row is None:
        row = RiskSetting(project_id=project_id)
        session.add(row)
    for name in RiskSettings.model_fields:
        setattr(row, name, getattr(payload, name))
    row.updated_at = now()
    await session.commit()
    return RiskSettings.model_validate(row)
