"""시각을 다루는 자리. 표시 기준은 한국 시간 하나뿐이다(사내 서비스)."""

from datetime import date, datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))


def at_day_start(day: str) -> datetime:
    """`YYYY-MM-DD` → 그날 0시 KST."""
    return datetime.fromisoformat(day).replace(tzinfo=KST)


def day_of(moment: datetime) -> date:
    """timestamptz 를 KST 기준 날짜로 자른다.

    UTC 로 자르면 9시간 앞의 하루가 밀린다 — 한국 시간 9월 10일 오전 8시가 9월 9일이 된다.
    tzinfo 가 없으면 KST 로 본다(테스트의 sqlite 는 오프셋을 버리고 적힌 벽시계만 돌려준다).
    """
    if moment.tzinfo is None:
        return moment.date()
    return moment.astimezone(KST).date()
