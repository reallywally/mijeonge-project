# 마이페이지 · 프로필 사진 (2026-11-06)

내 정보를 한곳에서 보고, **프로필 사진**을 걸고, 비밀번호를 바꾼다. 프로필 사진은 간트 · 칸반 · 담당자 칸 등
사람을 찍는 모든 자리에서 이름 앞의 동그라미로 쓴다 — 이름만 있으면 줄이 많을 때 눈에 안 들어온다.
이 파일이 마이페이지 · 프로필 사진 계약의 정답이다. 로그인 · 비밀번호 규칙은 `auth.md`.

## 정해 둔 것 (2026-11-06)

| | 결정 |
| --- | --- |
| 마이페이지 | `/me`. 머리글 **내 이름 메뉴**에 '마이페이지' 를 더한다(비밀번호 바꾸기 · 로그아웃 위) |
| 보이는 것 | 프로필 사진(올리기 · 바꾸기 · 지우기) · 이름 · 이메일 · 시스템 역할 · 내 프로젝트와 역할 · 비밀번호 바꾸기 |
| 내가 못 바꾸는 것 | 이름 · 이메일 · 역할 · 소개(경력 · 기술 · 기타)는 **관리자가 바꾼다**(그대로). 마이페이지에서는 읽기만 |
| 사진 저장 | **DB 에 둔다**(파일 서버 · 버킷 없이). 화면이 올리기 전에 **256×256 정사각형으로 가운데를 잘라 줄여** 보낸다 — 한 장 수십 KB |
| 사진 주소 | `Member` · `Me` 에 `avatarUrl: string \| null` 이 는다. 서버가 `"/api/members/{id}/avatar?v=<바뀐 시각 epoch ms>"` 로 만든다 — 바꾸면 주소가 바뀌어 캐시가 저절로 갈린다. 없으면 null |
| 없을 때 | 지금처럼 **이름 첫 글자 동그라미** |
| 관리자 | 시스템 관리자는 남의 사진을 지울 수 있다(부적절한 사진). 올려 주지는 않는다 |

## 테이블 `member_avatar` (리비전 `0035_member_avatar`)

| 칸 | 타입 | |
| --- | --- | --- |
| `member_id` | PK, FK → `member.id` ON DELETE CASCADE | 한 사람에 한 장 |
| `content_type` | str | `image/png` · `image/jpeg` · `image/webp` 중 하나 |
| `data` | bytea | 512 KB 까지 |
| `updated_at` | timestamptz | `avatarUrl` 의 `v` |

`member` 행을 가볍게 두려고 따로 뗀다 — 목록(`/api/members`)은 `updated_at` 만 조인해 주소를 만든다.

## 모양

```ts
export interface Member {
  id: string
  name: string
  active: boolean
  /** 프로필 사진 주소 — 없으면 null (2026-11-06) */
  avatarUrl: string | null
}

export interface Me {
  // … 그대로
  avatarUrl: string | null
}

/** PUT /api/auth/me/avatar */
export interface AvatarInput {
  /** data:image/png|jpeg|webp;base64,… */
  dataUrl: string
}
```

## 엔드포인트

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| PUT | `/api/auth/me/avatar` | 내 사진 걸기 · 바꾸기 — `{ dataUrl }`. 쓰기는 JSON 만 받는 규칙(`auth.md` 쿠키 · CSRF) 그대로라 base64 로 싣는다 | `Me` |
| DELETE | `/api/auth/me/avatar` | 내 사진 지우기. 없어도 성공(멱등) | `Me` |
| GET | `/api/members/{memberId}/avatar` | 사진 바이트. 로그인만 하면 누구나(멤버 이름처럼 전사 공통). `Content-Type` 은 저장한 것, `Cache-Control: private, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`. 없으면 404 `AVATAR_NOT_FOUND` | 이미지 |
| DELETE | `/api/admin/members/{memberId}/avatar` | 시스템 관리자가 남의 사진 지우기(멱등) | 204 |

### 검사

- `dataUrl` 이 `data:<type>;base64,<…>` 꼴이 아니거나, `<type>` 이 셋 밖이거나, base64 가 깨졌거나,
  **바이트의 첫머리(매직 넘버)가 `<type>` 과 안 맞으면** 400 `AVATAR_INVALID` — `detail: { "dataUrl": "<말>" }`
- 풀어낸 바이트가 512 KB 를 넘으면 400 `AVATAR_TOO_LARGE`
- 서버는 이미지를 다시 그리지 않는다(라이브러리 없이) — 줄이는 것은 화면 몫. 그래서 위 검사로 막는다

## 오류 코드 (늘어나는 것)

| 상태 | `code` | 언제 |
| --- | --- | --- |
| 400 | `AVATAR_INVALID` | 위 '검사' |
| 400 | `AVATAR_TOO_LARGE` | 512 KB 넘음 |
| 404 | `AVATAR_NOT_FOUND` | 사진이 없는 멤버 · 없는 멤버 |

## 시드 · 목업

시드에는 사진을 넣지 않는다(개발 DB 에 시드를 다시 돌리지 않는다). 목업은 올린 `dataUrl` 을 그대로 `avatarUrl` 로 쓴다.

## 구현에서 메운 것 (서버, 2026-11-06)

- **512 KB 는 `512 × 1024` 바이트**이고 그 값까지는 받는다(넘어야 `AVATAR_TOO_LARGE`). base64 글자가 그 크기를
  담을 수 있는 길이(`ceil(524288 / 3) × 4`)를 넘으면 풀지 않고 바로 `AVATAR_TOO_LARGE` 다. `dataUrl` 에
  스키마 길이 제한을 두지 않았다 — 두면 크기 초과가 422 로 나가 계약의 code 와 어긋난다
- **`<type>` 은 대소문자를 가리지 않고** 소문자로 저장한다. `data:image/png,…`(base64 표시 없음) · 빈 내용 ·
  패딩이 틀린 base64 는 `AVATAR_INVALID`. `detail.dataUrl` 의 말은 꼴 · 종류 · base64 · 첫머리 넷으로 가른다
- 첫머리 검사: png `89 50 4E 47 0D 0A 1A 0A`, jpeg `FF D8 FF`, webp `RIFF` + (4바이트) + `WEBP`
- `dataUrl` 이 빠지면 다른 쓰기처럼 422 `VALIDATION_ERROR`(`detail.dataUrl`) 다
- 관리자 지우기는 **사진이 없어도 204**(멱등), **없는 멤버면 404 `MEMBER_NOT_FOUND`** — 다른
  `/api/admin/members/{memberId}/…` 경로와 같다
- `GET /api/members/{memberId}/avatar` 는 없는 멤버도 `AVATAR_NOT_FOUND`(멤버가 있는지 가르지 않는다)
- 주소의 `v` 는 `updated_at` 의 epoch 밀리초다. 같은 밀리초 안에 두 번 바꾸면 주소가 같을 수 있다 — 사람이
  하는 일이라 그대로 둔다
- `/api/admin/members` 의 `MemberAccount` 에는 `avatarUrl` 을 싣지 않았다 — 계약에 없다. 필요하면 계약에 먼저 더한다

## 구현에서 메운 것 (화면, 2026-11-06)

- **사용자 관리 화면의 사진은 멤버 목록(`GET /api/members`)에서 찾는다** — `MemberAccount` 에 `avatarUrl` 이 없어서다.
  관리자가 지우면 그 자리에서 멤버 목록의 그 사람 줄(나라면 `Me` 도)을 null 로 간다. [사진 지우기]는 사진이 있는 줄에만
  서고, 되돌릴 수 없어 그 줄에서 한 번 더 묻는다
- 사용자 관리에서 이름 · 활성을 고쳐 멤버 목록에 맞출 때 **들고 있던 `avatarUrl` 을 지킨다**(`MemberAccount` 응답에 없으므로)
- **화면은 주소를 거른 뒤에만 건다** — `/api/` 로 시작하는 우리 경로(따옴표 · 꺾쇠 · 공백 없는 꼴)와
  `data:image/png|jpeg|webp;base64,…` 만. 그 밖의 꼴은 첫 글자 동그라미다. 간트는 칸을 글자(innerHTML)로 짜므로 특히 그렇다
- 간트 담당자 칸은 **첫 글자 위에 `<img alt="">` 를 덮는다** — 사진이 안 열리면 빈 이미지가 되어 밑의 글자가 보인다.
  글자로 짜는 칸에 `onerror` 같은 스크립트를 넣지 않으려고. `MemberAvatar`(Vue)는 `error` 를 받아 글자로 바꾼다
- 줄이기: 가운데 정사각형을 256×256 캔버스에 그리고(`createImageBitmap` — gif 는 첫 장) webp 0.86 으로 낸다.
  브라우저가 webp 를 못 내면 `toDataURL` 이 png 를 돌려주므로 그때 jpeg 0.86 으로 다시 낸다. 투명한 곳은 흰 바탕.
  줄인 뒤에도 512 KB 를 넘으면 보내지 않고 화면이 알린다. 고를 수 없는 파일(svg 등) · 못 읽는 파일도 화면에서 막는다
- 목업 갈래는 서버의 검사(꼴 · 타입 셋 · base64 · 첫머리 · 512 KB)와 같은 코드를 낸다(`lib/avatar` `avatarProblem`)
- `/me` 는 부여받은 프로젝트가 없어도 열린다(라우터 가드가 프로젝트 없는 사람을 보내는 곳에서 뺐다).
  '내 프로젝트' 는 `Me.projectRoles` 에 있는 것만 — 시스템 관리자가 다 보는 프로젝트는 부여가 아니라서 넣지 않는다
- 변경 이력 줄의 사람 칩도 같은 동그라미를 쓴다(`HistoryNames.avatar`). 내 이름 메뉴의 [비밀번호 바꾸기] 창은 그대로 두고
  마이페이지와 같은 칸(`PasswordChangeForm`)을 쓴다. 성공하면 둘 다 '비밀번호를 바꿨습니다. 다른 기기의 로그인은 끊겼습니다.'

## 화면

- **`/me` 마이페이지** — 업무 화면 껍데기(AppShell) 안. 위에서부터
  - 프로필: 큰 동그라미(96px) 사진 또는 첫 글자 · [사진 올리기](파일 고르기 — png · jpeg · webp · gif 를 받아 화면에서 256×256 가운데 자르기 → webp, 안 되면 jpeg) · [사진 지우기] · 이름 · 이메일 · 시스템 역할
  - 내 프로젝트: 부여받은 프로젝트 이름과 역할(관리자 · 멤버)
  - 비밀번호 바꾸기: 지금의 비밀번호 바꾸기 창과 같은 칸(현재 · 새 · 새 확인)을 페이지 안에 놓는다. 성공하면 '다른 기기의 로그인은 끊겼습니다'
- **사람 동그라미(`MemberAvatar`)** 하나로 모은다 — 사진이 있으면 사진, 없으면 첫 글자. 사진이 안 열리면(404 등) 첫 글자로 돌아간다
- **간트(작업 · 테스트)의 담당자 열** — 동그라미(20px) + 이름 전체. 열 너비는 이름이 다 보이게 넓힌다
- 그 밖에 이름 첫 글자를 찍던 자리(담당자 칸 · 고르기 목록 · 참조 칩 · 칸반 카드 · 사람 칩 · 내 이름 메뉴)도 같은 동그라미를 쓴다
- 내 사진을 바꾸면 그 자리에서 `Me` 와 멤버 목록의 내 `avatarUrl` 을 갈아 바로 보인다
