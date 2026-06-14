# Workspace 集成 & 重复 Agent 修复

**日期**: 2026-06-14

## 修改汇总

### 后端

| 文件 | 变更 | 说明 |
|------|------|------|
| `packages/server/src/agent/workspace-setup.ts` | **新增** | Workspace 单例工厂，基于 `LocalFilesystem` 提供文件系统能力，配置来自 `config.workspace` |
| `packages/server/src/agent/agents/main.agent.ts` | +2 行 | 添加 `workspace: getWorkspace()` 和对应 import |
| `packages/server/src/agent/agents/agent-proxy.agent.ts` | +2 行 | 添加 `workspace: getWorkspace()` 和对应 import |
| `packages/server/src/app.ts` | +15 行 | 新增 `/api/*` 路由 Auth 守卫中间件，保护 Mastra 内建端点免于未授权访问 |

### 前端

| 文件 | 变更 | 说明 |
|------|------|------|
| `packages/web/src/pages/Chat.tsx` | -4 +1 | 移除硬编码 `MAIN_AGENT` 常量，消除 Agent 列表重复 |
| `packages/web/src/pages/chat/MessageBubble.tsx` | -3 +11 | AI 消息改用 `react-markdown` + `remark-gfm` 渲染 Markdown |

---

## 1. Workspace 集成

### 背景

为 Mastra Agent 提供文件读写和代码执行能力，以便 Agent 可以在对话中操作用户工作区。

### 实现

- 创建 `workspace-setup.ts` 模块级单例，所有 Agent 共享同一个 Workspace 实例
- 使用 Mastra 内置的 `Workspace` + `LocalFilesystem`，无需额外依赖
- 配置项（`base_path`、`contained`、`allowed_paths`）统一由 `server.config.yaml` 的 `workspace` 段管理
- `mainAgent` 和 `agentProxy` 均注入该 Workspace 实例

### 文件详情

**`packages/server/src/agent/workspace-setup.ts`**

```typescript
import { Workspace, LocalFilesystem } from '@mastra/core/workspace';
import { resolve } from 'node:path';
import { config } from '../config.js';

let _workspace: Workspace;

export function getWorkspace(): Workspace {
  if (!_workspace) {
    const basePath = resolve(config.workspace.base_path);
    _workspace = new Workspace({
      filesystem: new LocalFilesystem({
        basePath,
        contained: config.workspace.contained,
        allowedPaths: config.workspace.allowed_paths,
      }),
    });
  }
  return _workspace;
}
```

---

## 2. 聊天页"两个 Vico"问题修复

### 根因

`Chat.tsx` 中硬编码了一个 `MAIN_AGENT: Agent = { id: 'main', name: 'Vico' }` 常量，并拼接到 API 返回的 Agent 列表前：

```ts
// 修复前
const MAIN_AGENT: Agent = { id: 'main', name: 'Vico' };
const agentList: Agent[] = [MAIN_AGENT, ...(agents ?? [])];
```

而数据库 seed 中也创建了一个 `id: 'main'`, `name: 'Vico'` 的 Agent。两者同时出现在列表中导致两条同名条目。

### 修复

- 移除 `MAIN_AGENT` 常量，直接使用 API 返回的 Agent 列表
- 添加 `/api/*` Auth 守卫中间件，确保 Mastra 内建路由（`/api/agents` 等）与自定义路由（`/api/v1/*`）的认证边界一致

---

## 3. AI 消息 Markdown 渲染

`MessageBubble.tsx` 中 AI 回复原本使用 `whitespace-pre-wrap` 纯文本渲染，改为使用 `react-markdown` + `remark-gfm`：

- AI 消息以 Markdown 格式渲染，支持代码块、表格、列表等 GFM 扩展语法
- 用户消息保持 `whitespace-pre-wrap` 纯文本渲染
- 流式输出末尾保留闪烁光标动画

---

## 依赖变更

| 包 | 变更 |
|----|------|
| `react-markdown` | 新增（前端） |
| `remark-gfm` | 新增（前端） |
| `@mastra/core/workspace` | 新增使用（后端） |
