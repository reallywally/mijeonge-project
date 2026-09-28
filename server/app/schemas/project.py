from pydantic import Field

from app.schemas.base import Schema

# 회의에서 'HW-4' 한 마디로 가리키는 값이라 대문자 영숫자로만 받는다 (API.md Q20)
TASK_KEY_PREFIX_PATTERN = r"^[A-Z][A-Z0-9]{0,7}$"


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

    `taskKeyPrefix` 는 **선택**이다 — 안 넣으면 서버가 겹치지 않는 값을 만들어 응답에 실어 준다
    (API.md Q20). 적었는데 형식이 틀렸을 때만 422 다.
    """

    name: str = Field(min_length=1, max_length=200)
    task_key_prefix: str | None = Field(default=None, pattern=TASK_KEY_PREFIX_PATTERN)
