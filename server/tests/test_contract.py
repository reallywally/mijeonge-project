"""경계에서 나가는 모양 — 프론트 `web/src/types/domain.ts` 가 읽을 수 있어야 한다."""

from datetime import UTC, datetime, timedelta, timezone

from app.schemas import Schema, Utc

KST = timezone(timedelta(hours=9))


class Sample(Schema):
    thread_id: str
    parent_thread_id: str | None
    created_at: Utc


def _dump(moment: datetime) -> str:
    out = Sample(thread_id="t1", parent_thread_id=None, created_at=moment).model_dump(by_alias=True)
    return str(out["createdAt"])


def test_keys_go_out_in_camel_case() -> None:
    out = Sample(thread_id="t1", parent_thread_id=None, created_at=datetime.now(UTC)).model_dump(
        by_alias=True
    )
    assert set(out) == {"threadId", "parentThreadId", "createdAt"}


def test_camel_case_comes_in_too() -> None:
    """프론트가 보내는 것도 같은 이름이다."""
    sample = Sample.model_validate(
        {"threadId": "t1", "parentThreadId": None, "createdAt": "2026-09-10T00:00:00+09:00"}
    )
    assert sample.thread_id == "t1"


def test_created_at_ends_with_z() -> None:
    """계약은 ISO 8601 UTC 하나다 — 늘 `Z` 로 끝나고 초까지만 낸다 (API.md Q3)."""
    moment = datetime(2026, 9, 10, 8, 30, 15, 123456, tzinfo=UTC)
    assert _dump(moment) == "2026-09-10T08:30:15Z"


def test_offset_is_moved_to_utc_not_carried_out() -> None:
    """오프셋(+09:00)을 섞지 않는다. 한국 시간 9월 10일 0시는 UTC 로 9월 9일 15시다.

    프론트 `localDay` 는 `Z` 로 끝나지 않으면 문자열을 잘라 읽고 만다 — 오프셋이 그대로 나가면
    마침 KST 일 때만 우연히 맞는다.
    """
    out = _dump(datetime(2026, 9, 10, 0, 0, tzinfo=KST))
    assert out == "2026-09-09T15:00:00Z"
    assert "+" not in out


def test_naive_does_not_leak() -> None:
    """tzinfo 가 없으면 UTC 로 본다 — 저장을 UTC 로만 하기 때문이다.

    sqlite 로 도는 검사에서는 오프셋이 버려진 채 돌아온다. 그대로 내보내면 프론트가
    한국 시간으로 읽어 하루가 밀린다.
    """
    out = _dump(datetime(2026, 9, 9, 15, 0))
    assert out == "2026-09-09T15:00:00Z"


def test_json_dump_is_z_too() -> None:
    """model_dump_json(= FastAPI 가 쓰는 길)도 같은 값이어야 한다."""
    body = Sample(
        thread_id="t1", parent_thread_id=None, created_at=datetime(2026, 9, 10, 23, 59, tzinfo=KST)
    ).model_dump_json(by_alias=True)
    assert '"createdAt":"2026-09-10T14:59:00Z"' in body
