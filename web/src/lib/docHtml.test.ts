import { describe, expect, it } from 'vitest'
import { docxFileName, editorHtml, isHtmlContent, markdownToHtml } from './docHtml'

describe('예전 마크다운 글 → HTML', () => {
  it('HTML 이면 그대로, 빈 글도 HTML 로 본다', () => {
    expect(isHtmlContent('<p>a</p>')).toBe(true)
    expect(isHtmlContent('  ')).toBe(true)
    expect(isHtmlContent('### 제목')).toBe(false)
    expect(editorHtml('<h3>x</h3>')).toBe('<h3>x</h3>')
  })

  it('제목 · 문단 · 굵게 · 목록 · 표를 옮기고 글자는 이스케이프한다', () => {
    expect(markdownToHtml('### 서버 OS\n\n**우분투** <b>로</b>\n- 하나\n  - 안쪽\n- 둘')).toBe(
      '<h3>서버 OS</h3><p><strong>우분투</strong> &lt;b&gt;로&lt;/b&gt;</p>' +
        '<ul><li><p>하나</p><ul><li><p>안쪽</p></li></ul></li><li><p>둘</p></li></ul>',
    )
    expect(markdownToHtml('| 항목 | 내용 |\n| --- | --- |\n| a | b |')).toBe(
      '<table><tbody><tr><th><p>항목</p></th><th><p>내용</p></th></tr><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>',
    )
    expect(markdownToHtml('###### 깊은 제목')).toBe('<h3>깊은 제목</h3>')
  })

  it('내려받는 파일 이름 — 쓸 수 없는 글자는 _', () => {
    expect(docxFileName('서버/구성: 초안')).toBe('서버_구성_ 초안.docx')
    expect(docxFileName('  ')).toBe('글 문서.docx')
  })
})
