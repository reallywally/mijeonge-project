/** 브라우저에 기억해 둔 값. 사생활 보호 모드 등에서 막혀 있으면 없는 것으로 친다 */
export function recall(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function remember(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* 막혀 있어도 앱은 돈다 */
  }
}
