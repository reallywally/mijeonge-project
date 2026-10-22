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

    # AI 를 어느 공급자로 부를지. 고른 공급자의 키(와 모델)가 없으면 앱은 뜨고 AI 경로만 503 이다
    llm_provider: Literal["anthropic", "openai", "groq"] = "anthropic"
    # 키는 SecretStr 이라 repr · 로그에 안 찍힌다
    anthropic_api_key: SecretStr | None = None
    # 모델 · effort 는 여기서만 바꾼다 (API.md Q25). Sonnet 5.5 는 effort 기본값이 high 라 명시한다.
    # chat_model · chat_effort 는 Claude 의 것이다
    chat_model: str = "claude-sonnet-5-5"
    chat_effort: Literal["low", "medium", "high", "xhigh", "max"] = "low"
    # GPT · Groq 는 모델 id 를 꼭 적는다 — 기본값을 두지 않는다(바뀌는 이름을 코드가 짐작하지 않게)
    openai_api_key: SecretStr | None = None
    openai_model: str | None = None
    groq_api_key: SecretStr | None = None
    groq_model: str | None = None
    # 공급자 공통. Claude 는 thinking 을 끌 수 없어 그 몫까지 들어간다
    chat_max_tokens: int = 8000
    # 회의록 초안은 도구 입력 하나에 안건 · 이력 · 작업 수십 줄이 실려 챗봇 답보다 길다
    minutes_max_tokens: int = 16000
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
