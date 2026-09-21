/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  /* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any --
     vue-tsc 가 요구하는 표준 shim 이라 타입을 좁히면 .vue 임포트가 깨진다 */
  const component: DefineComponent<{}, {}, any>
  export default component
}
