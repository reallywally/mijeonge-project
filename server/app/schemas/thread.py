from typing import Literal

from app.schemas.base import Schema, Utc

EntryKindIn = Literal["raise", "defer", "decide", "refine", "change", "split"]


class ThreadOut(Schema):
    id: str
    project_id: str
    title: str
    state: str
    owner_id: str | None
    parent_thread_id: str | None
    created_at: Utc


class EntryOut(Schema):
    """(회의 × 안건) 한 줄. meeting_id 가 null 이면 회의 밖에서 처리한 줄이다."""

    id: str
    thread_id: str
    meeting_id: str | None
    kind: str
    text: str
    # entry_detail 행을 문자열 배열로 편다 — 화면이 string[] 로 들고 있다
    detail: list[str]
    note: str
    owner_id: str | None
    created_at: Utc


class ThreadCreate(Schema):
    """회의와 무관하게 먼저 등록해 두는 안건. 등록만 된 상태가 'queued' 다."""

    title: str
    owner_id: str | None = None


class EntryCreate(Schema):
    """회의 밖 줄. meeting_id 는 서버가 null 로 고정한다 — 어느 회의에도 붙지 않는다.

    화면(`addOutsideEntry`)은 decide · refine · defer 셋만 보내지만 kind 전부를 받는다.
    회의에서 남긴 줄(`MeetingEntryIn`)은 여기에 threadId 만 더한 모양이다.
    """

    kind: EntryKindIn
    text: str
    detail: list[str] = []
    note: str = ""
    owner_id: str | None = None


class EntryAdded(Schema):
    """줄 하나가 안건 상태까지 바꾼다 — 바뀐 둘을 같이 돌려준다(스냅샷을 다시 받지 않게)."""

    entry: EntryOut
    thread: ThreadOut
