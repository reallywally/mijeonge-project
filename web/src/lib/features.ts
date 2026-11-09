/**
 * 화면에서 잠시 끈 기능. 읽는 자리는 여기 하나다 — 서버 · API 는 그대로 두고 화면만 숨긴다.
 * 기본은 꺼짐이고 vitest 는 설정에서 켠다. 테스트가 vi.stubEnv 로 바꿀 수 있게 부를 때마다 읽는다.
 */

/** 확인 요청(2026-11-09 숨김) — 안건 상세의 칸 · 헤더와 메뉴의 배지 · /checks 화면. 켜려면 VITE_FEATURE_CHECK_REQUEST=true */
export const isCheckRequestOn = () => import.meta.env.VITE_FEATURE_CHECK_REQUEST === 'true'
