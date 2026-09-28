import { describe, expect, it } from 'vitest'
import { makeTaskKeyPrefix, taskKeyPrefixError } from './project'

describe('makeTaskKeyPrefix', () => {
  it('이미 쓰는 접두사를 비껴간다', () => {
    expect(makeTaskKeyPrefix(['HW', 'PAS'])).toBe('PJ1')
    expect(makeTaskKeyPrefix(['PJ1', 'PJ2'])).toBe('PJ3')
  })
})

describe('taskKeyPrefixError', () => {
  it('비워 두는 것은 잘못이 아니다 — 자동으로 붙는다', () => {
    expect(taskKeyPrefixError('', ['HW'])).toBeNull()
    expect(taskKeyPrefixError('  ', ['HW'])).toBeNull()
  })

  it('소문자로 적어도 대문자로 보고 받아들인다', () => {
    expect(taskKeyPrefixError('sl', ['HW'])).toBeNull()
  })

  it('겹치는 접두사는 막는다 — HW-4 한 마디로 가리켜야 한다', () => {
    expect(taskKeyPrefixError('hw', ['HW'])).toContain('이미 쓰고 있는')
  })

  it('숫자로 시작하거나 너무 길면 막는다', () => {
    expect(taskKeyPrefixError('4HW', [])).toContain('1~8자')
    expect(taskKeyPrefixError('ABCDEFGHI', [])).toContain('1~8자')
    expect(taskKeyPrefixError('한화', [])).toContain('1~8자')
  })
})
