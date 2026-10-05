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
    // 监听所有网卡，允许手机/局域网设备访问
    host: true,
    proxy: {
      // 开发环境将 /api 代理到 NestJS 后端（默认 3000，可用 VITE_API_TARGET 覆盖）
      '/api': process.env.VITE_API_TARGET ?? 'http://localhost:3000',
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
