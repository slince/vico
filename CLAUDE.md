@AGENTS.md

# CLAUDE.md

## 项目概述

Vico 是一个面向中小企业的 AI Agent 管理平台，基于"配置 + 即插即用 Skill"架构构建。提供支持多模型 LLM 的 Agent 引擎、管理后台 Web 控制台、基于文件系统的 Skill 插件系统、双层记忆管理以及 RAG 知识库。

## 技术栈

| 层 | 技术 |
|-------|-----------|
| 包管理器 | pnpm 9 + Turborepo（monorepo） |
| 后端 | TypeScript、Hono 4、ESM |
| Agent 框架 | Vercel AI SDK 4（`ai` 包） |
| 数据库 | better-sqlite3（WAL 模式）+ Drizzle ORM |
| 嵌入模型 | Transformers.js（本地）/ OpenAI API |
| 认证 | better-auth（Session Cookie + username/organization 插件）|
| 前端 | React 19、Vite 6、Tailwind CSS 4 |
| UI 组件 | shadcn/ui（radix-rhea 风格） |
| 前端数据获取 | TanStack Query 5 |
| 校验 | Zod |

## 目录结构

```
packages/
├── server/              # 后端 API + Agent 引擎
│   └── src/
│       ├── index.ts     # Hono 启动、CORS、限流、认证中间件
│       ├── config.ts    # YAML 配置加载器，支持环境变量插值
│       ├── api/         # 路由处理（Hono 路由注册函数，按领域划分）
│       │   ├── router.ts、auth.ts、agents.ts、skills.ts、chat.ts 等（Hono 路由注册函数）
│       ├── agent/       # 聊天管道、工具执行器、模型注册中心
│       ├── skill/       # 插件系统：类型定义、加载器、管理器
│       ├── memory/      # 短期记忆、长期记忆、RAG、嵌入器
│       ├── auth/        # better-auth 实例配置、Seed 默认组织+管理员；/api/auth/* 由 auth.handler() 处理
│       └── db/          # Drizzle ORM 连接、Schema、迁移（13 张表）
├── web/                 # React 管理后台
│   └── src/
│       ├── main.tsx     # QueryClient + RouterProvider
│       ├── router.tsx   # 全部路由及认证守卫
│       ├── api/client.ts  # REST 客户端 + SSE 流式请求工具
│       ├── hooks/       # useAuth、use-mobile
│       ├── lib/         # 工具函数（cn、utils）
│       ├── pages-new/   # 新版页面（shadcn/ui 重写，当前使用中）
│       ├── pages/       # 旧版页面（/old 路由下保留对照）
│       └── components/  # 布局（侧边栏+容器）+ shadcn/ui 基础组件
└── skills/              # 预置 Skill 插件（基于文件系统）
    └── <skill-name>/
        ├── manifest.json   # 元数据：名称、版本、参数
        ├── prompt.md       # 系统提示词片段
        ├── tools.ts        # 导出 SkillTool 对象数组
        └── resources/      # 知识文档
```

## 编码规范

### 后端规范（强制执行）

编写 `packages/server/src/` 下代码时，务必遵守 [docs/ts-server-best-practices.md](docs/ts-server-best-practices.md)。核心要点：

- **路由层**：每个 handler 第一行 `getAuthContext(c)`，不做业务逻辑，不写 try-catch
- **数据库**：所有查询带 `tenant_id` 过滤，主键用 `uuid()`，时间戳用 `Date.now()`
- **单例/导入**：Manager 类模块级单例，ESM 导入带 `.js` 扩展名
- **类型/错误**：避免 `any`，路由层异常自然冒泡，非关键路径可静默

### 前端规范（强制执行）

编写 `packages/web/src/` 下代码时，务必遵守 [docs/react-best-practices.md](docs/react-best-practices.md)。核心要点：

- **组件拆分**：按可理解性拆分（400行仍可理解则不拆；弹窗/表单>60行必拆）
- **状态覆盖**：每个数据驱动组件必须处理加载态(Skeleton)、空态(Empty)、错误态、正常态
- **类型/导入**：页面级类型优先放文件顶部；导入顺序 React → 第三方 → API/Hooks → UI → 子组件 → 类型

### 注释要求（强制执行）

- **函数/方法/导出组件**：完备的 JSDoc（用途、参数、返回值）
- **关键逻辑行**：行注释说明意图
- **类/接口/类型**：注释职责和使用场景
- **模块文件**：顶部简要说明模块职责

### 文档沉淀（强制执行）

- 完成关键功能、核心模块后，在 `docs/insights/` 下创建文档（`{模块名}-{功能简述}.md`）
- 修改或扩展已有模块前，先查阅对应领域的文档
- 修改核心模块前，必须查阅 [docs/architecture.md](docs/architecture.md) 了解模块职责和数据流

## 常用命令

```bash
pnpm dev                  # 同时启动服务端（端口 3001）和前端（端口 5173）
pnpm build                # 构建所有包
pnpm db:migrate           # 执行数据库迁移
pnpm skill:install <path> # 从目录安装 Skill
```

- 服务端配置：`packages/server/server.config.yaml`（支持 `${ENV_VAR}` 插值）
- 默认登录账号：`admin` / `admin123`

## 架构说明

详细架构见 [docs/architecture.md](docs/architecture.md)，以下为关键流程速览：

### 聊天管道

路由 → 加载 Agent → 解析模型 → 构建系统提示词（Agent prompt + Skill prompt + 长期记忆 + RAG）→ 组装工具 → AI SDK `streamText` → SSE 响应 → 持久化 → 更新记忆

### Skill 插件系统

文件系统扫描 → `manifest.json` + `prompt.md` + `tools.ts` → `SkillManager` 单例管理 → `agent_skills` 表绑定 → 工具通过动态 `import()` 加载

### 记忆系统

- **短期**：内存 Map 缓存，滑动 FIFO 窗口（`stm_window` 轮）
- **长期**：向量嵌入 + 余弦相似度检索，自动从对话提取事实（正则匹配）
- **RAG**：文档分块 → 向量化 → 混合搜索（70% 语义 + 30% 关键词）

### 认证

better-auth（Session Cookie 替代 JWT）→ `username` + `organization` 插件 → `/api/auth/*` 挂载 → Session 中间件注入 `user`/`session` → `getAuthContext(c)` 提取 `{ tenantId, userId }` → 所有查询按 `tenant_id` 过滤

### 数据库

Drizzle ORM（`drizzle-orm/better-sqlite3`）→ `getDb()` 懒加载单例，WAL 模式 + FK 开启 → `getSqlite()` 按需获取原始连接（BLOB/向量操作）→ snake_case 列名 → 迁移通过 `drizzle-kit generate` + `migrate()`

## 关键模式

- **单例**：`skillManager`、`toolExecutor`、`shortTermMemory`、`longTermMemory`、`ragManager`、`getDb()` 均为模块级单例
- **Hono 路由**：导出 `(app: Hono<{ Variables: Variables }>) => void`，通过 `c.get('user')`/`c.get('session')` 获取认证
- **SSE**：`ReadableStream` + `text/event-stream`，事件类型 `text_delta` / `done` / `error`
- **Drizzle 查询**：类型安全 API（`db.select().from().where(eq())` 等），替代原生 SQL
- **暂无测试**：早期 MVP 阶段

## shadcn/ui 备注

- 风格：`radix-rhea`，基础色：`neutral`，已启用 CSS 变量
- 组件别名：通过 `components.json` 配置（`@/components/ui`）
- 使用 `@/lib/utils` 中的 `cn()` 进行类名合并（clsx + tailwind-merge）
- 完整组件清单及用法详见 [docs/ui-components.md](docs/ui-components.md)（共 56 个组件组，200+ 导出）
