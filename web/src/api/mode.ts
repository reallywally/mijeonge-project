/**
 * 목업으로 도는지. VITE_USE_MOCK 을 읽는 자리는 여기 하나다.
 * 개발 기본값은 서버 연결이고 vitest 는 설정에서 켠다. 테스트가 vi.stubEnv 로 바꿀 수 있게 부를 때마다 읽는다.
 */
export const isMockMode = () => import.meta.env.VITE_USE_MOCK === 'true'
