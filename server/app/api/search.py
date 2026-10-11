from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.schemas.search import SearchResult
from app.services import search as search_service

router = APIRouter(tags=["search"])

Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("/projects/{project_id}/search")
async def search(
    project_id: str,
    session: Session,
    q: str,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> SearchResult:
    """챗봇의 검색 도구 둘을 그대로 연 것. 빈 q 는 422 다 — 서비스가 막는다(도구로 불려도 같다)."""
    return await search_service.search(session, project_id, q, limit)
