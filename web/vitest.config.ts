import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

/* 화면 테스트가 .vue 를 읽어야 해서 vue 플러그인을 단다. tailwind 는 테스트에 필요 없다. */
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      /* dhtmlx-gantt 는 package.json 이 type: module 인데 main 이 UMD 라, node 쪽에서 읽으면
         export 가 비어 온다. 브라우저는 module 필드(ES 빌드)를 보므로 여기서만 맞춰 준다 */
      {
        find: /^dhtmlx-gantt$/,
        replacement: fileURLToPath(
          new URL('./node_modules/dhtmlx-gantt/codebase/dhtmlxgantt.es.js', import.meta.url),
        ),
      },
    ],
  },
})
