from fastapi import APIRouter

from app.api.deps import Session
from app.schemas.history import HistoryEntry
from app.services import history as history_service

# 작업 · 테스트 상세의 '변경 이력' (docs/api/history.md). 읽기만 — 남기는 것은 쓰기 서비스가 한다.
# 경계는 require_scope 가 경로의 task_id · test_id 로 본다
router = APIRouter(tags=["history"])


@router.get("/tasks/{task_id}/history")
async def task_history(task_id: str, session: Session) -> list[HistoryEntry]:
    """등록 순(seq 오름차순) — 화면이 뒤집어 최근 것부터 보인다."""
    return await history_service.list_task_history(session, task_id)


@router.get("/tests/{test_id}/history")
async def test_history(test_id: str, session: Session) -> list[HistoryEntry]:
    return await history_service.list_test_history(session, test_id)
