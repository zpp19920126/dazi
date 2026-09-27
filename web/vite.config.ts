import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // 开发环境将 /api 代理到 NestJS 后端（3000 端口）
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // 将 element-plus 内联进测试转换管线：externalize 时其内部对 async-validator 的
    // CJS interop 在 Node 直载下异常，导致 el-form 的 validate() 失败被吞、恒 resolve true
    server: {
      deps: {
        inline: ['element-plus'],
      },
    },
  },
})
