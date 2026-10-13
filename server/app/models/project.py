from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_id
from app.time import now

# 시스템 역할과 프로젝트 역할은 둘 다 이 둘이다 — 권한 셋은 그 조합으로 나온다 (docs/api/auth.md)
ROLES = ("admin", "user")


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
    """지우지 않고 비활성화한다 — 작업 담당자 · 댓글 작성자 · 이력이 가리킨다."""

    __tablename__ = "member"
    __table_args__ = (CheckConstraint(f"system_role in {ROLES}", name="system_role"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(100))
    # 소문자로만 저장한다. 없으면 로그인할 수 없다 — 옛 멤버는 관리자가 넣어 줘야 들어온다
    email: Mapped[str | None] = mapped_column(String(254), unique=True)
    system_role: Mapped[str] = mapped_column(String(16), default="user", server_default="user")
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ProjectMember(Base):
    """프로젝트 부여. 줄이 없으면 그 프로젝트는 없는 것처럼 보인다(시스템 관리자 말고)."""

    __tablename__ = "project_member"
    __table_args__ = (
        CheckConstraint(f"role in {ROLES}", name="role"),
        # 내 프로젝트 목록 · Me.projectRoles 가 멤버 쪽에서 찾는다
        Index("ix_project_member_member_id", "member_id"),
    )

    project_id: Mapped[str] = mapped_column(
        ForeignKey("project.id", ondelete="CASCADE"), primary_key=True
    )
    member_id: Mapped[str] = mapped_column(ForeignKey("member.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
