from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_id
from app.time import now

PART_NAME_MAX = 50


class Part(Base):
    """프로젝트 안의 묶음(docs/api/part.md). 보기는 열려 있고, 작업 · 테스트의 등록 · 수정 · 삭제를
    소속의 권한(`PartMember.can_*`)으로 가른다 — 안건은 파트 권한을 타지 않는다.

    지우지 않고 보관한다(`active=false`) — 지난 작업 · 안건이 가리킨다.
    """

    __tablename__ = "part"
    __table_args__ = (
        # 보관한 것까지 이름이 겹치면 안 된다 — 되살릴 때 둘이 된다
        UniqueConstraint("project_id", "name"),
        # 작업 · 안건의 복합 FK 가 참조할 자리 — 다른 프로젝트의 파트를 못 달게
        UniqueConstraint("id", "project_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(PART_NAME_MAX))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class PartMember(Base):
    """파트 소속과 그 파트에서의 권한. 한 사람이 여러 파트에 속한다. 그 프로젝트에 부여된 사람만.

    삭제 ⇒ 수정, 등록 · 수정 ⇒ 보기 — 쓸 때마다 서비스가 맞춘다(`part.normalize_rights`).
    """

    __tablename__ = "part_member"
    # 프로젝트에서 사람을 뺄 때 멤버 쪽에서 찾는다
    __table_args__ = (Index("ix_part_member_member_id", "member_id"),)

    part_id: Mapped[str] = mapped_column(
        ForeignKey("part.id", ondelete="CASCADE"), primary_key=True
    )
    member_id: Mapped[str] = mapped_column(ForeignKey("member.id"), primary_key=True)
    # 보기는 목록의 기본 거르기, 나머지는 그 파트 작업 · 테스트의 권한이다
    can_view: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    can_create: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    can_update: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    # 지우기만 기본이 끔이다 — 새로 넣은 사람이 남의 기록을 없애지 않게
    can_delete: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
