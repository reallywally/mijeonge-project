# 테스트 조치 내역 (2026-11-05)

테스트 상세의 **상태 칸(지금 상태 카드 · [성공] · [실패] · 실패 · 막힘 메모)을 걷고**, 그 자리에 **조치 내역**을 둔다.
조치 내역은 작업 댓글과 같은 모양의 글 타래다 — 무엇을 해 봤고 무엇을 고쳤는지를 누구나 이어 적는다.
이 파일이 조치 내역 계약의 정답이다. 테스트 자체는 `test.md`.

## 정해 둔 것 (사용자, 2026-11-05)

| | 결정 |
| --- | --- |
| 상태 칸 | 테스트 상세에서 뺀다. 상태는 **오른쪽 속성 패널의 상태 고르기 하나**로만 바꾼다. 묶음의 '하위 테스트' 요약(하위 줄 목록)은 상태 칸이 아니라 그대로 둔다 |
| 실패 · 막힘 메모 | **이제 받지 않아도 된다** — `POST /api/tests/{testId}/status` 의 `note` 는 실패 · 막힘에서도 **선택**이다(전에는 비면 422). 보내면 전처럼 `resultNote` 에 남고, 안 보내면 `""` 이다. 까닭은 조치 내역에 적는다 |
| 조치 내역 | 작업 댓글과 같은 규칙 — 남기는 사람은 로그인한 사람, 고치기는 **작성자만**, 지우기는 작성자 · 그 프로젝트 관리자 · 시스템 관리자. 등록 순(오래된 것 먼저) |
| 이력 · 신호 | 조치 내역은 `test_history` 에 줄을 남기지 않고, 며칠째 · 신호 · 기준 바뀜(`basis_seq`)에 닿지 않는다 |

## 테이블 `test_comment` (리비전 `0034_test_comment`)

| 칸 | 타입 | |
| --- | --- | --- |
| `id` | str PK | |
| `seq` | int | 등록 순 |
| `test_id` | FK → `test_case.id` (ON DELETE CASCADE) | 테스트는 행째 지운다 — 조치 내역도 같이 지워진다 |
| `author_id` | FK → member, null 가능 | |
| `body` | text | 앞뒤 공백을 떼고 비면 422. 길이는 작업 댓글과 같은 한도 |
| `created_at` · `edited_at` | timestamptz | `edited_at` 은 안 고쳤으면 null |

## 모양

```ts
interface TestComment {
  id: string
  testId: string
  authorId: string | null
  body: string
  createdAt: string
  editedAt: string | null
}
```

- `TestCase` 에 `commentCount: number` 를 더한다 — 목록 · 간트에는 아직 찍지 않지만 상세 제목 옆 '조치 N' 에 쓴다

## 엔드포인트

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| GET | `/api/tests/{testId}/comments` | 조치 내역 — 등록 순 | `TestComment[]` |
| POST | `/api/tests/{testId}/comments` | 남기기 — `{ body }`. 작성자는 로그인한 사람(`authorId` 는 무시) | 201 `TestComment` |
| PATCH | `/api/test-comments/{testCommentId}` | 고치기 — `{ body }`, `editedAt` 이 지금. 작성자만(그 밖 403 `FORBIDDEN`) | `TestComment` |
| DELETE | `/api/test-comments/{testCommentId}` | 지우기 — 작성자 · 프로젝트 관리자 · 시스템 관리자(그 밖 403) | 204 |

- 경로의 `testId` · `testCommentId` 는 `require_scope` 의 경계 검사에 든다 — 없거나 못 보는 프로젝트면 404
- 묶음(하위가 있는 테스트)에도 남길 수 있다

## 오류 코드 (늘어나는 것)

| 상태 | `code` | 언제 |
| --- | --- | --- |
| 404 | `TEST_COMMENT_NOT_FOUND` | 경로의 조치 내역이 없거나 · 못 보는 프로젝트의 것 |

## 시드 · 목업

조치 내역은 시드 · 목업에 넣지 않는다(빈 타래로 시작). 개발 DB 에 시드를 다시 돌리지 않는다.

## 화면

- 테스트 상세 왼쪽, 테스트 데이터 아래(전에 상태 칸이 있던 자리)에 **'조치 내역'** — 작업 상세의 댓글과 같은 모양(목록 · 입력 칸 · ⌘/Ctrl+Enter 로 남기기 · 고치기 · 지우기 확인)
- 상태 고르기에서 실패 · 막힘을 골라도 메모를 묻지 않고 바로 보낸다
- 지난 `resultNote` 가 있는 테스트는 그 글을 조치 내역 위에 '지난 결과 메모' 로 한 줄 보인다(읽기 전용) — 옮기지는 않는다

## 구현에서 메운 것 (서버, 2026-11-05)

- **테스트는 논리 삭제가 아니라 행을 지운다**(`DELETE /api/tests/{testId}`) — 그래서 `test_comment.test_id` 는 `test_case.id` 에 `ON DELETE CASCADE` 로 걸었다. 지운 테스트의 조치 내역은 남지 않고, 경로의 `testCommentId` 는 원래 없을 때와 같은 404 `TEST_COMMENT_NOT_FOUND` 다. 작업 댓글과 같이 `project_id` 칸 · 복합 FK 는 두지 않았다 — 프로젝트는 테스트를 거쳐 찾는다(`access._project_of`)
- **본문 길이 한도** — 작업 댓글의 `CommentBody` 를 그대로 쓴다(앞뒤 공백을 떼고 비면 422, 따로 길이 상한은 없다 — 작업 댓글도 없다)
- **경로 · 파일** — 라우트 · 서비스는 작업 댓글 옆(`app/api/comment.py` · `app/services/comment.py`), 모델 · 스키마는 테스트 옆(`app/models/test.py` 의 `TestComment` · `app/schemas/test.py` 의 `TestCommentOut` · `Create` · `Patch`)
- **실패 · 막힘 메모가 빈 채로 오면** `resultNote` 는 `""` 이고, 이력의 `resultNote` 칸은 앞 메모가 있었으면 `앞 → null` 로 남는다(전과 같은 규칙)
- **`commentCount`** 는 `TestCase` 를 내는 모든 자리(목록 · 하나 · 등록 · 고치기 · 상태 · 태그 · 기준 확인)에 실린다 — 테스트 수와 상관없이 select 하나로 센다
