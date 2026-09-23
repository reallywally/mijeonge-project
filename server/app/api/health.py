from fastapi import APIRouter

router = APIRouter(tags=["health"])


# 앱이 떴는지만 본다 — DB 는 찌르지 않는다
@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
