import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 글이 길어지면 textarea 도 같이 늘린다. 칸은 CSS `field-sizing: content` 로도 늘어나고 이것은
 * 그걸 모르는 브라우저를 위한 것이다. 아직 그려지기 전(팝업이 막 열릴 때)에는 높이가 0 으로 재지니
 * 그때는 건드리지 않는다 — 0 으로 굳히면 글자가 안 보인다.
 */
export function fitTextarea(el: HTMLTextAreaElement | null | undefined) {
  if (!el) return
  const prev = el.style.height
  el.style.height = 'auto'
  if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`
  else el.style.height = prev
}
