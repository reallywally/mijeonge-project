from uuid import uuid4

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

# 제약 이름을 규칙으로 고정한다 — 이름이 자동으로 정해지면 마이그레이션 diff 가 매번 흔들린다
NAMING = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


def new_id() -> str:
    """프론트가 id 를 문자열로 들고 있다(`id: string`). DB 시퀀스 대신 uuid4 를 문자열로 쓴다."""
    return uuid4().hex
