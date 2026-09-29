"""시각을 다루는 자리.

**저장도 내보내기도 UTC 다** (`API.md` 공통 규칙 · Q3). 한국 시간으로 찍는 것은 프론트 몫이고
(`web/src/lib/date.ts` 의 `localDay`), 서버는 오프셋을 섞지 않는다 — 늘 `Z` 로 끝난다.
"""

from datetime import UTC, datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))


def now() -> datetime:
    """지금. 저장값은 늘 UTC aware 다 — naive 를 만들지 않는다."""
    return datetime.now(UTC)


def as_utc(moment: datetime) -> datetime:
    """UTC aware 로 맞춘다.

    tzinfo 가 없으면 UTC 로 본다. 저장을 UTC 로만 하기 때문이고, 테스트의 sqlite 가 오프셋을
    버리고 적힌 벽시계만 돌려주기 때문이다 — 이 자리가 없으면 naive 가 그대로 새어 나가고
    프론트는 그 값을 한국 시간으로 읽어 하루를 민다.
    """
    return moment.astimezone(UTC) if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


def iso_z(moment: datetime) -> str:
    """ISO 8601 UTC · 늘 `Z` 접미. 초까지만 낸다 — 프론트 `nowIso()` 와 같은 모양이다."""
    return as_utc(moment).strftime("%Y-%m-%dT%H:%M:%SZ")


def at(moment: str) -> datetime:
    """픽스처의 createdAt 을 저장값으로. `…Z` 는 그대로, 날짜뿐이면 그날 0시(KST)로 앉힌다."""
    if moment.endswith("Z"):
        return datetime.fromisoformat(moment.replace("Z", "+00:00"))
    return datetime.fromisoformat(moment).replace(tzinfo=KST).astimezone(UTC)
