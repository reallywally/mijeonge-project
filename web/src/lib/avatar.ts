/*
 * 프로필 사진 (docs/api/me.md). 서버는 이미지를 다시 그리지 않는다 — 줄이는 것은 화면 몫이다.
 * 올리기 전에 가운데를 정사각형으로 잘라 256×256 으로 줄이고 webp(안 되면 jpeg) data URL 로 보낸다.
 * 캔버스가 없는 테스트(jsdom)에서도 계산은 돌게 그리기(drawSquare)만 따로 뗐다.
 */

export const AVATAR_SIZE = 256
/** 서버가 받는 크기 — 풀어낸 바이트 기준 */
export const AVATAR_MAX_BYTES = 512 * 1024
/** 고를 수 있는 파일 — gif 는 첫 장만 그려 webp · jpeg 로 바꿔 보낸다 */
export const AVATAR_ACCEPT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const AVATAR_ACCEPT = AVATAR_ACCEPT_TYPES.join(',')
/** 서버가 저장하는 타입 */
export const AVATAR_STORED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export const isAcceptedImage = (file: { type: string }) =>
  (AVATAR_ACCEPT_TYPES as readonly string[]).includes(file.type)

/** 가운데 정사각형 — 긴 쪽의 양 끝을 똑같이 잘라 낸다 */
export function centerSquare(width: number, height: number) {
  const side = Math.min(width, height)
  return {
    sx: Math.floor((width - side) / 2),
    sy: Math.floor((height - side) / 2),
    side,
  }
}

/* 따옴표 · 꺾쇠 · 공백이 들어설 수 없는 꼴만 — 글자로 짜 넣어도 속성을 벗어나지 못한다 */
const API_PATH = /^\/api\/[A-Za-z0-9/_.~%?=&-]*$/
const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/

/** data URL 을 타입과 바이트로 — 꼴이 틀렸거나 base64 가 깨졌으면 null */
export function parseImageDataUrl(dataUrl: string): { type: string; bytes: Uint8Array } | null {
  const m = DATA_URL.exec(dataUrl)
  if (!m || m[2].length % 4 !== 0) return null
  try {
    const raw = atob(m[2])
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
    return { type: m[1], bytes }
  } catch {
    return null
  }
}

/** 바이트 첫머리(매직 넘버)가 타입과 맞는가 — 서버의 검사와 같은 셋 */
export function magicMatches(type: string, b: Uint8Array) {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x)
  if (type === 'image/png') return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  if (type === 'image/jpeg') return at(0, 0xff, 0xd8, 0xff)
  if (type === 'image/webp') return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)
  return false
}

/** 서버가 막을 것 — 목업 갈래가 같은 코드를 내려고 쓴다. 괜찮으면 null */
export function avatarProblem(dataUrl: string): 'AVATAR_INVALID' | 'AVATAR_TOO_LARGE' | null {
  const parsed = parseImageDataUrl(dataUrl)
  if (!parsed || !magicMatches(parsed.type, parsed.bytes)) return 'AVATAR_INVALID'
  return parsed.bytes.length > AVATAR_MAX_BYTES ? 'AVATAR_TOO_LARGE' : null
}

/**
 * 화면에 걸어도 되는 주소인가 — 서버가 만든 우리 경로(/api/…)이거나 목업이 든 이미지 data URL 만.
 * 간트처럼 글자로 짜는 자리에 그대로 들어가므로, 그 밖의 꼴(javascript: · 남의 주소)은 그리지 않는다
 */
export function safeAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null
  return API_PATH.test(url) || DATA_URL.test(url) ? url : null
}

/** 동그라미에 적는 글자 — 이름의 첫 글자. 없으면 '–' */
export const avatarInitial = (name: string | null | undefined) => (name ? name.charAt(0) : '–')

/** 그려 둔 정사각형을 내보내는 방법 — 브라우저는 캔버스, 테스트는 바꿔 끼운다 */
export interface SquareEncoder {
  /** 이미지를 읽어 가로 · 세로를 알린다 */
  load(file: File): Promise<{ width: number; height: number; source: CanvasImageSource }>
  /** source 의 (sx, sy, side) 정사각형을 size×size 로 그려 type 으로 내보낸다. 그 타입을 못 내면 다른 타입의 data URL 이 온다 */
  encode(
    source: CanvasImageSource,
    crop: { sx: number; sy: number; side: number },
    size: number,
    type: string,
    quality: number,
  ): string
}

export class AvatarPrepError extends Error {}

/** 고른 파일을 256×256 webp(안 되면 jpeg) data URL 로 — 못 읽는 파일이면 AvatarPrepError */
export async function prepareAvatar(
  file: File,
  encoder: SquareEncoder = canvasEncoder,
): Promise<string> {
  if (!isAcceptedImage(file))
    throw new AvatarPrepError('png · jpeg · webp · gif 사진만 올릴 수 있습니다.')
  let loaded
  try {
    loaded = await encoder.load(file)
  } catch {
    throw new AvatarPrepError('사진을 읽을 수 없습니다.')
  }
  if (loaded.width <= 0 || loaded.height <= 0) throw new AvatarPrepError('사진을 읽을 수 없습니다.')
  const crop = centerSquare(loaded.width, loaded.height)
  /* toDataURL 은 못 내는 타입이면 말없이 png 로 돌려준다 — 그러면 jpeg 로 다시 낸다(png 는 무겁다) */
  let url = encoder.encode(loaded.source, crop, AVATAR_SIZE, 'image/webp', 0.86)
  if (!url.startsWith('data:image/webp'))
    url = encoder.encode(loaded.source, crop, AVATAR_SIZE, 'image/jpeg', 0.86)
  if (avatarProblem(url) === 'AVATAR_TOO_LARGE')
    throw new AvatarPrepError('사진이 너무 큽니다. 다른 사진을 골라 주세요.')
  return url
}

/** 브라우저의 캔버스로 그린다 */
export const canvasEncoder: SquareEncoder = {
  async load(file) {
    const bitmap = await createImageBitmap(file)
    return { width: bitmap.width, height: bitmap.height, source: bitmap }
  },
  encode(source, { sx, sy, side }, size, type, quality) {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new AvatarPrepError('사진을 줄일 수 없습니다.')
    /* jpeg 는 투명을 못 담는다 — 검게 칠해지지 않게 흰 바탕을 깐다 */
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, size, size)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size)
    return canvas.toDataURL(type, quality)
  },
}
