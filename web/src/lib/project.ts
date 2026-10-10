/**
 * 작업 키 접두사(`HW-4` 의 `HW`).
 *
 * 프로젝트마다 하나고 서로 겹치지 않는다 — 말로 'HW-4' 한 마디로 가리키는 값이라
 * 겹치면 뜻이 없다. 등록할 때 적는 것은 선택이고, 비우면 서버가 만들어 준다 (API.md Q20).
 */

/** 서버가 제안한 모양 — 대문자로 시작하는 영숫자 1~8자 */
export const TASK_KEY_PREFIX_RE = /^[A-Z][A-Z0-9]{0,7}$/

/** 비워 두고 저장했을 때 붙는 값. 서버가 할 일을 목업이 대신한다 */
export function makeTaskKeyPrefix(taken: string[]) {
  const used = new Set(taken.map((p) => p.toUpperCase()))
  let n = 1
  while (used.has(`PJ${n}`)) n += 1
  return `PJ${n}`
}

/** 폼에 그대로 띄우는 한국어 한 줄. 비어 있으면(=자동) 잘못이 아니다 */
export function taskKeyPrefixError(value: string, taken: string[]): string | null {
  const prefix = value.trim().toUpperCase()
  if (prefix === '') return null
  if (!TASK_KEY_PREFIX_RE.test(prefix)) {
    return '영문 대문자로 시작하는 영문·숫자 1~8자로 적어 주세요.'
  }
  if (taken.some((p) => p.toUpperCase() === prefix)) {
    return '다른 프로젝트가 이미 쓰고 있는 접두사입니다.'
  }
  return null
}
