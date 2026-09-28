"""경계에서 나가는 모양 — 프론트 `web/src/types/domain.ts` 가 읽을 수 있어야 한다."""

from datetime import UTC, datetime, timedelta, timezone

from app.schemas import DayStamp, Schema
from app.time import day_of


class Sample(Schema):
    thread_id: str
    parent_thread_id: str | None
    created_at: DayStamp


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


def test_created_at_is_cut_to_a_day() -> None:
    """시각을 실어 보내면 프론트 monthDay 가 '9월 NaN일' 을 찍는다 — 날짜로 자른다."""
    moment = datetime(2026, 9, 10, 8, 30, tzinfo=timezone(timedelta(hours=9)))
    out = Sample(thread_id="t1", parent_thread_id=None, created_at=moment).model_dump(by_alias=True)
    assert out["createdAt"] == "2026-09-10"


def test_cut_happens_in_kst_not_utc() -> None:
    """한국 시간 9월 10일 0시는 UTC 로 9월 9일 15시다. UTC 로 자르면 하루가 밀린다."""
    utc_moment = datetime(2026, 9, 9, 15, 0, tzinfo=UTC)
    assert day_of(utc_moment).isoformat() == "2026-09-10"

    out = Sample(thread_id="t1", parent_thread_id=None, created_at=utc_moment).model_dump(
        by_alias=True
    )
    assert out["createdAt"] == "2026-09-10"


def test_json_dump_cuts_too() -> None:
    """model_dump_json(= FastAPI 가 쓰는 길)도 같은 값이어야 한다."""
    moment = datetime(2026, 9, 10, 23, 59, tzinfo=timezone(timedelta(hours=9)))
    body = Sample(thread_id="t1", parent_thread_id=None, created_at=moment).model_dump_json(
        by_alias=True
    )
    assert '"createdAt":"2026-09-10"' in body
