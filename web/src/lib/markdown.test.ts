import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown } from './markdown'

describe('챗봇 답 마크다운 — 블록', () => {
  it('빈 줄로 문단을 나누고, 문단 안의 줄바꿈은 남긴다', () => {
    expect(parseMarkdown('첫 줄\n둘째 줄\n\n다음 문단')).toEqual([
      { kind: 'p', inlines: [{ kind: 'text', text: '첫 줄\n둘째 줄' }] },
      { kind: 'p', inlines: [{ kind: 'text', text: '다음 문단' }] },
    ])
  })

  it('제목(#)은 굵은 한 줄 블록이다', () => {
    expect(parseMarkdown('## 결정된 것 ##')).toEqual([
      { kind: 'heading', inlines: [{ kind: 'text', text: '결정된 것' }] },
    ])
  })

  it('- * • 목록과 1. 목록, 들여쓰기 단', () => {
    expect(parseMarkdown('- 하나\n  * 둘\n• 셋')).toEqual([
      {
        kind: 'ul',
        items: [
          { level: 0, inlines: [{ kind: 'text', text: '하나' }] },
          { level: 1, inlines: [{ kind: 'text', text: '둘' }] },
          { level: 0, inlines: [{ kind: 'text', text: '셋' }] },
        ],
      },
    ])
    expect(parseMarkdown('3. 셋째\n4) 넷째')).toEqual([
      {
        kind: 'ol',
        start: 3,
        items: [
          { level: 0, inlines: [{ kind: 'text', text: '셋째' }] },
          { level: 0, inlines: [{ kind: 'text', text: '넷째' }] },
        ],
      },
    ])
  })

  it('목록 바로 밑의 들여쓴 줄은 그 항목에 잇는다', () => {
    const [list] = parseMarkdown('- 서버 OS\n  우분투로 정했습니다')
    expect(list).toEqual({
      kind: 'ul',
      items: [{ level: 0, inlines: [{ kind: 'text', text: '서버 OS\n우분투로 정했습니다' }] }],
    })
  })

  it('코드 블록은 안을 풀지 않고, 닫는 ``` 가 아직 안 왔으면 끝까지 코드다', () => {
    expect(parseMarkdown('```sql\nselect **1**\n```\n뒤')).toEqual([
      { kind: 'code', text: 'select **1**' },
      { kind: 'p', inlines: [{ kind: 'text', text: '뒤' }] },
    ])
    expect(parseMarkdown('앞\n```\n받는 중')).toEqual([
      { kind: 'p', inlines: [{ kind: 'text', text: '앞' }] },
      { kind: 'code', text: '받는 중' },
    ])
  })

  it('--- 는 구분선, 표 · 링크 · HTML 은 글자 그대로다', () => {
    expect(parseMarkdown('---')).toEqual([{ kind: 'hr' }])
    const text = '| a | b |\n[링크](http://x) <b>굵게</b>'
    expect(parseMarkdown(text)).toEqual([{ kind: 'p', inlines: [{ kind: 'text', text }] }])
  })
})

describe('챗봇 답 마크다운 — 인라인', () => {
  it('굵게 · 기울임 · 코드', () => {
    expect(parseInline('**결정** 은 *우분투* 로 `apt` 를 씁니다')).toEqual([
      { kind: 'strong', children: [{ kind: 'text', text: '결정' }] },
      { kind: 'text', text: ' 은 ' },
      { kind: 'em', children: [{ kind: 'text', text: '우분투' }] },
      { kind: 'text', text: ' 로 ' },
      { kind: 'code', text: 'apt' },
      { kind: 'text', text: ' 를 씁니다' },
    ])
  })

  it('근거 표시는 굵게 안에서도 칩 조각이 된다', () => {
    expect(parseInline('**[[thread:t1]] 먼저**')).toEqual([
      {
        kind: 'strong',
        children: [
          { kind: 'ref', ref: { kind: 'thread', id: 't1' } },
          { kind: 'text', text: ' 먼저' },
        ],
      },
    ])
  })

  it('코드 안의 별 · 근거는 풀지 않는다', () => {
    expect(parseInline('`**x** [[task:k1]]`')).toEqual([
      { kind: 'code', text: '**x** [[task:k1]]' },
    ])
  })

  it('짝이 없거나 띄어 쓴 별, snake_case 밑줄은 글자 그대로다', () => {
    for (const text of ['2 ** 3 = 8', '별 하나 * 만', 'due_date 칸', '**받는 중'])
      expect(parseInline(text)).toEqual([{ kind: 'text', text }])
  })

  it('받는 중 끝에 걸린 덜 온 근거 표시는 비치지 않는다', () => {
    expect(parseInline('다음은 [[thr')).toEqual([{ kind: 'text', text: '다음은 ' }])
  })
})
