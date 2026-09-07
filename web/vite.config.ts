import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    // 이 워크트리는 /mnt/c (drvfs) 라 inotify가 동작하지 않는다 — 폴링으로 파일 변경을 감지한다.
    watch: { usePolling: true, interval: 300 },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
