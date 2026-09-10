# 핵심 엔티티

안건 · 요청 · 작업을 하나로 합치기로 하면서 정리한 문서다. 화면보다 이걸 먼저 정한다 —
간트가 데이터 모양을 꽤 강하게 요구해서, 화면부터 그리면 두 번 일하게 된다.

작성 2026-09-10 · 아직 구현 전이다.

---

## 왜 합치나

지금은 **안건**(정할 것)과 **요청**(해줄 것)이 서로 다른 레코드다. 처음엔 성격이 달라서
나눴는데, 쓰다 보니 두 가지가 걸렸다.

1. **등록하는 사람이 분류해야 한다.** 그런데 기준이 명확하지 않다. 제일 모르는 시점에
   제일 어려운 판단을 시키는 셈이다.
2. **간단한 요청이 회의로 번진다.** 요청한 사람이 잘 몰라서 댓글로 결론이 안 나면 결국
   회의에서 정해야 하는데, 지금 구조로는 요청이 회의에 못 올라간다.

여기에 일정 관리(간트)까지 붙으면 **작업**이라는 세 번째 종류가 생긴다. 종류를 하나 더
늘리는 대신 셋을 하나로 합친다.

## 무엇을 하나로 합치나

셋을 가르던 게 뭐였는지 보면 결국 두 가지 속성이다.

| 지금 부르는 이름 | 회의에 올라가나 | 일정이 있나 |
| --- | --- | --- |
| 안건 | O | X |
| 요청 | X | 기한만 |
| 작업 | X | O (시작~종료) |

**둘 다 속성이지 종류가 아니다.** 날짜를 넣으면 간트에 뜨고, 회의에 올리면 회의 이력이
붙는다. 등록하는 사람은 아무것도 고르지 않는다.

### 종류는 나중에 드러난다

```
                     ┌─ 담당자가 해주고 닫힘              → 완료로 끝남
등록 (제목 · 본문) ──┤
                     ├─ 댓글로 결론이 안 남
                     │    → [회의에서 정하기] → 회의에서 결정 → 결정으로 끝남
                     │
                     └─ 날짜를 넣음                       → 간트에 뜬다
```

"이건 회의감인가?"를 등록할 때가 아니라 **막혔을 때** 묻는다. 그때가 판단이 서는 시점이다.

## 이름: 건

합쳐진 레코드는 **건**이라 부른다. 코드에서는 `Item`.

- **이슈 · 작업 · 할 일 · 태스크는 쓰지 않는다.** 간트 화면에 그런 말이 이미 나오게 되고,
  "그 작업 말고 저 작업요" 같은 대화가 생긴다.
- **안건도 안 쓴다.** 뜻을 넓혀 쓸 수는 있지만 "이게 안건인가?" 하는 망설임이 그대로 남는다.
  그 망설임을 없애는 게 이번 변경의 목적이다.
- **건**은 분류 냄새가 없고 "열린 건 12건"처럼 한국어로 자연스럽다.

---

## 엔티티

```
Project ─┬─ Meeting          날짜 · 참석자 · 녹음  (일이 아니라 시점)
         │
         └─ Item ─┬─ Activity        오간 줄 (댓글 + 회의에서 남긴 줄)
                  ├─ Conclusion      지금 이 건의 결론
                  └─ ItemLink        선후관계 (간트 전용)
```

### Item — 건

화면에서 목록의 한 줄이고, 눌러서 열리는 팝업 하나다.

```ts
interface Item {
  id: string
  projectId: string

  /** 목록에 보이는 한 줄 */
  title: string
  /** 등록할 때 적은 상세 내용. 게시판의 본문 자리. 없으면 빈 문자열 */
  body: string

  state: 'open' | 'doing' | 'closed'
  /** 어떻게 끝났나. state 가 closed 일 때만 값이 있다 */
  closedAs: 'decided' | 'done' | 'dropped' | null

  ownerId: string | null
  /** 하위로 분리한 건이면 그 부모. 간트의 WBS 계층이 이 값이다 */
  parentId: string | null

  /* 일정 — 채우면 간트에 나타난다. 안 채우면 목록에만 있다 */
  startDate: string | null   // YYYY-MM-DD
  dueDate: string | null     // YYYY-MM-DD
  progress: number           // 0..1

  /** 다음 회의에서 다룰 것으로 올려둠 */
  meetingQueued: boolean

  createdAt: string
}
```

**`parentId`는 새로 만드는 게 아니다.** 지금도 "하위 안건으로 분리" 기능이 쓰는 값이고,
그게 그대로 간트의 트리가 된다.

### 상태와 결말

상태는 셋이고, 끝난 이유를 따로 남긴다.

| state | 뜻 | 지금 무엇에 해당하나 |
| --- | --- | --- |
| `open` | 올라왔고 아직 아무도 안 잡음 | 안건 `queued` / 요청 `todo` |
| `doing` | 누군가 붙었지만 안 끝남 | 안건 `open` / 요청 `doing` |
| `closed` | 끝남 | 안건 `decided` / 요청 `done` |

| closedAs | 뜻 |
| --- | --- |
| `decided` | 정해져서 끝남 |
| `done` | 해줘서 끝남 |
| `dropped` | 안 하기로 하고 접음 |

안건과 요청의 구분이 사실상 `closedAs` 로 흡수된다.

`meetingQueued` 는 상태가 아니라 따로 둔 표시다. 그래야 "진행 중이면서 회의 대기"가
표현된다.

### Activity — 오간 줄

댓글과 회의에서 남긴 줄을 **한 줄기**로 둔다. 지금의 `RequestComment` 는 사실 `Entry` 에서
`meetingId`·`kind`·`detail`·`note` 를 뺀 모양이라, 하나로 합칠 수 있다.

```ts
type ActivityKind =
  | 'comment'   // 그냥 쓴 말
  | 'raise'     // 제기
  | 'defer'     // 미룸
  | 'decide'    // 결정
  | 'refine'    // 세부 추가
  | 'change'    // 변경 (이전 결정을 대체)
  | 'split'     // 하위 건으로 분리

interface Activity {
  id: string
  itemId: string
  /** null = 회의 밖. 댓글은 늘 null */
  meetingId: string | null
  kind: ActivityKind
  /** 한 줄 요약 */
  text: string
  /** 조건별 상세 — 결정 · 세부 · 변경에만 */
  detail: string[]
  /** 배경 메모 — 왜 그렇게 됐는지 */
  note: string
  ownerId: string | null
  createdAt: string   // ISO datetime
}
```

**댓글 쓸 때는 종류를 묻지 않는다.** 그냥 쓰면 `comment` 다. 종류를 고르는 건 회의 화면에서
줄을 남길 때뿐이다. "구조를 씌우기 시작하면 결국 안건이 된다"는 원칙은 그대로다.

합치면서 얻는 것: **댓글로 시작해서 회의에서 결정된 흐름이 한 타임라인에 시간순으로 보인다.**
지금 걸린 문제가 화면에 그대로 드러난다.

### Conclusion — 지금 이 건의 결론

회의에서 결정 줄이 남았을 때와, 댓글을 AI 가 정리했을 때가 **같은 칸**을 채운다. 하나로 두면
화면이 한 갈래다.

```ts
interface Conclusion {
  points: string[]
  /** 결정 줄에서 왔나, 오간 이야기를 정리해서 왔나 */
  source: 'meeting' | 'summary'
  fromActivityId: string | null
  /** 정리해서 뽑은 것은 사람이 확정해야 담당자가 이걸 기준으로 일한다 */
  confirmed: boolean
  confirmedById: string | null
  confirmedAt: string | null
  /** 이 결론을 만들 때 읽은 줄 수. 그 뒤로 더 붙었는지는 이 값으로 안다 */
  fromActivityCount: number
}
```

`Item.conclusion: Conclusion | null` 로 얹는다.

이렇게 두면 첫 대화에서 열어뒀던 "안건에도 같은 정리를 붙일지"가 저절로 풀린다.

### ItemLink — 선후관계

간트가 요구하는 유일한 새 엔티티다.

```ts
interface ItemLink {
  id: string
  sourceId: string
  targetId: string
  type: 'fs' | 'ss' | 'ff' | 'sf'
}
```

### Meeting — 회의

**건이 아니다.** 일이 아니라 시점이라서 따로 둔다. 지금 모양 그대로 간다.

날짜 · 참석자 · 녹음, 그리고 안건에 안 붙는 메모 몇 줄. 회의의 본문은 없다 — 그 회의에서
건에 남긴 줄이 그대로 그 회의의 기록이다.

---

## 간트에 어떻게 먹이나

`dhtmlx-gantt` v10 Community 를 쓸 예정이다. `gantt.parse({ data, links })` 가 원하는
모양과 거의 1:1 이다.

| gantt | 우리 |
| --- | --- |
| `id` | `Item.id` |
| `text` | `Item.title` |
| `start_date` | `Item.startDate` |
| `end_date` | `Item.dueDate` |
| `progress` | `Item.progress` |
| `parent` | `Item.parentId ?? 0` |
| `links[].source` / `.target` | `ItemLink.sourceId` / `.targetId` |
| `links[].type` `'0'`\|`'1'`\|`'2'`\|`'3'` | `ItemLink.type` `fs`\|`ss`\|`ff`\|`sf` |

`Activity` 와 `Conclusion` 은 간트가 보지 않는다. 간트는 막대만 그리고, 막대를 누르면 우리
상세 팝업이 열린다.

> **라이선스 확인 필요.** dhtmlx-gantt Community 는 GPL v2 다. 사내에서만 쓰고 배포하지
> 않으면 대체로 문제가 없지만, 제품으로 내보낼 계획이면 상용 라이선스가 필요하다. 나중에
> 걷어내려면 간트가 데이터 모양까지 잡고 있어서 아프다 — 지금 확인해 두는 게 낫다.

---

## 지금 것에서 무엇이 어디로 가나

| 지금 | 합친 뒤 |
| --- | --- |
| `Thread` (안건) | `Item` |
| `Request` (요청) | `Item` |
| `Thread.state` `queued`/`open`/`decided` | `Item.state` + `closedAs: 'decided'` |
| `Request.state` `todo`/`doing`/`done` | `Item.state` + `closedAs: 'done'` |
| `Request.body` | `Item.body` |
| `Thread.parentThreadId` | `Item.parentId` (간트 계층 겸용) |
| `Entry` | `Activity` |
| `RequestComment` | `Activity` (`kind: 'comment'`) |
| `RequestSpec` | `Conclusion` (`source: 'summary'`) |
| 안건의 "지금 합의된 내용" (파생) | `Conclusion` (`source: 'meeting'`) |
| `Request.kind` (종류) | **없앤다** |
| `Meeting` | 그대로 |
| — | `ItemLink` (새로) |

---

## 어떻게 만들 것인가

기존을 고치지 않고 **나란히 두고 옮긴다.** 목업이라 데이터 이전 부담이 없어서 이게 싸다.

```
새로 만든다              기존 (다 될 때까지 그대로 둔다)
/items                   /threads   /requests   /meetings
types/item.ts            types/domain.ts
stores/items.ts          stores/mijeonge.ts
```

다 되면 옛것을 지운다. 중간에 언제든 둘을 나란히 열어 비교할 수 있다.

**새 회의 화면(`NewMeetingView.vue`, 832줄)만은 새로 쓰지 않는다.** 거기 든 결정들이 비싸다 —
한 건에 여러 줄 쌓기, 줄마다 되돌리기, 자동 저장 없음, 회의 중 새 건 등록, 분리하면 양쪽에
줄 남기기. 타입만 갈아끼우면 대부분 그대로 돈다.

순서:

1. 도메인 + 스토어를 합치고, 기존 화면은 그대로 도는지 확인
2. 목록 · 상세를 하나로
3. 새 회의 화면을 새 모델에 맞춤
4. 간트 화면 추가
5. 캔버스 시안 반영

---

## 아직 안 정한 것

### 1. 진척률을 사람이 넣게 할지

간트는 `progress` 를 원하는데, 손으로 %를 유지하는 건 대부분의 팀에서 안 된다.

**추천: 하위에서 굴려 올린다.** 잎은 닫혔으면 1, 아니면 0. 부모는 자식 평균. 사람이 관리할
게 없어지고 거짓말도 안 한다. 잎에서 손으로 넣고 싶어지면 그때 열면 된다.

### 2. 일정 없는 건을 간트에서 어떻게 할지

대부분의 건은 날짜가 없다. 두 가지 중 하나다.

- 간트 왼쪽에 **백로그**로 세워두고 끌어다 놓으면 날짜가 붙는다
- 간트에는 아예 안 보이고 목록에만 있다

### 3. 회의를 간트에 띄울지

마일스톤으로 찍을 수 있다. 급하지 않으니 나중에.

### 4. 확정 권한

결론을 누가 확정할 수 있나. 요청자로 제한하는 쪽을 추천한다 — 무엇을 받을지 정하는 건
부탁한 쪽이다. 판단은 화면에 흩지 말고 `canConfirm(item)` 함수 하나로 둔다.
