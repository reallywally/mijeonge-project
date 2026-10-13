from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_id
from app.time import now


class AuthIdentity(Base):
    """멤버의 자격 증명. 멤버와 떼어 둔 것은 SSO(OIDC)를 줄 하나로 더하려고다.

    `password` 의 subject 는 로그인 이메일(소문자)이다 — 이메일을 바꾸면 같이 바꾼다.
    """

    __tablename__ = "auth_identity"
    __table_args__ = (
        UniqueConstraint("provider", "subject"),
        Index("ix_auth_identity_member_id", "member_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    member_id: Mapped[str] = mapped_column(ForeignKey("member.id", ondelete="CASCADE"))
    # 'password' | 훗날 'oidc:<이름>'
    provider: Mapped[str] = mapped_column(String(64))
    subject: Mapped[str] = mapped_column(String(320))
    # argon2. password 일 때만 있다
    password_hash: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuthSession(Base):
    """로그인 세션. 쿠키의 토큰은 sha256 으로만 둔다 — DB 가 새도 세션을 못 훔친다."""

    __tablename__ = "auth_session"
    __table_args__ = (Index("ix_auth_session_member_id", "member_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    member_id: Mapped[str] = mapped_column(ForeignKey("member.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 요청마다 쓰지 않는다 — 한 시간에 한 번만 밀어 준다
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
