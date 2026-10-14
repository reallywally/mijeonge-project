from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_id
from app.time import now

PART_NAME_MAX = 50


class Part(Base):
    """프로젝트 안의 보기 범위(docs/api/part.md). 권한이 아니다 — 거르는 것은 화면이다.

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
    """파트 소속. 한 사람이 여러 파트에 속한다. 그 프로젝트에 부여된 사람만 들어온다."""

    __tablename__ = "part_member"
    # 프로젝트에서 사람을 뺄 때 멤버 쪽에서 찾는다
    __table_args__ = (Index("ix_part_member_member_id", "member_id"),)

    part_id: Mapped[str] = mapped_column(
        ForeignKey("part.id", ondelete="CASCADE"), primary_key=True
    )
    member_id: Mapped[str] = mapped_column(ForeignKey("member.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
