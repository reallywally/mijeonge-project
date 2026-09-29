from typing import Annotated

from pydantic import BeforeValidator, Field

from app.schemas.base import Schema

# 회의에서 'HW-4' 한 마디로 가리키는 값이라 대문자 영숫자로만 받는다 (API.md Q20)
TASK_KEY_PREFIX_PATTERN = r"^[A-Z][A-Z0-9]{0,7}$"


def _blank_is_none(value: object) -> object:
    """빈 문자열은 '안 넣은 것' 과 같이 본다 (API.md Q24).

    등록 폼은 입력칸을 비워 두는 것이 정상 경로다 — 그 값을 그대로 실어 보냈다고 해서
    '형식이 틀렸습니다' 가 뜨면 안 된다. 앞뒤 공백도 떼어 준다(접두사에 공백은 못 들어간다).
    """
    if isinstance(value, str):
        return value.strip() or None
    return value


TaskKeyPrefixIn = Annotated[str | None, BeforeValidator(_blank_is_none)]


class ProjectOut(Schema):
    id: str
    name: str
    # 프로젝트 목록 화면이 이 값을 찍는다 — domain.ts 의 Project 와 같은 모양이다 (API.md Q9 · Q22)
    task_key_prefix: str


class MemberOut(Schema):
    id: str
    name: str


class ProjectCreate(Schema):
    """프로젝트 등록. 빈 상태에서 앱을 여는 유일한 길이다 (API.md Q18).

    `taskKeyPrefix` 는 **선택**이다 — 안 넣으면(키가 없거나 빈 문자열이면) 서버가 겹치지 않는
    값을 만들어 응답에 실어 준다 (API.md Q20 · Q24). 적었는데 형식이 틀렸을 때만 422 다.
    """

    name: str = Field(min_length=1, max_length=200)
    task_key_prefix: TaskKeyPrefixIn = Field(default=None, pattern=TASK_KEY_PREFIX_PATTERN)
