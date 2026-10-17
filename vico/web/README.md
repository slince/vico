# @vico/web

Vico 管理后台（React 19 + Vite 6 + Tailwind CSS 4）。

提供 Agent / Skill / 记忆 / RAG / 可观测性 / Evals 等管理界面，聊天 UI 基于 assistant-ui。

## 启动

```bash
pnpm dev                     # 同时启动 server(3001) 与 web(5173)
pnpm --filter @vico/web dev  # 仅启动前端
```

## 技术栈

- React 19 + Vite 6 + Tailwind CSS 4
- shadcn/ui（radix-rhea 风格）+ assistant-ui
- TanStack Query 5 + React Router 7

## 主要目录

- `src/pages/` — 页面（observability / evals 等按领域分目录）
- `src/components/` — 布局 + shadcn/ui 基础组件 + assistant-ui 聊天组件
- `src/api/` — REST 客户端 + SSE 流式请求工具
- `src/hooks/` — useAuth 等

## 相关文档

- [UI 组件清单](../../docs/ui-components.md)
- [assistant-ui 组件清单](../../docs/assistant-ui-components.md)
