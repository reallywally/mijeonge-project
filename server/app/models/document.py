from datetime import datetime
from typing import Any

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
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_id
from app.models.risk_analysis import JSON_TYPE

DOC_KINDS = ("text", "sheet")


class Document(Base):
    """여러 안건의 결정을 주제 하나로 묶는 글 · 표 문서 (docs/api/document.md).

    본문은 서버가 해석하지 않는다. 겹쳐 쓰기는 판 번호(`rev`)로 막는다.
    """

    __tablename__ = "document"
    __table_args__ = (
        CheckConstraint(f"kind in {DOC_KINDS}", name="kind"),
        # 연결 줄의 복합 FK 가 이 유니크를 본다 (API.md Q13 과 같은 방식)
        UniqueConstraint("id", "project_id"),
        ForeignKeyConstraint(["part_id", "project_id"], ["part.id", "part.project_id"]),
        # 폴더도 같은 프로젝트의 것만. ON DELETE 를 두지 않는다 — 빈 폴더만 지운다
        ForeignKeyConstraint(
            ["folder_id", "project_id"], ["document_folder.id", "document_folder.project_id"]
        ),
        Index("ix_document_project_id_updated_at", "project_id", "updated_at"),
        Index("ix_document_folder_id", "folder_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Text)
    # 만들 때 고르고 바꾸지 않는다
    kind: Mapped[str] = mapped_column(String(8))
    # text 의 본문(마크다운). sheet 는 ''
    content: Mapped[str] = mapped_column(Text, default="", server_default="")
    # SheetBook { sheets } — 계약의 모양 그대로(camelCase). text 는 { sheets: [] }
    sheet: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE)
    # null 이면 프로젝트 공통
    part_id: Mapped[str | None] = mapped_column(String(36))
    # null 이면 맨 위. 옮겨도 판을 안 올린다
    folder_id: Mapped[str | None] = mapped_column(String(36))
    # 제목 · 본문 · 표의 판 — 서버만 올린다. 연결 · 확인 · 파트는 안 올린다
    rev: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    # 멤버를 지우는 길이 없어 ON DELETE 를 두지 않는다
    created_by: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_by: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 같은 시각에 고친 문서의 순서 — updated_at 다음으로 본다
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)


class DocumentFolder(Base):
    """문서를 묶는 폴더 — 프로젝트 안의 트리. 깊이 · 이름 겹침 · 고리는 서비스가 막는다."""

    __tablename__ = "document_folder"
    __table_args__ = (
        # 하위 폴더 · 문서의 복합 FK 가 이 유니크를 본다
        UniqueConstraint("id", "project_id"),
        # 빈 폴더만 지우니 ON DELETE 를 두지 않는다
        ForeignKeyConstraint(
            ["parent_id", "project_id"], ["document_folder.id", "document_folder.project_id"]
        ),
        Index("ix_document_folder_project_id", "project_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    # null 이면 맨 위
    parent_id: Mapped[str | None] = mapped_column(String(36))
    name: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("member.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 같은 이름의 순서
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)


class DocumentAgenda(Base):
    """문서에 연결한 안건 한 줄. `seen_rev` 가 지금 결정 판보다 작으면 '결정 바뀜' 이다."""

    __tablename__ = "document_agenda"
    __table_args__ = (
        # 문서 · 안건 모두 같은 프로젝트여야 한다. 안건은 논리 삭제라 줄은 남고 읽는 쪽이 거른다
        ForeignKeyConstraint(
            ["document_id", "project_id"],
            ["document.id", "document.project_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["agenda_id", "project_id"], ["agenda.id", "agenda.project_id"], ondelete="CASCADE"
        ),
        Index("ix_document_agenda_agenda_id", "agenda_id"),
    )

    document_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    agenda_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # FK 는 위의 복합 FK 둘뿐이다
    project_id: Mapped[str] = mapped_column(String(36))
    sort_order: Mapped[int] = mapped_column(Integer)
    # 연결 · 확인할 때의 agenda.decision_rev
    seen_rev: Mapped[int] = mapped_column(Integer)
