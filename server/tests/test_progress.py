"""한국 날짜 — `services/progress.py` 의 `kst_day`(리포트를 걷고 남은 것)."""

from datetime import UTC, date, datetime

from app.services.progress import kst_day


def test_kst_day_moves_to_korean_date() -> None:
    assert kst_day(datetime(2026, 10, 13, 15, 0, tzinfo=UTC)) == date(2026, 10, 14)
    assert kst_day(datetime(2026, 10, 13, 14, 59, tzinfo=UTC)) == date(2026, 10, 13)
    # sqlite 처럼 tzinfo 가 없으면 UTC 로 본다
    assert kst_day(datetime(2026, 10, 13, 15, 0)) == date(2026, 10, 14)
