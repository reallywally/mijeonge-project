from app.schemas.base import Schema


class ProjectOut(Schema):
    id: str
    name: str
    # key_prefix 는 내보내지 않는다 — 발번은 서버 일이고 화면의 Project 는 id · name 둘뿐이다


class MemberOut(Schema):
    id: str
    name: str
