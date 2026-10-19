from app.schemas.base import Schema, Utc


class CheckRequestOut(Schema):
    """domain.ts 의 `CheckRequest`. 부하 네 칸은 2차 분석만 쓰므로 내보내지 않는다."""

    id: str
    project_id: str
    thread_id: str
    # 이 요청이 알린 결정 — 그 안건의 decide · change 이력
    entry_id: str
    sender_id: str
    recipient_id: str
    created_at: Utc
    # null 이면 대기
    confirmed_at: Utc | None


class CheckPendingCount(Schema):
    # 내가 받은 대기 수 — 지금 부여된 프로젝트 전부의 합
    total: int
    # 대기가 하나라도 있는 프로젝트만
    by_project: dict[str, int]
