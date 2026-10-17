import { QueryClient } from '@tanstack/react-query';

/**
 * 全局 QueryClient 单例 — 供非组件模块（如线程适配器）失效查询缓存。
 *
 * main.tsx 通过 QueryClientProvider 将其注入 React 树；此处单独导出，
 * 以便 adapter 等无法使用 useQueryClient hook 的模块在变更后触发重取。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});
