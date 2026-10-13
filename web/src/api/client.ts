import type { ApiErrorBody } from '@/types/domain'

/** 화면이 그대로 띄울 수 있는 오류. status 0 은 서버에 닿지도 못한 것이다 */
export class ApiError extends Error {
  readonly code: string
  readonly detail?: Record<string, string>
  readonly status: number

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    if (body.detail) this.detail = body.detail
  }
}

export const UNREACHABLE = 'SERVER_UNREACHABLE'
export const unreachable = (status: number) =>
  new ApiError(status, { code: UNREACHABLE, message: '서버에 연결할 수 없습니다.' })

/** 서버에 닿지 못해 난 오류인가 — 다시 시도 화면을 띄울지 가른다 */
export const isUnreachable = (e: unknown) => e instanceof ApiError && e.code === UNREACHABLE

export const UNAUTHENTICATED = 'UNAUTHENTICATED'

/* 세션이 끝났을 때 할 일 — 로그인 화면으로 보내는 것은 라우터가 안다. 여기는 알리기만 한다.
   요청이 지나는 길이 여럿(request · 챗봇 스트림 · 목업)이라 401 을 보는 자리를 이 하나로 모은다 */
let onUnauthenticated: (() => void) | null = null

export function setUnauthenticatedHandler(handler: (() => void) | null) {
  onUnauthenticated = handler
}

/** 세션이 끝났다는 오류면 알린다. 로그인 실패(INVALID_CREDENTIALS)는 401 이어도 세션 얘기가 아니다 */
export function reportIfUnauthenticated(e: ApiError) {
  if (e.status === 401 && e.code === UNAUTHENTICATED) onUnauthenticated?.()
  return e
}

/** 목업 갈래가 서버처럼 내는 오류 — 401 이면 같은 자리로 알린다 */
export const mockError = (
  status: number,
  code: string,
  message: string,
  detail?: Record<string, string>,
) =>
  reportIfUnauthenticated(
    new ApiError(status, detail ? { code, message, detail } : { code, message }),
  )

/** 무엇이 던져졌든 띄울 한 줄 */
export function messageOf(e: unknown) {
  return e instanceof ApiError ? e.message : '요청을 처리하지 못했습니다.'
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.code === 'string' && typeof v.message === 'string'
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

/**
 * /api 아래로 보내고 JSON 을 받는다. 204 는 undefined 다.
 * 세션 쿠키는 fetch 기본값(credentials: 'same-origin')으로 실린다 — 화면과 /api 가 같은 출처다(Vite 프록시).
 * 본문이 있으면 늘 JSON 이고, 본문 없는 쓰기(로그아웃 · 링크 PUT · DELETE)는 Content-Type 도 싣지 않는다 —
 * 서버는 JSON 이 아닌 본문만 415 로 막는다 (API.md Q29)
 */
export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw unreachable(0)
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  throw await errorOf(res)
}

/** 실패한 응답을 ApiError 로. 스트림(api/chat.ts)도 열리기 전 실패는 이걸 거친다 — 401 도 여기서 알린다 */
export async function errorOf(res: Response): Promise<ApiError> {
  const payload: unknown = await res.json().catch(() => null)
  if (isErrorBody(payload)) return reportIfUnauthenticated(new ApiError(res.status, payload))
  /* 우리 서버는 500 도 계약 모양으로 낸다. 모양이 아닌 5xx 는 앞단(Vite 프록시)이 서버에 못 붙었다는 뜻이다 */
  if (res.status >= 500) return unreachable(res.status)
  return new ApiError(res.status, {
    code: `HTTP_${res.status}`,
    message: '요청을 처리하지 못했습니다.',
  })
}

export const id = (value: string) => encodeURIComponent(value)
