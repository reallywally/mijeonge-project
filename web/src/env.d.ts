/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'true' 면 서버 없이 픽스처로 돈다. 읽는 자리는 src/api/mode.ts 하나다 */
  readonly VITE_USE_MOCK?: string
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  /* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any --
     vue-tsc 가 요구하는 표준 shim 이라 타입을 좁히면 .vue 임포트가 깨진다 */
  const component: DefineComponent<{}, {}, any>
  export default component
}
