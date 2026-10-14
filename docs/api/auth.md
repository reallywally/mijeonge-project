# 인증 · 권한 · 사용자 관리 — 초안 (2026-10-13)

로그인이 없어 "나" 를 머리글에서 골랐고(Q12), 서버는 누가 부르는지 몰랐다. 이 절이 그것을 바꾼다.
순서는 `server/PLAN.md` 8단계 · `web/PLAN.md` 8단계다.

## 정해 둔 것 (사용자 결정 2026-10-13)

| | 결정 | 왜 |
| --- | --- | --- |
| 계정 | **관리자가 우리 DB 에 손으로 등록한다.** 스스로 가입하는 길은 없다 | 사내 도구다. 아무나 계정을 만들면 안 된다 |
| 로그인 | 이메일 + 비밀번호. **나중에 SSO(OIDC)를 더할 수 있게** 자격 증명을 멤버와 떼어 둔다 | 아래 '테이블' — SSO 가 붙어도 `member` 와 권한은 그대로이고 `auth_identity` 에 줄이 하나 늘 뿐이다 |
| 권한 | **셋** — 시스템 관리자(system admin) · 프로젝트 관리자(project admin) · 일반 사용자(user) | 사용자 결정. 상세 기능은 필요할 때 더한다 |
| 관리 범위 | 사용자 자체 관리 + 프로젝트별 사용자 부여 **두 가지만** | 사용자 결정 |
| 세션 | **서버 세션 + HttpOnly 쿠키.** JWT 를 쓰지 않는다 | 비활성화 · 비밀번호 변경 · 로그아웃이 그 순간 먹어야 한다. JWT 는 만료까지 못 거둔다. Vite 가 `/api` 를 넘겨 같은 출처라 쿠키가 그냥 붙는다 |
| 지우기 | 멤버는 **지우지 않고 비활성화**한다 | 작업 담당자 · 댓글 작성자 · 이력이 멤버를 가리킨다. 지우면 기록이 거짓말을 하거나 FK 가 500 을 낸다 |

## 권한 셋

| 권한 | 어디에 붙나 | 할 수 있는 것 |
| --- | --- | --- |
| 시스템 관리자 | `member.system_role = 'admin'` | **전부.** 모든 프로젝트를 멤버가 아니어도 보고 고친다. 사용자 관리 · 프로젝트 등록 · 모든 프로젝트의 멤버 부여 |
| 프로젝트 관리자 | `project_member.role = 'admin'` | 그 프로젝트에서 user 가 하는 것 전부 + **그 프로젝트의 멤버 부여 · 역할 변경 · 빼기**, 프로젝트 이름 수정 |
| 일반 사용자 | `project_member.role = 'user'` | 부여받은 프로젝트를 읽고 쓴다 — 작업 · 안건 · 이력 · 링크 · 댓글 · 챗봇. 지금 화면이 하는 일 전부 |

- 시스템 역할은 `admin` · `user` 둘이다. 프로젝트 역할도 `admin` · `user` 둘이다. **셋은 이 둘의 조합으로 나온다**
- 부여받지 않은 프로젝트는 **없는 것처럼** 다룬다 — 목록에 안 나오고, 직접 부르면 404 `PROJECT_NOT_FOUND`
  (403 을 내면 그런 프로젝트가 있다는 것을 알려 준다). 부여는 받았는데 권한이 모자라면 403 `FORBIDDEN`
- 비활성 멤버는 로그인할 수 없고 남아 있던 세션도 모두 끊긴다
- **마지막 활성 시스템 관리자**는 비활성화하거나 `user` 로 내릴 수 없다 — 409 `LAST_SYSTEM_ADMIN`.
  아무도 사용자를 관리할 수 없는 상태를 만들지 않는다
- 프로젝트 등록(`POST /api/projects`)은 **시스템 관리자만**. 등록한 사람이 그 프로젝트의 관리자로 붙지는 않는다
  (시스템 관리자는 붙지 않아도 다 할 수 있다) — 관리자를 따로 부여한다

## 테이블

```
member            id · name · email(unique, 소문자로 저장) · system_role('admin'|'user') · active
                  · career · skills · notes(자유 글, 비면 null) · created_at
auth_identity     id · member_id → member · provider('password' | 훗날 'oidc:<이름>') · subject
                  · password_hash(password 일 때만) · created_at · last_login_at
                  unique(provider, subject)
auth_session      id · token_hash(unique) · member_id → member · created_at · expires_at · last_seen_at
project_member    project_id → project(cascade) · member_id → member · role('admin'|'user') · created_at
                  pk(project_id, member_id)
```

- **SSO 를 더할 때** — `provider='oidc:google'`, `subject` 에 IdP 의 `sub` 를 넣는 줄을 늘린다.
  처음 SSO 로 들어온 사람은 `email` 로 기존 멤버에 잇는다(없으면 거절 — 등록은 여전히 관리자가 한다).
  `member` · `project_member` · 세션 · 권한 검사는 하나도 안 바뀐다
- `password` 의 `subject` 는 로그인 이메일(소문자)이다. 이메일을 바꾸면 `subject` 도 같이 바꾼다
- 비밀번호는 **argon2** 로 해시한다. 원문 · 해시를 응답에도 로그에도 싣지 않는다
- 세션 토큰은 32바이트 난수(`secrets.token_urlsafe`)를 쿠키로 주고 **DB 에는 sha256 만** 둔다 — DB 가 새도 세션을 못 훔친다
- 세션 수명: 마지막 요청에서 **14일**(미끄러지는 만료). `last_seen_at` 갱신은 1시간에 한 번만 쓴다
- 기존 멤버(u1 ~ u4)는 리비전이 `system_role='user'` · `active=true` · `email=null` 로 채운다.
  **`email` 이 없으면 로그인할 수 없다** — 관리자가 이메일과 비밀번호를 넣어 줘야 들어온다.
  리비전은 지금 있는 프로젝트마다 모든 활성 멤버를 `user` 로 부여한다(오늘 화면에서 보이던 그대로 시작한다)
- 첫 시스템 관리자는 화면이 아니라 **명령으로** 만든다 —
  `uv run python -m scripts.create_admin --email a@b.com --name 홍길동` (비밀번호는 프롬프트로 받는다).
  시드는 개발용으로 `admin@innoflow.local` / `innoflow-admin` 시스템 관리자 하나와 u1 ~ u4 에 이메일 · 같은 개발용 비밀번호를 넣는다

## 쿠키

| | |
| --- | --- |
| 이름 | `innoflow_session` |
| 속성 | `HttpOnly` · `SameSite=Lax` · `Path=/api` · 운영에서는 `Secure`(설정 `cookie_secure`) |
| CSRF | `SameSite=Lax` + **쓰기 요청은 `Content-Type: application/json` 만 받는다**(폼 전송으로는 못 만든다). 따로 토큰을 두지 않는다 |

## 새 응답 · 요청 모양

```ts
export type SystemRole = 'admin' | 'user'
export type ProjectRole = 'admin' | 'user'

/** GET /api/auth/me · POST /api/auth/login */
export interface Me {
  id: string
  name: string
  email: string
  systemRole: SystemRole
  /** 내가 부여받은 프로젝트와 역할. 시스템 관리자는 부여받지 않은 프로젝트도 다 보지만 여기에는 부여받은 것만 실린다 */
  projectRoles: Record<string, ProjectRole>
}

/** 관리 화면용 — GET /api/admin/members */
export interface MemberAccount {
  id: string
  name: string
  email: string | null
  systemRole: SystemRole
  active: boolean
  /** 경력 · 기술 스펙 · 기타 사항 — 관리자가 적는 자유 글(각 2000자까지). 비어 있으면 null */
  career: string | null
  skills: string | null
  notes: string | null
  /** 비밀번호가 걸려 있는지 — 없으면 로그인할 수 없다 */
  hasPassword: boolean
  createdAt: string
  lastLoginAt: string | null
}

/** GET /api/projects/{projectId}/members */
export interface ProjectMember {
  memberId: string
  role: ProjectRole
}
```

- `Member`(`id` · `name`)는 그대로다. **`GET /api/members` 는 비활성 멤버까지 이름을 다 낸다** —
  옛 작업의 담당자 이름을 찍으려면 필요하다. 담당자를 **고르는** 자리는 `ProjectMember` 로 거른다
- `Member` 에 `active: boolean` 이 늘어난다 — 고르는 자리에서 비활성 멤버를 빼고, 이름 옆에 '(비활성)' 을 찍는다

## 엔드포인트

**`/api/health` · `POST /api/auth/login` 말고는 전부 로그인이 필요하다.** 쿠키가 없거나 세션이 끝났으면 401 `UNAUTHENTICATED`.

### 로그인 · 나

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | `{ email, password }`. 맞으면 세션 쿠키를 굽는다. 틀리면 401 `INVALID_CREDENTIALS` — **이메일이 없는지 · 비밀번호가 틀렸는지 · 비활성인지 가르지 않는다**. IP 당 분당 10회, 넘으면 429 `TOO_MANY_ATTEMPTS` | `Me` |
| POST | `/api/auth/logout` | 이 세션을 지우고 쿠키를 비운다. 세션이 없어도 204 (멱등) | 204 |
| GET | `/api/auth/me` | 지금 로그인한 사람. 화면이 부팅할 때 맨 먼저 부른다 | `Me` |
| POST | `/api/auth/password` | `{ currentPassword, newPassword }` — 내 비밀번호 바꾸기. 현재 비밀번호가 틀리면 400 `INVALID_CREDENTIALS`. **이 세션 말고 내 다른 세션은 모두 끊는다** | 204 |

비밀번호 규칙: **10자 이상 · 200자 이하**. 그 밖의 조합 규칙은 두지 않는다. 어기면 422.

### 사용자 관리 — 시스템 관리자만 (그 밖은 403 `FORBIDDEN`)

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| GET | `/api/admin/members` | 전체 멤버 — 비활성 포함, 이름 순 | `MemberAccount[]` |
| POST | `/api/admin/members` | `{ name, email, password, systemRole, career?, skills?, notes? }` 등록. 이메일이 겹치면 409 `EMAIL_TAKEN` | `MemberAccount` · 201 |
| PATCH | `/api/admin/members/{memberId}` | `{ name?, email?, systemRole?, active?, career?, skills?, notes? }` 부분 수정. `career` · `skills` · `notes` 는 `null` 이나 빈 글로 비운다(나머지는 `null` 을 받지 않는다). 비활성으로 바꾸면 그 사람의 세션을 모두 끊는다. 마지막 시스템 관리자를 내리거나 끄면 409 `LAST_SYSTEM_ADMIN`. 없는 멤버는 404 `MEMBER_NOT_FOUND` | `MemberAccount` |
| PUT | `/api/admin/members/{memberId}/password` | `{ password }` — 비밀번호를 새로 건다(잊었을 때 · 처음 로그인시킬 때). 그 사람의 세션을 모두 끊는다. `email` 이 없으면 400 `MEMBER_EMAIL_REQUIRED` | 204 |

- 자기 자신도 이 API 로 고칠 수 있다 — 다만 위의 '마지막 시스템 관리자' 규칙에 걸린다
- 멤버 삭제는 없다 (위 '지우기')

### 프로젝트 멤버 — 그 프로젝트의 관리자 또는 시스템 관리자

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| GET | `/api/projects/{projectId}/members` | 그 프로젝트에 부여된 사람과 역할. **그 프로젝트의 user 도 부를 수 있다** — 담당자 고르는 자리가 쓴다 | `ProjectMember[]` |
| PUT | `/api/projects/{projectId}/members/{memberId}` | `{ role }` — 부여하거나 역할을 바꾼다 (멱등). 비활성 멤버는 400 `MEMBER_INACTIVE`, 없는 멤버는 404 `MEMBER_NOT_FOUND` | `ProjectMember` |
| DELETE | `/api/projects/{projectId}/members/{memberId}` | 빼기 (멱등). 그 사람이 담당하던 작업 · 안건은 **그대로 둔다** — 기록이다 | 204 |
| PATCH | `/api/projects/{projectId}` | `{ name }` — 프로젝트 이름 수정 | `Project` |

- 프로젝트 관리자가 **자기 자신을 빼거나 `user` 로 내리는 것은 된다** — 그 프로젝트에 다른 관리자가 없어도 시스템 관리자가 있으니 막지 않는다

### 이미 있는 API 에서 바뀌는 것

| 자리 | 바뀌는 것 |
| --- | --- |
| `GET /api/projects` | **내가 볼 수 있는 프로젝트만.** 시스템 관리자는 전부. 빈 배열이면 화면은 '부여받은 프로젝트가 없습니다 — 관리자에게 요청하세요' 를 띄운다(시스템 관리자만 등록 화면으로 간다) |
| `POST /api/projects` | 시스템 관리자만. 그 밖은 403 `FORBIDDEN` |
| `/api/projects/{projectId}/...` 전부 · `/api/tasks/...` · `/api/threads/...` · `/api/comments/...` | 그 프로젝트에 부여받았거나 시스템 관리자여야 한다. 아니면 404 (`PROJECT_NOT_FOUND` · `TASK_NOT_FOUND` · `THREAD_NOT_FOUND` · `COMMENT_NOT_FOUND` — 원래 없을 때와 같은 코드) |
| 담당자 지정 (`ownerId` — 작업 · 안건 등록 · 수정 · 한 번에 등록 · 이력) | **새로 지정하는** 담당자는 그 프로젝트의 활성 멤버여야 한다. 아니면 지금처럼 400(`TASK_OWNER_NOT_FOUND` 등 지금 코드 그대로). 이미 걸려 있던 담당자를 그대로 두는 수정은 막지 않는다 |
| `POST /api/tasks/{taskId}/comments` | **`authorId` 를 받지 않는다** — 작성자는 로그인한 사람이다. 보내도 무시한다 |
| `PATCH` · `DELETE /api/comments/{commentId}` | 고치기는 **작성자만**, 지우기는 작성자 · 그 프로젝트 관리자 · 시스템 관리자. 그 밖은 403 `FORBIDDEN` |
| 챗봇 `propose_tasks` · `list_members` 도구 | 그 프로젝트의 활성 멤버만 담당자 후보로 본다 |
| `GET /api/members` | `Member` 에 `active` 가 늘어난다. 로그인만 하면 누구나 부를 수 있다 |

## 오류 코드 (늘어나는 것)

| 상태 | `code` | 언제 |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | 쿠키가 없거나 세션이 끝났거나 멤버가 비활성 |
| 401 | `INVALID_CREDENTIALS` | 로그인 실패 (이유를 가르지 않는다) |
| 400 | `INVALID_CREDENTIALS` | 내 비밀번호 바꾸기에서 현재 비밀번호가 틀림 |
| 403 | `FORBIDDEN` | 로그인은 했지만 권한이 모자람 |
| 429 | `TOO_MANY_ATTEMPTS` | 로그인 시도가 IP 당 분당 10회를 넘음 |
| 404 | `MEMBER_NOT_FOUND` | 없는 멤버 |
| 409 | `EMAIL_TAKEN` | 이미 쓰는 이메일 |
| 409 | `LAST_SYSTEM_ADMIN` | 마지막 활성 시스템 관리자를 내리거나 끔 |
| 400 | `MEMBER_INACTIVE` | 비활성 멤버를 프로젝트에 부여 |
| 400 | `MEMBER_EMAIL_REQUIRED` | 이메일 없는 멤버에 비밀번호를 걺 |

## 화면 (프론트가 정할 것의 테두리)

- `/login` — 로그인 화면. 로그인 전에는 이 화면만 열린다. 로그인 뒤 가려던 주소로 돌아간다(`?next=`)
- 아무 요청에서나 401 이 오면 `/login?next=<지금 주소>` 로 보낸다
- 머리글의 "나 고르기" 를 걷어내고 **내 이름 메뉴**(비밀번호 바꾸기 · 로그아웃)로 바꾼다. `currentMemberId` 는 `GET /api/auth/me` 의 `id` 다
- `/admin/members` — 사용자 관리 (시스템 관리자만 메뉴가 보인다)
- `/projects/:projectId/settings` — **프로젝트 관리**: 프로젝트 정보(이름 · 접두사는 읽기 전용) + 프로젝트 멤버. `/projects/:projectId/parts` — **파트 관리**(`docs/api/part.md`). 둘 다 그 프로젝트 관리자 · 시스템 관리자만 메뉴가 보인다. 옛 `/projects/:projectId/members` 는 settings 로 넘긴다
- 메뉴를 숨기는 것은 편의다. **막는 것은 서버다**
