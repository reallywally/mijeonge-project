from fastapi import APIRouter

from app.api.deps import ProjectScope, Session
from app.schemas.test import TestCaseOut, TestCreate, TestPatch, TestRefKind, TestStatusInput
from app.services import test as test_service
from app.time import today_kst

# 그 프로젝트 멤버 누구나 쓰고 · 고치고 · 상태를 바꾼다. 지우기만 좁다 (docs/api/test.md · Q53).
# '오늘' 은 한국 시간이다 — 며칠째 · 신호를 서버가 센다
router = APIRouter(tags=["test"])


@router.get("/projects/{project_id}/tests")
async def list_tests(project_id: str, scope: ProjectScope, session: Session) -> list[TestCaseOut]:
    return await test_service.list_tests(session, scope.project_id, today=today_kst())


@router.post("/projects/{project_id}/tests", status_code=201)
async def create_test(
    project_id: str, payload: TestCreate, scope: ProjectScope, session: Session
) -> TestCaseOut:
    return await test_service.create_test(
        session, scope.project_id, payload, scope.actor.id, today=today_kst()
    )


@router.get("/tests/{test_id}")
async def get_test(test_id: str, session: Session) -> TestCaseOut:
    return await test_service.get_test(session, test_id, today=today_kst())


@router.patch("/tests/{test_id}")
async def patch_test(
    test_id: str, payload: TestPatch, scope: ProjectScope, session: Session
) -> TestCaseOut:
    return await test_service.patch_test(
        session, test_id, payload, scope.actor.id, today=today_kst()
    )


@router.delete("/tests/{test_id}", status_code=204)
async def delete_test(test_id: str, scope: ProjectScope, session: Session) -> None:
    """만든 사람 · 그 프로젝트 관리자 · 시스템 관리자."""
    await test_service.delete_test(session, test_id, scope)


@router.post("/tests/{test_id}/status")
async def set_status(
    test_id: str, payload: TestStatusInput, scope: ProjectScope, session: Session
) -> TestCaseOut:
    return await test_service.set_status(
        session, test_id, payload, scope.actor.id, today=today_kst()
    )


@router.put("/tests/{test_id}/refs/{kind}/{ref_id}")
async def put_ref(
    test_id: str, kind: TestRefKind, ref_id: str, scope: ProjectScope, session: Session
) -> TestCaseOut:
    return await test_service.put_ref(
        session, test_id, kind, ref_id, scope.actor.id, today=today_kst()
    )


@router.delete("/tests/{test_id}/refs/{kind}/{ref_id}", status_code=204)
async def delete_ref(
    test_id: str, kind: TestRefKind, ref_id: str, scope: ProjectScope, session: Session
) -> None:
    await test_service.delete_ref(session, test_id, kind, ref_id, scope.actor.id)


@router.post("/tests/{test_id}/basis")
async def confirm_basis(test_id: str, scope: ProjectScope, session: Session) -> TestCaseOut:
    """'그대로 맞다' — 기준(basis_seq)을 지금으로."""
    return await test_service.confirm_basis(session, test_id, scope.actor.id, today=today_kst())
