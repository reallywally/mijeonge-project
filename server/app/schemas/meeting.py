from datetime import date

from app.schemas.base import Schema
from app.schemas.thread import EntryCreate, EntryOut, ThreadOut


class MeetingMemoOut(Schema):
    id: str
    text: str
    promoted_thread_id: str | None


class MeetingOut(Schema):
    id: str
    project_id: str
    title: str
    date: date
    attendee_ids: list[str]
    memos: list[MeetingMemoOut]


class NewThreadIn(Schema):
    """회의 중에 처음 만든 안건.

    아직 id 가 없어 화면이 tempId 로 가리킨다 — 서버가 실제 id 를 붙여 돌려준다.
    """

    temp_id: str
    title: str
    owner_id: str | None = None
    # 이 회의에서 만든 다른 안건의 tempId 일 수도 있다
    parent_thread_id: str | None = None


class MeetingEntryIn(EntryCreate):
    """회의 밖 줄과 같은 모양에 어느 안건인지만 더한다 — 둘의 차이는 meeting_id 하나뿐이다."""

    # 실제 안건 id 또는 newThreads 의 tempId
    thread_id: str


class MeetingMemoIn(Schema):
    text: str
    # 이 메모를 안건으로 올렸다면 그 안건. tempId 일 수도, 이미 있는 안건 id 일 수도 있다
    promoted_temp_id: str | None = None


class MeetingCreate(Schema):
    """`domain.ts` 의 MeetingInput 그대로."""

    title: str
    date: date
    attendee_ids: list[str] = []
    new_threads: list[NewThreadIn] = []
    entries: list[MeetingEntryIn] = []
    memos: list[MeetingMemoIn] = []


class MeetingSaved(Schema):
    """회의 하나가 안건 · 줄 · 상태까지 한꺼번에 바꾼다 — 바뀐 것을 다 돌려준다.

    `threads` 는 이 저장으로 바뀐 안건 전부다(새로 만든 것 + 상태나 담당자가 바뀐 기존 안건).
    `thread_id_by_temp_id` 로 화면이 방금 만든 안건을 실제 id 로 가리킬 수 있다.
    """

    meeting: MeetingOut
    threads: list[ThreadOut]
    entries: list[EntryOut]
    thread_id_by_temp_id: dict[str, str]
