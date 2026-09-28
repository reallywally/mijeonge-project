"""계약에 맞춘다 — 접두사 이름 · 부모와 링크의 프로젝트 경계

Revision ID: 0003_contract_gaps
Revises: 0002_task_no
Create Date: 2026-09-28

세 가지를 DB 로 내린다.

1. `project.key_prefix` → `task_key_prefix`, 그리고 프로젝트 사이에 유일 (API.md Q9 · Q20)
2. 부모는 같은 프로젝트 — `task.parent_id` · `thread.parent_thread_id` 를 복합 FK 로 (Q16)
3. 링크 둘에 `project_id` 를 두고 양쪽으로 복합 FK (Q13)

이미 프로젝트를 넘는 링크나 부모가 들어 있는 DB 라면 여기서 멈춘다 — 그게 맞다.
고칠 자리를 알려 주지 않고 넘어가면 화면에서 조용히 틀어진다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003_contract_gaps"
down_revision: str | None = "0002_task_no"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)


def upgrade() -> None:
    # 1. 접두사 — 화면이 쓰는 이름(taskKeyPrefix)과 맞추고, 겹치지 않게 유니크
    with op.batch_alter_table("project") as batch:
        batch.alter_column("key_prefix", new_column_name="task_key_prefix")
    with op.batch_alter_table("project") as batch:
        batch.create_unique_constraint("uq_project_task_key_prefix", ["task_key_prefix"])

    # 2. 부모는 같은 프로젝트. 자기 자신을 참조하는 FK 라 **유니크를 먼저 세우고** 그 다음에 건다 —
    #    한 batch 안에서 둘을 같이 하면 sqlite 가 옛 테이블을 보고 'foreign key mismatch' 를 낸다
    with op.batch_alter_table("task") as batch:
        batch.create_unique_constraint("uq_task_id_project_id", ["id", "project_id"])
    with op.batch_alter_table("task") as batch:
        batch.drop_constraint("fk_task_parent_id", type_="foreignkey")
        batch.create_foreign_key(
            "fk_task_parent_id", "task", ["parent_id", "project_id"], ["id", "project_id"]
        )

    with op.batch_alter_table("thread") as batch:
        batch.create_unique_constraint("uq_thread_id_project_id", ["id", "project_id"])
    with op.batch_alter_table("thread") as batch:
        batch.drop_constraint("fk_thread_parent_thread_id", type_="foreignkey")
        batch.create_foreign_key(
            "fk_thread_parent_thread_id",
            "thread",
            ["parent_thread_id", "project_id"],
            ["id", "project_id"],
        )

    # 링크가 볼 유니크
    with op.batch_alter_table("meeting") as batch:
        batch.create_unique_constraint("uq_meeting_id_project_id", ["id", "project_id"])

    # 3. 링크 둘 — project_id 를 채우고 양쪽을 복합 FK 로 묶는다
    op.add_column("task_thread_link", sa.Column("project_id", ID, nullable=True))
    op.execute(
        "update task_thread_link set project_id = "
        "(select project_id from task where task.id = task_thread_link.task_id)"
    )
    with op.batch_alter_table("task_thread_link") as batch:
        batch.alter_column("project_id", existing_type=ID, nullable=False)
        batch.drop_constraint("fk_task_thread_link_task_id", type_="foreignkey")
        batch.drop_constraint("fk_task_thread_link_thread_id", type_="foreignkey")
        batch.create_foreign_key(
            "fk_task_thread_link_task_id",
            "task",
            ["task_id", "project_id"],
            ["id", "project_id"],
            ondelete="CASCADE",
        )
        batch.create_foreign_key(
            "fk_task_thread_link_thread_id",
            "thread",
            ["thread_id", "project_id"],
            ["id", "project_id"],
            ondelete="CASCADE",
        )

    op.add_column("meeting_task_link", sa.Column("project_id", ID, nullable=True))
    op.execute(
        "update meeting_task_link set project_id = "
        "(select project_id from task where task.id = meeting_task_link.task_id)"
    )
    with op.batch_alter_table("meeting_task_link") as batch:
        batch.alter_column("project_id", existing_type=ID, nullable=False)
        batch.drop_constraint("fk_meeting_task_link_meeting_id", type_="foreignkey")
        batch.drop_constraint("fk_meeting_task_link_task_id", type_="foreignkey")
        batch.create_foreign_key(
            "fk_meeting_task_link_meeting_id",
            "meeting",
            ["meeting_id", "project_id"],
            ["id", "project_id"],
            ondelete="CASCADE",
        )
        batch.create_foreign_key(
            "fk_meeting_task_link_task_id",
            "task",
            ["task_id", "project_id"],
            ["id", "project_id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    with op.batch_alter_table("meeting_task_link") as batch:
        batch.drop_constraint("fk_meeting_task_link_meeting_id", type_="foreignkey")
        batch.drop_constraint("fk_meeting_task_link_task_id", type_="foreignkey")
        batch.create_foreign_key(
            "fk_meeting_task_link_meeting_id",
            "meeting",
            ["meeting_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch.create_foreign_key(
            "fk_meeting_task_link_task_id", "task", ["task_id"], ["id"], ondelete="CASCADE"
        )
        batch.drop_column("project_id")

    with op.batch_alter_table("task_thread_link") as batch:
        batch.drop_constraint("fk_task_thread_link_task_id", type_="foreignkey")
        batch.drop_constraint("fk_task_thread_link_thread_id", type_="foreignkey")
        batch.create_foreign_key(
            "fk_task_thread_link_task_id", "task", ["task_id"], ["id"], ondelete="CASCADE"
        )
        batch.create_foreign_key(
            "fk_task_thread_link_thread_id", "thread", ["thread_id"], ["id"], ondelete="CASCADE"
        )
        batch.drop_column("project_id")

    with op.batch_alter_table("meeting") as batch:
        batch.drop_constraint("uq_meeting_id_project_id", type_="unique")

    with op.batch_alter_table("thread") as batch:
        batch.drop_constraint("fk_thread_parent_thread_id", type_="foreignkey")
        batch.create_foreign_key(
            "fk_thread_parent_thread_id", "thread", ["parent_thread_id"], ["id"]
        )
        batch.drop_constraint("uq_thread_id_project_id", type_="unique")

    with op.batch_alter_table("task") as batch:
        batch.drop_constraint("fk_task_parent_id", type_="foreignkey")
        batch.create_foreign_key("fk_task_parent_id", "task", ["parent_id"], ["id"])
        batch.drop_constraint("uq_task_id_project_id", type_="unique")

    with op.batch_alter_table("project") as batch:
        batch.drop_constraint("uq_project_task_key_prefix", type_="unique")
    with op.batch_alter_table("project") as batch:
        batch.alter_column("task_key_prefix", new_column_name="key_prefix")
