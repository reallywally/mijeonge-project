"""인증 · 권한 — member 확장 · auth_identity · auth_session · project_member

Revision ID: 0008_auth
Revises: 0007_task_comment
Create Date: 2026-10-13

계약은 `docs/api/auth.md` 의 '테이블' 이다.

- 기존 멤버는 `system_role='user'` · `active=true` · `email=null` 로 채운다.
  이메일이 없으면 로그인할 수 없다 — 관리자가 이메일과 비밀번호를 넣어 줘야 들어온다
- 지금 있는 프로젝트마다 활성 멤버 전부를 `user` 로 부여한다 — 오늘 화면에서 보이던 그대로 시작한다
- 시스템 관리자는 여기서 만들지 않는다. `scripts/create_admin.py` 로 만든다
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008_auth"
down_revision: str | None = "0007_task_comment"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    # 1. member — created_at 은 비워 두고 넣은 뒤 채워서 NOT NULL 로 조인다
    with op.batch_alter_table("member") as batch:
        batch.add_column(sa.Column("email", sa.String(length=254), nullable=True))
        batch.add_column(
            sa.Column("system_role", sa.String(length=16), server_default="user", nullable=False)
        )
        batch.add_column(
            sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False)
        )
        batch.add_column(sa.Column("created_at", UTC_TS, nullable=True))
    op.execute("update member set created_at = CURRENT_TIMESTAMP where created_at is null")
    with op.batch_alter_table("member") as batch:
        batch.alter_column("created_at", existing_type=UTC_TS, nullable=False)
        batch.create_unique_constraint(op.f("uq_member_email"), ["email"])
        batch.create_check_constraint(
            op.f("ck_member_system_role"), "system_role in ('admin', 'user')"
        )

    # 2. 자격 증명 — 멤버와 떼어 둔다. SSO 가 붙으면 줄이 하나 는다
    op.create_table(
        "auth_identity",
        sa.Column("id", ID, nullable=False),
        sa.Column("member_id", ID, nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("subject", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.Column("last_login_at", UTC_TS, nullable=True),
        sa.ForeignKeyConstraint(
            ["member_id"],
            ["member.id"],
            name=op.f("fk_auth_identity_member_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_identity")),
        sa.UniqueConstraint("provider", "subject", name=op.f("uq_auth_identity_provider_subject")),
    )
    op.create_index("ix_auth_identity_member_id", "auth_identity", ["member_id"])

    # 3. 세션 — 토큰은 sha256 만
    op.create_table(
        "auth_session",
        sa.Column("id", ID, nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("member_id", ID, nullable=False),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.Column("expires_at", UTC_TS, nullable=False),
        sa.Column("last_seen_at", UTC_TS, nullable=False),
        sa.ForeignKeyConstraint(
            ["member_id"],
            ["member.id"],
            name=op.f("fk_auth_session_member_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_session")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_auth_session_token_hash")),
    )
    op.create_index("ix_auth_session_member_id", "auth_session", ["member_id"])

    # 4. 프로젝트 부여
    op.create_table(
        "project_member",
        sa.Column("project_id", ID, nullable=False),
        sa.Column("member_id", ID, nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.CheckConstraint("role in ('admin', 'user')", name=op.f("ck_project_member_role")),
        sa.ForeignKeyConstraint(
            ["member_id"], ["member.id"], name=op.f("fk_project_member_member_id")
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["project.id"],
            name=op.f("fk_project_member_project_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "member_id", name=op.f("pk_project_member")),
    )
    op.create_index("ix_project_member_member_id", "project_member", ["member_id"])

    # 오늘 화면에서 보이던 그대로 — 프로젝트마다 활성 멤버 전부를 user 로
    op.execute(
        "insert into project_member (project_id, member_id, role, created_at) "
        "select project.id, member.id, 'user', CURRENT_TIMESTAMP "
        "from project cross join member where member.active"
    )


def downgrade() -> None:
    op.drop_index("ix_project_member_member_id", table_name="project_member")
    op.drop_table("project_member")
    op.drop_index("ix_auth_session_member_id", table_name="auth_session")
    op.drop_table("auth_session")
    op.drop_index("ix_auth_identity_member_id", table_name="auth_identity")
    op.drop_table("auth_identity")
    with op.batch_alter_table("member") as batch:
        batch.drop_constraint(op.f("ck_member_system_role"), type_="check")
        batch.drop_constraint(op.f("uq_member_email"), type_="unique")
        batch.drop_column("created_at")
        batch.drop_column("active")
        batch.drop_column("system_role")
        batch.drop_column("email")
