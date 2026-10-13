"""첫 시스템 관리자를 만든다 — 화면에는 그 길이 없다 (docs/api/auth.md '테이블').

    uv run python -m scripts.create_admin --email a@b.com --name 홍길동

비밀번호는 프롬프트로 받는다(명령줄에 남지 않게). 그 이메일의 멤버가 이미 있으면 시스템 관리자로
올리고 활성으로 되돌린 뒤 비밀번호를 새로 건다 — 그 사람의 세션은 모두 끊긴다.
"""

import argparse
import asyncio
import getpass
import sys

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine, session_factory
from app.models import Member, new_id
from app.schemas.auth import Email, MemberName, Password
from app.services import member as member_service
from app.time import now


async def create_admin(session: AsyncSession, email: str, name: str, password: str) -> Member:
    """만들거나 올린다. 커밋한다."""
    member = (
        await session.execute(select(Member).where(Member.email == email))
    ).scalar_one_or_none()
    if member is None:
        member = Member(id=new_id(), name=name, email=email, created_at=now())
        session.add(member)
    member.system_role = "admin"
    member.active = True
    await session.flush()
    # 해시 · 세션 끊기는 관리 API 와 같은 길로 간다
    await member_service.set_password(session, member.id, password)
    return member


def _read_password() -> str:
    first = getpass.getpass("비밀번호 (10자 이상): ")
    second = getpass.getpass("비밀번호 확인: ")
    if first != second:
        sys.exit("두 비밀번호가 다릅니다.")
    try:
        return TypeAdapter(Password).validate_python(first)
    except ValidationError:
        sys.exit("비밀번호는 10자 이상 · 200자 이하입니다.")


async def run(email: str, name: str, password: str) -> None:
    async with session_factory() as session:
        member = await create_admin(session, email, name, password)
        print(f"시스템 관리자 준비 완료 — {member.name} <{member.email}> (id {member.id})")
    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="시스템 관리자를 만든다")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    args = parser.parse_args()
    try:
        email = TypeAdapter(Email).validate_python(args.email)
        name = TypeAdapter(MemberName).validate_python(args.name)
    except ValidationError:
        sys.exit("이메일 또는 이름이 올바르지 않습니다.")
    asyncio.run(run(email, name, _read_password()))


if __name__ == "__main__":
    main()
