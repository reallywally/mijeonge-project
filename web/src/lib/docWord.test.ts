import { describe, expect, it } from 'vitest'
import { Packer } from 'docx'
import type { JSONContent } from '@tiptap/core'
import { docxFromContent, hexColor, htmlFromDocx } from './docWord'

/* .docx 로 내보낸 것을 mammoth 로 다시 읽어 구조가 남는지 본다 — 가져오기 · 내려받기를 함께 검사한다 */

const text = (t: string, marks?: JSONContent['marks']): JSONContent => ({
  type: 'text',
  text: t,
  marks,
})
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })

/* 1×1 투명 PNG */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

async function roundTrip(doc: JSONContent) {
  const built = await docxFromContent(doc, '검사', {
    imageSize: async () => ({ width: 10, height: 10 }),
  })
  const buffer = await Packer.toBuffer(built)
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  return (await htmlFromDocx(data as ArrayBuffer)).html
}

describe('.docx 내려받기 → 가져오기', () => {
  it('제목 · 굵게 · 기울임 · 밑줄 · 취소선 · 링크가 남는다', async () => {
    const html = await roundTrip({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [text('서버 구성')] },
        p(
          text('굵게', [{ type: 'bold' }]),
          text(' '),
          text('기울임', [{ type: 'italic' }]),
          text(' '),
          text('밑줄', [{ type: 'underline' }]),
          text(' '),
          text('취소', [{ type: 'strike' }]),
          text(' '),
          text('링크', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
        ),
      ],
    })
    expect(html).toContain('<h2>서버 구성</h2>')
    expect(html).toContain('<strong>굵게</strong>')
    expect(html).toContain('<em>기울임</em>')
    expect(html).toContain('<u>밑줄</u>')
    expect(html).toContain('<s>취소</s>')
    expect(html).toContain('<a href="https://example.com">')
  })

  it('목록 · 번호 목록(겹친 단) · 체크리스트', async () => {
    const html = await roundTrip({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                p(text('하나')),
                { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('안쪽'))] }] },
              ],
            },
          ],
        },
        { type: 'orderedList', content: [{ type: 'listItem', content: [p(text('첫째'))] }] },
        {
          type: 'taskList',
          content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(text('끝낸 일'))] }],
        },
      ],
    })
    expect(html).toContain('<ul><li>하나<ul><li>안쪽</li></ul></li></ul>')
    expect(html).toContain('<ol><li>첫째</li></ol>')
    expect(html).toContain('☑ 끝낸 일')
  })

  it('표 — 머리 칸 · 병합이 남는다', async () => {
    const cell = (type: string, t: string, attrs: Record<string, unknown> = {}): JSONContent => ({
      type,
      attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs },
      content: [p(text(t))],
    })
    const html = await roundTrip({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [cell('tableHeader', '항목'), cell('tableHeader', '내용')],
            },
            { type: 'tableRow', content: [cell('tableCell', '합친 칸', { colspan: 2 })] },
          ],
        },
      ],
    })
    expect(html).toContain('<table>')
    expect(html).toContain('항목')
    expect(html).toContain('<td colspan="2"><p>합친 칸</p></td>')
  })

  it('그림은 담기고, 담지 못하는 그림(바깥 주소)은 자리 글', async () => {
    const html = await roundTrip({
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: PNG, alt: '점' } },
        { type: 'image', attrs: { src: 'https://example.com/a.png', alt: '바깥' } },
      ],
    })
    expect(html).toContain('<img alt="점" src="data:image/png;base64,')
    expect(html).toContain('[그림: 바깥]')
  })

  it('빈 문서도 열리는 파일이 된다', async () => {
    expect(await roundTrip({ type: 'doc', content: [] })).toBe('')
  })
})

describe('색', () => {
  it('#rgb · #rrggbb · rgb() → RRGGBB, 못 읽으면 undefined', () => {
    expect(hexColor('#abc')).toBe('AABBCC')
    expect(hexColor('#1A2b3c')).toBe('1A2B3C')
    expect(hexColor('rgb(255, 0, 16)')).toBe('FF0010')
    expect(hexColor('red')).toBeUndefined()
    expect(hexColor(undefined)).toBeUndefined()
  })
})
