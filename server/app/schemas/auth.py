from typing import Annotated, Literal

from pydantic import AfterValidator, Field, StringConstraints, field_validator
from pydantic_core import PydanticCustomError

from app.schemas.base import Schema, Utc

SystemRole = Literal["admin", "user"]
ProjectRole = Literal["admin", "user"]

# 길이 말고 조합 규칙은 두지 않는다 (docs/api/auth.md '비밀번호 규칙')
Password = Annotated[str, Field(min_length=10, max_length=200)]
MemberName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


def _blank_to_none(value: str | None) -> str | None:
    return value or None


# 경력 · 기술 스펙 · 기타 사항 — 자유 글. 비우면(공백뿐이어도) null 로 둔다
ProfileText = Annotated[
    Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] | None,
    AfterValidator(_blank_to_none),
]


def _email(value: str) -> str:
    # EmailStr 은 `.local` 같은 사내 도메인을 막는다 — 모양만 본다
    if value.count("@") != 1 or value.startswith("@") or value.endswith("@") or " " in value:
        raise ValueError("이메일 형식이 올바르지 않습니다.")
    return value


# 소문자로만 저장한다 — 대소문자만 다른 두 계정이 생기지 않게
Email = Annotated[
    str,
    StringConstraints(strip_whitespace=True, to_lower=True, min_length=3, max_length=254),
    AfterValidator(_email),
]


class LoginInput(Schema):
    # 모양이 틀린 이메일도 401 로 받는다 — 무엇이 틀렸는지 가르지 않는다
    email: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=254)]
    password: Annotated[str, Field(max_length=200)]


class PasswordChange(Schema):
    current_password: Annotated[str, Field(max_length=200)]
    new_password: Password


class MeOut(Schema):
    id: str
    name: str
    email: str
    system_role: SystemRole
    # 부여받은 프로젝트만 싣는다 — 시스템 관리자가 부여 없이 보는 프로젝트는 없다
    project_roles: dict[str, ProjectRole]


class MemberAccountOut(Schema):
    id: str
    name: str
    email: str | None
    system_role: SystemRole
    active: bool
    career: str | None
    skills: str | None
    notes: str | None
    has_password: bool
    created_at: Utc
    last_login_at: Utc | None


class MemberAccountCreate(Schema):
    name: MemberName
    email: Email
    password: Password
    system_role: SystemRole = "user"
    career: ProfileText = None
    skills: ProfileText = None
    notes: ProfileText = None


class MemberAccountPatch(Schema):
    """보낸 것만 바꾼다. null 은 받지 않는다 — 이메일을 지우는 길은 없다.
    경력 · 기술 스펙 · 기타 사항만 null(또는 빈 글)로 비울 수 있다."""

    name: MemberName | None = None
    email: Email | None = None
    system_role: SystemRole | None = None
    active: bool | None = None
    career: ProfileText = None
    skills: ProfileText = None
    notes: ProfileText = None

    @field_validator("name", "email", "system_role", "active")
    @classmethod
    def _not_null(cls, value: object) -> object:
        # 기본값(None)에는 안 돈다 — 화면이 명시적으로 null 을 보낸 경우만 걸린다
        if value is None:
            raise PydanticCustomError("null_not_allowed", "null 로 비울 수 없는 값입니다.")
        return value


class PasswordSet(Schema):
    password: Password


class ProjectMemberOut(Schema):
    member_id: str
    role: ProjectRole


class ProjectMemberPut(Schema):
    role: ProjectRole
