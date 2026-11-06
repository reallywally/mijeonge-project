"""프로필 사진. 계약은 `docs/api/me.md`.

서버는 이미지를 다시 그리지 않는다(라이브러리 없이) — 줄이는 것은 화면 몫이라
모양 · 종류 · 첫머리(매직 넘버) · 크기로만 막는다.
"""

import base64
import binascii
import re
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, not_found
from app.models import MemberAvatar
from app.time import as_utc, now

MAX_BYTES = 512 * 1024
# base64 는 3바이트를 4글자로 싣는다 — 이보다 길면 풀지 않고 바로 넘친다고 본다
_MAX_ENCODED = (MAX_BYTES + 2) // 3 * 4

_DATA_URL = re.compile(r"data:([\w.+-]+/[\w.+-]+);base64,(.*)", re.DOTALL)


def _is_png(data: bytes) -> bool:
    return data.startswith(b"\x89PNG\r\n\x1a\n")


def _is_jpeg(data: bytes) -> bool:
    return data.startswith(b"\xff\xd8\xff")


def _is_webp(data: bytes) -> bool:
    return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"


_TYPES = {"image/png": _is_png, "image/jpeg": _is_jpeg, "image/webp": _is_webp}


def _invalid(reason: str) -> ApiError:
    return ApiError(400, "AVATAR_INVALID", "사진을 읽을 수 없습니다.", {"dataUrl": reason})


def _too_large() -> ApiError:
    reason = "사진이 너무 큽니다. 512 KB 까지 올릴 수 있습니다."
    return ApiError(400, "AVATAR_TOO_LARGE", reason, {"dataUrl": reason})


def avatar_not_found() -> ApiError:
    return not_found("AVATAR_NOT_FOUND", "프로필 사진이 없습니다.")


@dataclass(frozen=True)
class Image:
    content_type: str
    data: bytes


def parse_data_url(data_url: str) -> Image:
    """`data:<type>;base64,<…>` 를 풀어 검사한다. 틀리면 AVATAR_INVALID · AVATAR_TOO_LARGE."""
    found = _DATA_URL.fullmatch(data_url.strip())
    if found is None:
        raise _invalid("data:<종류>;base64,<내용> 꼴이어야 합니다.")
    content_type = found.group(1).lower()
    matches = _TYPES.get(content_type)
    if matches is None:
        raise _invalid("png · jpeg · webp 만 올릴 수 있습니다.")
    encoded = found.group(2)
    if len(encoded) > _MAX_ENCODED:
        raise _too_large()
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise _invalid("base64 내용이 깨졌습니다.") from None
    if len(data) > MAX_BYTES:
        raise _too_large()
    if not matches(data):
        raise _invalid("사진 내용이 알린 종류와 다릅니다.")
    return Image(content_type=content_type, data=data)


def avatar_url(member_id: str, updated_at: datetime | None) -> str | None:
    """`/api/members/{id}/avatar?v=<바뀐 시각 epoch ms>` — 바꾸면 주소가 바뀌어 캐시가 갈린다."""
    if updated_at is None:
        return None
    version = int(as_utc(updated_at).timestamp() * 1000)
    return f"/api/members/{member_id}/avatar?v={version}"


async def put_avatar(session: AsyncSession, member_id: str, data_url: str) -> None:
    image = parse_data_url(data_url)
    found = await session.get(MemberAvatar, member_id)
    if found is None:
        session.add(
            MemberAvatar(
                member_id=member_id,
                content_type=image.content_type,
                data=image.data,
                updated_at=now(),
            )
        )
    else:
        found.content_type = image.content_type
        found.data = image.data
        found.updated_at = now()
    await session.commit()


async def delete_avatar(session: AsyncSession, member_id: str) -> None:
    """없어도 그만이다(멱등)."""
    await session.execute(delete(MemberAvatar).where(MemberAvatar.member_id == member_id))
    await session.commit()


async def load_avatar(session: AsyncSession, member_id: str) -> Image:
    found = await session.get(MemberAvatar, member_id)
    if found is None:
        raise avatar_not_found()
    return Image(content_type=found.content_type, data=found.data)
