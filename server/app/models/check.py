from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_id

# 한 줄의 길이 (docs/api/check.md). 스키마와 CHECK 가 같은 값을 본다
CHECK_TEXT_MAX = 29


class CheckRequest(Base):
    """작업 · 안건에 붙는 '확인해 주세요' 한 줄. 받는 사람 하나에 줄 하나다.

    부하 네 칸은 보낼 때 받는 사람의 것을 찍어 둔다 — 2차 확인율 분석의 바탕이고,
    작업 상태 이력이 없어 나중엔 되살릴 수 없다. 응답에는 싣지 않는다.
    """

    __tablename__ = "check_request"
    __table_args__ = (
        # 작업이나 안건 하나에 꼭 붙는다
        CheckConstraint("(task_id is null) <> (thread_id is null)", name="one_target"),
        CheckConstraint(f"length(text) between 1 and {CHECK_TEXT_MAX}", name="text_length"),
        # 걸린 것과 같은 프로젝트여야 한다 (Q13 · Q16 과 같은 방식). 걸린 것을 지우면 같이 지운다
        ForeignKeyConstraint(
            ["task_id", "project_id"], ["task.id", "task.project_id"], ondelete="CASCADE"
        ),
        ForeignKeyConstraint(
            ["thread_id", "project_id"], ["thread.id", "thread.project_id"], ondelete="CASCADE"
        ),
        Index("ix_check_request_project_id_seq", "project_id", "seq"),
        Index("ix_check_request_recipient_id_confirmed_at", "recipient_id", "confirmed_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    # FK 는 위의 복합 FK 하나씩뿐이다
    task_id: Mapped[str | None] = mapped_column(String(36))
    thread_id: Mapped[str | None] = mapped_column(String(36))
    # 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    sender_id: Mapped[str] = mapped_column(ForeignKey("member.id"))
    recipient_id: Mapped[str] = mapped_column(ForeignKey("member.id"))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # null 이면 대기. 시간이 지나도 바뀌지 않는다 (Q40)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 목록 순서. 한 번에 보낸 줄은 created_at 이 같다 (API.md Q15)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)

    load_open_tasks: Mapped[int] = mapped_column(Integer)
    load_blocked_tasks: Mapped[int] = mapped_column(Integer)
    load_due_soon_tasks: Mapped[int] = mapped_column(Integer)
    load_open_threads: Mapped[int] = mapped_column(Integer)
