import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// 加载 server/.env，保证 e2e 测试可读取 DATABASE_URL / JWT_SECRET
config();

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // 多个 e2e 文件共享同一 MySQL 库（含共享的 admin 账号），必须串行执行
    fileParallelism: false,
  },
});
