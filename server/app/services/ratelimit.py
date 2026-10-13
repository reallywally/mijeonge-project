import time
from collections import deque


class RateLimiter:
    """키(IP) 당 분당 횟수. 메모리 카운터라 프로세스마다 따로 센다.

    챗봇 질문과 로그인 시도가 같이 쓴다 — 인스턴스를 따로 두어 서로의 횟수를 먹지 않는다.
    """

    def __init__(self, per_minute: int, window: float = 60.0) -> None:
        self.per_minute = per_minute
        self.window = window
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str, now: float | None = None) -> bool:
        # await 가 없어 이벤트 루프 안에서는 끼어들 틈이 없다
        at = time.monotonic() if now is None else now
        hits = self._hits.setdefault(key, deque())
        while hits and at - hits[0] >= self.window:
            hits.popleft()
        if len(hits) >= self.per_minute:
            return False
        hits.append(at)
        return True

    def reset(self) -> None:
        self._hits.clear()
