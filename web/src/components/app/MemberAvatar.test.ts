// @vitest-environment jsdom
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import MemberAvatar from './MemberAvatar.vue'

enableAutoUnmount(afterEach)

const PHOTO = 'data:image/png;base64,iVBORw0KGgo='

describe('MemberAvatar — 사람 동그라미', () => {
  it('사진이 없으면 이름 첫 글자, 사람이 없으면 –', () => {
    expect(mount(MemberAvatar, { props: { name: '김서연' } }).text()).toBe('김')
    const none = mount(MemberAvatar, { props: { name: null } })
    expect(none.text()).toBe('–')
    expect(none.find('img').exists()).toBe(false)
  })

  it('사진이 있으면 사진, 크기는 지름 그대로', () => {
    const w = mount(MemberAvatar, { props: { name: '김서연', src: PHOTO, size: 96 } })
    expect(w.get('img').attributes('src')).toBe(PHOTO)
    expect(w.get('img').attributes('alt')).toBe('')
    expect(w.text()).toBe('')
    expect(w.attributes('style')).toContain('width: 96px')
    expect(w.attributes('data-avatar-photo')).toBeDefined()
  })

  it('사진이 안 열리면 첫 글자로 돌아가고, 주소가 바뀌면 다시 사진을 건다', async () => {
    const w = mount(MemberAvatar, { props: { name: '박지훈', src: '/api/members/u2/avatar?v=1' } })
    await w.get('img').trigger('error')
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).toBe('박')

    await w.setProps({ src: '/api/members/u2/avatar?v=2' })
    expect(w.get('img').attributes('src')).toBe('/api/members/u2/avatar?v=2')
  })

  it('거른 꼴이 아닌 주소는 그리지 않는다', () => {
    const w = mount(MemberAvatar, { props: { name: '이도현', src: 'javascript:alert(1)' } })
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).toBe('이')
  })
})
