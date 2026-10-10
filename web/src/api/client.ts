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
const unreachable = (status: number) =>
  new ApiError(status, { code: UNREACHABLE, message: '서버에 연결할 수 없습니다.' })

/** 서버에 닿지 못해 난 오류인가 — 다시 시도 화면을 띄울지 가른다 */
export const isUnreachable = (e: unknown) => e instanceof ApiError && e.code === UNREACHABLE

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

/** /api 아래로 보내고 JSON 을 받는다. 204 는 undefined 다 */
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

  const payload: unknown = await res.json().catch(() => null)
  if (isErrorBody(payload)) throw new ApiError(res.status, payload)
  /* 우리 서버는 500 도 계약 모양으로 낸다. 모양이 아닌 5xx 는 앞단(Vite 프록시)이 서버에 못 붙었다는 뜻이다 */
  if (res.status >= 500) throw unreachable(res.status)
  throw new ApiError(res.status, {
    code: `HTTP_${res.status}`,
    message: '요청을 처리하지 못했습니다.',
  })
}

export const id = (value: string) => encodeURIComponent(value)
