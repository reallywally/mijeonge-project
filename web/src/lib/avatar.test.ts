import { describe, expect, it } from 'vitest'
import {
  AVATAR_MAX_BYTES,
  AVATAR_SIZE,
  AvatarPrepError,
  avatarInitial,
  avatarProblem,
  centerSquare,
  isAcceptedImage,
  parseImageDataUrl,
  prepareAvatar,
  safeAvatarUrl,
  type SquareEncoder,
} from './avatar'

/* 캔버스는 jsdom 에 없다 — 그리기(encoder)만 바꿔 끼우고 나머지 계산을 본다 */
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes))
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
const PNG = `data:image/png;base64,${b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])}`
const JPEG = `data:image/jpeg;base64,${b64([0xff, 0xd8, 0xff, 0xe0])}`
const WEBP = `data:image/webp;base64,${b64([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')])}`

const file = (type: string) => new File(['x'], 'a', { type })

function fakeEncoder(opts: { width?: number; height?: number; webp?: boolean; out?: string } = {}) {
  const calls: { crop: { sx: number; sy: number; side: number }; size: number; type: string }[] = []
  const encoder: SquareEncoder = {
    load: async () => ({
      width: opts.width ?? 400,
      height: opts.height ?? 300,
      source: {} as CanvasImageSource,
    }),
    encode: (_source, crop, size, type) => {
      calls.push({ crop, size, type })
      if (opts.out) return opts.out
      /* webp 를 못 내는 브라우저는 png 를 돌려준다 */
      if (type === 'image/webp') return opts.webp === false ? PNG : WEBP
      return JPEG
    },
  }
  return { encoder, calls }
}

describe('가운데 정사각형', () => {
  it('긴 쪽의 양 끝을 똑같이 잘라 낸다', () => {
    expect(centerSquare(400, 300)).toEqual({ sx: 50, sy: 0, side: 300 })
    expect(centerSquare(300, 500)).toEqual({ sx: 0, sy: 100, side: 300 })
    expect(centerSquare(256, 256)).toEqual({ sx: 0, sy: 0, side: 256 })
    expect(centerSquare(301, 100)).toEqual({ sx: 100, sy: 0, side: 100 })
  })
})

describe('data URL 검사 — 서버와 같은 셋', () => {
  it('png · jpeg · webp 의 매직 넘버가 맞으면 통과', () => {
    expect(avatarProblem(PNG)).toBeNull()
    expect(avatarProblem(JPEG)).toBeNull()
    expect(avatarProblem(WEBP)).toBeNull()
  })

  it('꼴 · 타입 · base64 · 첫머리가 틀리면 AVATAR_INVALID', () => {
    expect(avatarProblem('hello')).toBe('AVATAR_INVALID')
    expect(avatarProblem(`data:image/gif;base64,${b64(ascii('GIF89a'))}`)).toBe('AVATAR_INVALID')
    expect(avatarProblem('data:image/png;base64,@@@@')).toBe('AVATAR_INVALID')
    expect(avatarProblem('data:image/png;base64,abc')).toBe('AVATAR_INVALID')
    /* jpeg 바이트에 png 라고 적은 것 */
    expect(avatarProblem(JPEG.replace('image/jpeg', 'image/png'))).toBe('AVATAR_INVALID')
  })

  it('512KB 를 넘으면 AVATAR_TOO_LARGE', () => {
    const big = new Array<number>(AVATAR_MAX_BYTES + 3).fill(0)
    big.splice(0, 3, 0xff, 0xd8, 0xff)
    let raw = ''
    for (const x of big) raw += String.fromCharCode(x)
    expect(avatarProblem(`data:image/jpeg;base64,${btoa(raw)}`)).toBe('AVATAR_TOO_LARGE')
  })

  it('바이트로 풀어 낸다', () => {
    expect(parseImageDataUrl(PNG)?.bytes.length).toBe(8)
    expect(parseImageDataUrl(PNG)?.type).toBe('image/png')
  })
})

describe('걸어도 되는 주소', () => {
  it('서버가 만든 /api 경로와 이미지 data URL 만', () => {
    expect(safeAvatarUrl('/api/members/u1/avatar?v=1730851200000')).toBe(
      '/api/members/u1/avatar?v=1730851200000',
    )
    expect(safeAvatarUrl(PNG)).toBe(PNG)
    expect(safeAvatarUrl(null)).toBeNull()
    expect(safeAvatarUrl('')).toBeNull()
    expect(safeAvatarUrl('javascript:alert(1)')).toBeNull()
    expect(safeAvatarUrl('https://evil.example/a.png')).toBeNull()
    expect(safeAvatarUrl('//evil.example/a.png')).toBeNull()
    expect(safeAvatarUrl('/api/x" onerror="alert(1)')).toBeNull()
    expect(safeAvatarUrl('data:text/html;base64,PHA+')).toBeNull()
  })

  it('동그라미 글자는 이름의 첫 글자, 없으면 –', () => {
    expect(avatarInitial('김서연')).toBe('김')
    expect(avatarInitial(null)).toBe('–')
  })
})

describe('올리기 전에 줄이기', () => {
  it('png · jpeg · webp · gif 만 받는다', async () => {
    expect(isAcceptedImage(file('image/gif'))).toBe(true)
    expect(isAcceptedImage(file('image/svg+xml'))).toBe(false)
    await expect(prepareAvatar(file('image/svg+xml'), fakeEncoder().encoder)).rejects.toThrow(
      AvatarPrepError,
    )
  })

  it('가운데를 잘라 256×256 webp 로', async () => {
    const { encoder, calls } = fakeEncoder({ width: 400, height: 300 })
    expect(await prepareAvatar(file('image/png'), encoder)).toBe(WEBP)
    expect(calls).toEqual([
      { crop: { sx: 50, sy: 0, side: 300 }, size: AVATAR_SIZE, type: 'image/webp' },
    ])
  })

  it('webp 를 못 내면 jpeg 로 다시 낸다', async () => {
    const { encoder, calls } = fakeEncoder({ webp: false })
    expect(await prepareAvatar(file('image/gif'), encoder)).toBe(JPEG)
    expect(calls.map((c) => c.type)).toEqual(['image/webp', 'image/jpeg'])
  })

  it('못 읽는 파일 · 줄여도 너무 크면 AvatarPrepError', async () => {
    const broken: SquareEncoder = {
      load: () => Promise.reject(new Error('decode')),
      encode: () => WEBP,
    }
    await expect(prepareAvatar(file('image/png'), broken)).rejects.toThrow(
      '사진을 읽을 수 없습니다.',
    )
    await expect(
      prepareAvatar(file('image/png'), fakeEncoder({ width: 0, height: 0 }).encoder),
    ).rejects.toThrow(AvatarPrepError)

    const raw = 'RIFF\0\0\0\0WEBP' + '\0'.repeat(AVATAR_MAX_BYTES)
    const huge = `data:image/webp;base64,${btoa(raw)}`
    await expect(
      prepareAvatar(file('image/png'), fakeEncoder({ out: huge }).encoder),
    ).rejects.toThrow('너무 큽니다')
  })
})
