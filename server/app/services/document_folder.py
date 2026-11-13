"""문서 폴더 — 프로젝트 안의 트리 (`docs/api/document.md` '폴더').

이름 겹침 · 고리 · 깊이는 DB 가 아니라 여기서 막는다. 한 프로젝트의 폴더는 많지 않아
트리를 통째로 읽어 따진다.
"""

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, not_found
from app.models import Document, DocumentFolder
from app.models.base import new_id
from app.schemas.document import DocFolderCreate, DocFolderOut, DocFolderPatch
from app.services import access
from app.services.access import Scope
from app.time import now

# 맨 위 폴더가 1단
DEPTH_MAX = 5


def _folder_not_found() -> ApiError:
    return not_found("DOCUMENT_FOLDER_NOT_FOUND", "폴더를 찾을 수 없습니다.")


def _out(folder: DocumentFolder) -> DocFolderOut:
    return DocFolderOut.model_validate(folder)


async def load_folder(session: AsyncSession, folder_id: str) -> DocumentFolder:
    found = await session.get(DocumentFolder, folder_id)
    if found is None:
        raise _folder_not_found()
    return found


async def guard_folder(
    session: AsyncSession, project_id: str, folder_id: str | None, field: str
) -> None:
    """몸에 실린 폴더가 이 프로젝트의 것인지. 아니면 400 — `field` 는 `folderId` · `parentId`."""
    if folder_id is None:
        return
    found = await session.scalar(
        select(DocumentFolder.id).where(
            DocumentFolder.id == folder_id, DocumentFolder.project_id == project_id
        )
    )
    if found is None:
        raise ApiError(
            400, "DOCUMENT_FOLDER_NOT_FOUND", "폴더를 찾을 수 없습니다.", {field: folder_id}
        )


async def _parents(session: AsyncSession, project_id: str) -> dict[str, str | None]:
    """폴더 id → 부모 id, 프로젝트 전부."""
    rows = await session.execute(
        select(DocumentFolder.id, DocumentFolder.parent_id).where(
            DocumentFolder.project_id == project_id
        )
    )
    return dict(rows.tuples().all())


def _depth(parents: dict[str, str | None], folder_id: str | None) -> int:
    """그 폴더의 단 — 맨 위가 1, None(맨 위 자리)은 0."""
    depth = 0
    while folder_id is not None:
        depth += 1
        folder_id = parents.get(folder_id)
    return depth


def _subtree_height(parents: dict[str, str | None], folder_id: str) -> int:
    """그 폴더부터 가장 깊은 하위까지의 단 수 — 하위가 없으면 1."""
    children: dict[str, list[str]] = {}
    for child, parent in parents.items():
        if parent is not None:
            children.setdefault(parent, []).append(child)
    height = 0
    level = [folder_id]
    while level:
        height += 1
        level = [child for node in level for child in children.get(node, [])]
    return height


def _too_deep(parent_id: str | None) -> ApiError:
    return ApiError(
        400,
        "DOCUMENT_FOLDER_TOO_DEEP",
        f"폴더는 {DEPTH_MAX}단까지 만들 수 있습니다.",
        {"parentId": parent_id},
    )


async def _guard_name(
    session: AsyncSession,
    project_id: str,
    parent_id: str | None,
    name: str,
    folder_id: str | None = None,
) -> None:
    """같은 부모 아래 같은 이름(대소문자 그대로)이면 409. 옮기는 폴더 자신은 뺀다."""
    stmt = select(DocumentFolder.id).where(
        DocumentFolder.project_id == project_id,
        DocumentFolder.parent_id.is_(None)
        if parent_id is None
        else DocumentFolder.parent_id == parent_id,
        DocumentFolder.name == name,
    )
    if folder_id is not None:
        stmt = stmt.where(DocumentFolder.id != folder_id)
    if await session.scalar(select(exists(stmt))):
        raise ApiError(
            409,
            "DOCUMENT_FOLDER_NAME_TAKEN",
            "같은 자리에 같은 이름의 폴더가 있습니다.",
            {"name": name},
        )


async def list_folders(session: AsyncSession, project_id: str) -> list[DocFolderOut]:
    """이름순, 같으면 `seq`."""
    rows = await session.scalars(
        select(DocumentFolder)
        .where(DocumentFolder.project_id == project_id)
        .order_by(DocumentFolder.name, DocumentFolder.seq)
    )
    return [_out(row) for row in rows.all()]


async def create_folder(
    session: AsyncSession, project_id: str, payload: DocFolderCreate, scope: Scope
) -> DocFolderOut:
    """프로젝트 멤버 누구나 만든다."""
    await guard_folder(session, project_id, payload.parent_id, "parentId")
    if payload.parent_id is not None:
        parents = await _parents(session, project_id)
        if _depth(parents, payload.parent_id) + 1 > DEPTH_MAX:
            raise _too_deep(payload.parent_id)
    await _guard_name(session, project_id, payload.parent_id, payload.name)
    at = now()
    folder = DocumentFolder(
        id=new_id(),
        project_id=project_id,
        parent_id=payload.parent_id,
        name=payload.name,
        created_by=scope.actor.id,
        created_at=at,
        updated_at=at,
    )
    session.add(folder)
    await session.commit()
    return _out(folder)


async def patch_folder(
    session: AsyncSession, folder_id: str, payload: DocFolderPatch, scope: Scope
) -> DocFolderOut:
    """이름 바꾸기 · 옮기기 — 멤버 누구나. 바뀐 것이 없으면 `updatedAt` 도 그대로다."""
    folder = await load_folder(session, folder_id)
    sent = payload.model_fields_set
    moving = "parent_id" in sent and payload.parent_id != folder.parent_id
    renaming = "name" in sent and payload.name != folder.name
    parent_id = payload.parent_id if moving else folder.parent_id
    name = payload.name if renaming else folder.name

    if moving:
        await guard_folder(session, folder.project_id, parent_id, "parentId")
        parents = await _parents(session, folder.project_id)
        # 새 부모에서 위로 올라가다 자기를 만나면 자기 · 하위 아래로 옮기는 것이다
        node = parent_id
        while node is not None:
            if node == folder.id:
                raise ApiError(
                    400,
                    "DOCUMENT_FOLDER_CYCLE",
                    "폴더를 자기 자신이나 하위 폴더 아래로 옮길 수 없습니다.",
                    {"parentId": parent_id},
                )
            node = parents.get(node)
        # 딸린 하위 폴더까지 함께 내려간다
        if _depth(parents, parent_id) + _subtree_height(parents, folder.id) > DEPTH_MAX:
            raise _too_deep(parent_id)
    if moving or renaming:
        await _guard_name(session, folder.project_id, parent_id, name, folder.id)
        folder.parent_id = parent_id
        folder.name = name
        folder.updated_at = now()
    await session.commit()
    return _out(folder)


async def delete_folder(session: AsyncSession, folder_id: str, scope: Scope) -> None:
    """빈 폴더만 — 관리자 · 만든 사람."""
    folder = await load_folder(session, folder_id)
    if not access.can_delete_folder(scope, folder):
        raise access.forbidden()
    has_child = await session.scalar(
        select(exists().where(DocumentFolder.parent_id == folder.id))
    ) or await session.scalar(select(exists().where(Document.folder_id == folder.id)))
    if has_child:
        raise ApiError(
            409, "DOCUMENT_FOLDER_NOT_EMPTY", "하위 폴더나 문서가 있는 폴더는 지울 수 없습니다."
        )
    await session.delete(folder)
    await session.commit()
