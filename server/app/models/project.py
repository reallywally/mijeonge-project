from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_id


class Project(Base):
    __tablename__ = "project"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(200))
    # 작업 키의 접두사 — 'HW-4' 의 'HW'. 회의에서 한 마디로 가리키는 값이라
    # 프로젝트 사이에 겹치지 않는다 (API.md Q9 · Q20)
    task_key_prefix: Mapped[str] = mapped_column(String(16), unique=True)
    # 마지막으로 써 버린 작업 번호. 최댓값+1 로 세지 않는다 —
    # 지운 뒤 번호가 재사용되고, 동시에 등록하면 같은 번호가 둘 나온다
    last_task_no: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0", default=0
    )


class Member(Base):
    __tablename__ = "member"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(100))
