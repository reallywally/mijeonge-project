from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://innoflow:innoflow@localhost:5432/innoflow"
    # 개발용 Vite 서버만 연다
    cors_origins: list[str] = ["http://localhost:5173"]
    # 쿼리 로그는 필요할 때만 켠다
    sql_echo: bool = False


settings = Settings()
