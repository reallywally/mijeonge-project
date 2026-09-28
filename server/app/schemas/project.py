from app.schemas.base import Schema


class ProjectOut(Schema):
    id: str
    name: str
    # key_prefix 는 내보내지 않는다 — 발번은 서버 일이고 화면의 Project 는 id · name 둘뿐이다


class MemberOut(Schema):
    id: str
    name: str


class ProjectCreate(Schema):
    """화면에 프로젝트 등록이 아직 없어 계약이 없는 자리다.
    key_prefix 는 작업 발번에 꼭 필요해서 필수로 받는다."""

    name: str
    key_prefix: str
