import httpx
from httpx import ASGITransport

from app.main import app


async def test_health_ok() -> None:
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/health")

    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
