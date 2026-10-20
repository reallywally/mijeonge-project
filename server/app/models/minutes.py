from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Identity, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_id


class Minutes(Base):
    """회의록 한 편 — 게시판의 글. 본문은 받은 글 그대로다(양식을 건드리지 않는다).

    여기서 [등록] 한 안건 · 이력 · 작업은 `minutes_id` 로 이곳을 가리킨다.
    지우면 그 줄들은 남고 `minutes_id` 만 비는다 (docs/api/minutes.md, Q48).
    """

    __tablename__ = "minutes"
    __table_args__ = (Index("ix_minutes_project_id_seq", "project_id", "seq"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Text)
    # 사람이 고른 날짜. 없으면 AI 정리가 본문에서 읽는다
    meeting_date: Mapped[date | None] = mapped_column(Date)
    body: Mapped[str] = mapped_column(Text)
    # [등록] 때 초안의 요약으로 바뀐다. 빈 값은 null 이 아니라 '' 다
    summary: Mapped[str] = mapped_column(Text, default="", server_default="")
    # 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    author_id: Mapped[str] = mapped_column(ForeignKey("member.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 사람이 고친 때. [등록] 이 요약을 바꿔도 그대로다
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 같은 회의 날짜끼리의 순서 (API.md Q15)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
