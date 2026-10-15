from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://innoflow:innoflow@localhost:5432/innoflow"
    # 개발용 Vite 서버만 연다
    cors_origins: list[str] = ["http://localhost:5173"]
    # 쿼리 로그는 필요할 때만 켠다
    sql_echo: bool = False

    # 없어도 앱은 뜬다 — 채팅만 503 CHAT_UNAVAILABLE. SecretStr 이라 repr · 로그에 안 찍힌다
    anthropic_api_key: SecretStr | None = None
    # 모델 · effort 는 여기서만 바꾼다 (API.md Q25). Sonnet 5.5 는 effort 기본값이 high 라 명시한다
    chat_model: str = "claude-sonnet-5-5"
    chat_effort: Literal["low", "medium", "high", "xhigh", "max"] = "low"
    # thinking 을 끌 수 없어 그 몫까지 들어간다
    chat_max_tokens: int = 8000
    chat_timeout_seconds: float = 120.0
    # IP 하나가 1분에 보낼 수 있는 질문 수
    chat_rate_per_minute: int = 10

    # 운영(HTTPS)에서는 켠다. 개발 Vite 는 http 라 꺼 둔다
    cookie_secure: bool = False
    # 마지막 요청에서 이만큼 지나면 세션이 끝난다 (docs/api/auth.md '테이블')
    session_days: int = 14
    # IP 하나가 1분에 시도할 수 있는 로그인 수
    login_rate_per_minute: int = 10

    # 결정 병목 리스크 기준의 기본값 — 프로젝트가 한 번도 안 바꿨을 때 쓴다.
    # 기본값은 여기 한 곳에만 둔다 (docs/api/risk.md '기준 설정')
    risk_due_soon_days: int = 3
    risk_defer_count: int = 2
    risk_stale_days: int = 7
    risk_high_score: int = 6
    risk_medium_score: int = 3


settings = Settings()
