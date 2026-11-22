import { defineConfig } from 'vite';

/**
 * 贪吃蛇示例应用 —— 作为 vico 轻应用运行。
 *
 * - `base: './'`：产物使用相对路径，便于挂在 vico 的 `/app-static/snake-demo/` 下
 * - 开发态把 `/api` 代理到 vico server（3001），无前缀的应用 API 由 vico 注入
 */
export default defineConfig({
  base: './',
  server: {
    port: 5180,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
