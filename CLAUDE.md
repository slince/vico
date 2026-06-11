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
│       └── data/        # Drizzle ORM 连接、Schema、迁移（13 张表）
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

### 注释要求（强制执行）

- **方法/函数级别**：每个函数、方法、导出的组件必须包含完备的 JSDoc 注释，说明用途、参数含义、返回值
- **重要代码行**：关键逻辑行、非显而易见的操作、边界条件处理必须添加行注释说明意图
- **类/接口**：每个类、接口、类型定义需注释其职责和使用场景
- **模块文件**：文件顶部需简要说明该模块的职责

示例格式：
```typescript
/**
 * 根据用户查询从知识库检索相关文档片段
 * 采用混合搜索策略：70% 语义相似度 + 30% 关键词匹配
 * 
 * @param query - 用户原始查询文本
 * @param limit - 返回的最大片段数，默认 5
 * @returns 按相关度降序排列的文档片段数组
 */
async function searchDocuments(query: string, limit = 5): Promise<SearchResult[]> {
    // 将查询文本向量化
    const embedding = await embedder.embed(query);
    // 执行混合搜索并去重合并
    const results = hybridSearch(embedding, query, limit);
    return results;
}
```

### Web 前端组件规范（强制执行）

编写或修改 `packages/web/src/` 下的任何组件时，**务必遵守** [docs/react-best-practices.md](docs/react-best-practices.md) 中的全部规范，核心要点：

- **组件拆分**：单个文件不超过 200 行，子组件提取到页面同级子目录（如 `pages-new/dashboard/StatCard.tsx`）
- **职责单一**：页面组件只做数据获取和布局编排，UI 渲染交给子组件
- **状态覆盖**：每个组件必须处理加载态（Skeleton）、空态（Empty）、错误态、正常态
- **禁止内联子组件**：不要在页面文件内部定义 StatCard、Dialog 等子组件函数
- **类型分离**：页面级类型定义在 `types.ts`，不混入组件文件
- **导入顺序**：React → 第三方 → API/Hooks → UI 组件 → 子组件 → 类型

### 关键代码文档沉淀（强制执行）

- **何时沉淀**：完成关键功能、核心模块、重要算法后，必须在 `docs/insights/` 目录下创建对应的文档
- **文档命名**：`{模块名}-{功能简述}.md`，如 `agent-pipeline-flow.md`、`auth-jwt-design.md`
- **文档内容**：需包含设计思路、关键流程、数据结构、API 说明、使用示例
- **目录组织**：文档放在 `docs/insights/` 下，优先归入已有子目录；若无合适的子目录，AI 自行按领域创建新的子目录
- **知识库参考**：修改或扩展已有模块前，必须先查阅 `docs/insights/` 中对应领域的文档，理解现有设计后再动手
- **架构参考**：修改核心模块（Agent 引擎、Skill 系统、记忆系统、RAG、认证）前，必须查阅 [docs/architecture.md](docs/architecture.md) 了解模块职责和数据流

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

### 聊天管道（server/src/agent/pipeline.ts）

路由 → 加载 Agent 配置 → 解析模型 → 构建系统提示词（Agent 基础提示词 + Skill 提示词 + 长期记忆 + RAG 上下文）→ 组装工具 → 通过 AI SDK 调用 `streamText` → SSE 响应 → 持久化对话 → 更新短期记忆

### Skill 插件系统（server/src/skill/）

- 通过扫描配置的目录来发现 Skill
- 每个 Skill 从 `manifest.json` + `prompt.md` + `tools.ts` 加载
- `SkillManager` 是单例，通过 `agent_skills` 关联表管理 Agent 与 Skill 的绑定
- 工具在加载时通过动态 `import()` 引入

### 记忆与 RAG（server/src/memory/）

- **短期记忆**：基于内存 Map 缓存，采用滑动 FIFO 窗口
- **长期记忆**：向量嵌入 + SQLite 余弦相似度检索
- **RAG**：混合搜索（70% 语义 + 30% 关键词）、文本分块、去重
- **嵌入器**：双模式 — 本地 Transformers.js 或 OpenAI API，支持基于哈希的降级方案

### 认证

- 基于 **better-auth**，使用 Session Cookie（HTTP-only）代替 JWT Bearer Token
- 插件：`username`（用户名密码登录）、`organization`（多租户/组织管理）
- better-auth 的路由通过 `auth.handler(c.req.raw)` 挂载在 `/api/auth/*`
- Session 中间件在每个请求上调用 `auth.api.getSession()`，将 `user` 和 `session` 注入 Hono 上下文（`c.get('user')`、`c.get('session')`）
- `getAuthContext(c)` 辅助函数从 session 提取 `{ tenantId, userId }`，供路由处理函数使用
- 租户隔离：通过 `session.activeOrganizationId` 实现，所有业务查询按 `tenant_id` 过滤
- 首次运行时通过 `auth/seed.ts` 自动创建默认组织和管理员用户（admin/admin123）
- 密钥配置：`BETTER_AUTH_SECRET` 环境变量（默认 dev-secret-change-me-in-production）

### 数据库

- **ORM**：Drizzle ORM（`drizzle-orm/better-sqlite3`），类型安全的查询构建器
- **Schema**：定义在 `src/data/schema.ts`，共 13 张表，使用 snake_case 列名
- **迁移**：由 `drizzle-kit generate` 生成 SQL 文件（`drizzle/` 目录），通过 `drizzle-orm/better-sqlite3/migrator` 执行
- **双出口**：`getDb()` 返回 Drizzle 实例（常规 CRUD），`getSqlite()` 返回原始 better-sqlite3 连接（BLOB/向量操作）
- 通过 `getDb()` 获取单例连接，启用 WAL 模式以支持并发读取

## 关键模式

- **单例模式**：`skillManager`、`toolExecutor`、`shortTermMemory`、`longTermMemory`、`ragManager`、`getDb()` 均为模块级单例
- **Hono 路由函数**：路由文件导出函数 `(app: Hono<{ Variables: Variables }>) => void`，通过 `c.get('auth')` 获取认证上下文
- **SSE 流式传输**：通过 `ReadableStream` 实现 `text/event-stream`，由 AI SDK 异步迭代器转换
- **Provider 适配器**：模型注册中心将 provider 字符串映射到 Vercel AI SDK provider 函数
- **Drizzle 查询**：使用类型安全的查询 API（`db.select().from(table).where(eq(...))` 等），替代原生 SQL 字符串
- **暂无测试**：早期 MVP 阶段

## shadcn/ui 备注

- 风格：`radix-rhea`，基础色：`neutral`，已启用 CSS 变量
- 组件别名：通过 `components.json` 配置（`@/components/ui`）
- 使用 `@/lib/utils` 中的 `cn()` 进行类名合并（clsx + tailwind-merge）
- 完整组件清单及用法详见 [docs/ui-components.md](docs/ui-components.md)（共 56 个组件组，200+ 导出）
