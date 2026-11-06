"""한국 날짜로 세는 자리 — 리포트(2026-11-06 걷음)에서 남은 것.

테스트 며칠째 · AI 리스크 분석의 날짜가 같이 쓴다. 날 수는 KST 날짜끼리 뺀다.
"""

from datetime import date, datetime

from app.time import KST, as_utc


def kst_day(moment: datetime) -> date:
    return as_utc(moment).astimezone(KST).date()
