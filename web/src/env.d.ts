/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'true' 면 서버 없이 픽스처로 돈다. 읽는 자리는 src/api/mode.ts 하나다 */
  readonly VITE_USE_MOCK?: string
  /** 'true' 면 확인 요청을 화면에 보인다. 읽는 자리는 src/lib/features.ts 하나다 */
  readonly VITE_FEATURE_CHECK_REQUEST?: string
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  /* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any --
     vue-tsc 가 요구하는 표준 shim 이라 타입을 좁히면 .vue 임포트가 깨진다 */
  const component: DefineComponent<{}, {}, any>
  export default component
}

/* mammoth 의 브라우저 묶음 — 본 모듈은 node 의 fs · path 를 끌고 와 화면은 이것을 쓴다. 타입은 본 모듈 것 그대로 */
declare module 'mammoth/mammoth.browser' {
  import mammoth from 'mammoth'
  export default mammoth
}
