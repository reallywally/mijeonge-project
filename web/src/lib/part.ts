import type { Grade } from '@/lib/access'
import type { Part, Task, TaskThreadLink, Thread } from '@/types/domain'

/*
 * 파트 — 보기 범위지 권한이 아니다 (docs/api/part.md). 서버는 프로젝트 전부를 싣고 화면이 거른다.
 * 목록 · 칸반 · 간트 · 안건 목록이 모두 아래 visibleInMyParts 하나로 거른다 — 판단이 갈리면
 * 목록에는 있는데 간트에는 없는 작업이 생긴다. 상세를 주소로 직접 열 때는 거르지 않는다.
 */

/** '내 파트' 또는 '전체' */
export type PartScope = 'mine' | 'all'

export interface PartScopeInput {
  tasks: Pick<Task, 'id' | 'parentId' | 'partId' | 'ownerId'>[]
  threads: Pick<Thread, 'id' | 'partId' | 'ownerId'>[]
  links: TaskThreadLink[]
  /** 로그인한 사람 — 담당 규칙에 쓴다 */
  memberId: string | null
  /** 내가 속한 파트(보관한 파트도 넣는다 — 그 파트의 옛 작업은 계속 보인다) */
  myPartIds: ReadonlySet<string>
}

export interface PartScopeResult {
  taskIds: Set<string>
  /** 스스로는 안 맞지만 보이는 작업의 조상이라 선 작업 — 경로 · 간트 트리가 끊기지 않게. 흐리게 그린다 */
  contextTaskIds: Set<string>
  threadIds: Set<string>
}

/**
 * '내 파트' 에서 보이는 것.
 *
 * 작업 — ① 공통이거나 내 파트 ② 내가 담당 ③ ①② 로 보이는 작업의 조상.
 * 안건 — ① 공통이거나 내 파트 ② 내가 담당 ③ 작업 ①② 에 링크로 걸린 것 — 막힌 이유는 언제나 보인다.
 *   경로를 잇느라 선 조상(③)의 링크는 끌어오지 않는다 — 조상은 맥락일 뿐 내 일이 아니라서,
 *   남의 파트 묶음 아래 작업 하나를 맡았다고 그 파트의 결정이 다 딸려 오면 노이즈를 줄이는 뜻이 없어진다
 */
export function visibleInMyParts(input: PartScopeInput): PartScopeResult {
  const { memberId, myPartIds } = input
  const ownsOrShares = (r: { partId: string | null; ownerId: string | null }) =>
    r.partId === null || myPartIds.has(r.partId) || (memberId !== null && r.ownerId === memberId)

  const byId = new Map(input.tasks.map((t) => [t.id, t]))
  const taskIds = new Set<string>()
  const contextTaskIds = new Set<string>()

  for (const t of input.tasks) if (ownsOrShares(t)) taskIds.add(t.id)

  /* 조상을 올라가며 채운다. 계층이 고리가 될 일은 없지만(서버가 막는다) 혹시 있어도 멈추게 본 것을 센다 */
  for (const id of [...taskIds]) {
    const seen = new Set([id])
    let parentId = byId.get(id)?.parentId ?? null
    while (parentId !== null && !seen.has(parentId)) {
      seen.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      if (!taskIds.has(parent.id)) {
        taskIds.add(parent.id)
        contextTaskIds.add(parent.id)
      }
      parentId = parent.parentId
    }
  }

  const linked = new Set(
    input.links
      .filter((l) => taskIds.has(l.taskId) && !contextTaskIds.has(l.taskId))
      .map((l) => l.threadId),
  )
  const threadIds = new Set(
    input.threads.filter((t) => ownsOrShares(t) || linked.has(t.id)).map((t) => t.id),
  )

  return { taskIds, contextTaskIds, threadIds }
}

/** 처음 들어왔을 때의 보기 — 일반 사용자는 내 파트, 프로젝트 관리자 · 시스템 관리자는 전체 */
export const defaultPartScope = (grade: Grade | null): PartScope =>
  grade === 'user' ? 'mine' : 'all'

/** 이름 순(보관 포함) — 스냅샷이 내는 순서와 같게 */
export const sortParts = (parts: Part[]) =>
  [...parts].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

/**
 * 작업 · 안건에 고를 수 있는 파트 — 활성 파트, 그리고 지금 달려 있는 파트(보관이어도).
 * 보관 파트를 새로 달 수는 없지만, 이미 달린 것을 칸에서 지워 버리면 무엇이었는지 모른다.
 */
export function partChoices(parts: Part[], current: string | null): Part[] {
  return sortParts(parts.filter((p) => p.active || p.id === current))
}

/** 목록 화면의 파트 거르기 — 'all' · 'common' · 파트 id. 주소(?part=)로 들어온 값이 이 프로젝트의 파트가 아니면 전체 */
export type PartFilter = 'all' | 'common' | string

export function partFilterOf(raw: unknown, parts: Pick<Part, 'id'>[]): PartFilter {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === 'common') return 'common'
  if (typeof value === 'string' && parts.some((p) => p.id === value)) return value
  return 'all'
}

/** 파트 이름은 앞뒤 공백을 떼고 1 ~ 50자 (docs/api/part.md) */
export const PART_NAME_MAX = 50

export function partNameProblem(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return '파트 이름을 적어 주세요.'
  if (trimmed.length > PART_NAME_MAX) return `파트 이름은 ${PART_NAME_MAX}자까지입니다.`
  return null
}

/**
 * 작업 등록에서 partId 를 안 보냈을 때 붙는 파트 — 상위 작업의 것을 따른다(최상위면 공통).
 * 보냈으면(null 포함) 그 값이다. 서버 규칙과 같고, 목업 갈래가 이걸로 서버를 흉내 낸다.
 */
export function inheritedPartId(
  sent: string | null | undefined,
  parent: Pick<Task, 'partId'> | null | undefined,
): string | null {
  if (sent !== undefined) return sent
  return parent?.partId ?? null
}
